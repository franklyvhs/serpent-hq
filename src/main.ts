// ============================================================
// SERPENT HQ — v0.5 (a Hacktoria game)
// Fullscreen cover-crop presentation: the canvas fills the browser,
// integer camera zoom, camera snaps at map edges (no black bars).
// M3b: world comes from a Tiled JSON map (public/assets/maps/),
// rendered by KAPLAY at 16px tiles, fullscreen cover-crop.
// DOM still owns the console modal, auth and HUD.
// ============================================================

import kaplay from "kaplay";
import { createClient } from "@supabase/supabase-js";
import { loadTiled, TiledWorld, Vec } from "./tiled";

interface Contract {
  slug: string;
  emoji: string;
  title: string;
  discipline: string;
  difficulty: "Easy" | "Medium" | "Hard";
  points: number;
  brief: string;
  hint: string;
}

// ---------- DOM ----------
const canvas = document.getElementById("game") as HTMLCanvasElement;
const promptEl = document.getElementById("prompt")!;
const modal = document.getElementById("console-modal")!;
const listEl = document.getElementById("contract-list")!;
const detailEl = document.getElementById("contract-detail")!;
const leaderboardEl = document.getElementById("leaderboard") as HTMLElement;
const leaderboardList = document.getElementById("leaderboard-list")!;
const agentIdEl = document.getElementById("agent-id") as HTMLElement;
const scoreEl = document.getElementById("hud-score")!;
const agentEl = document.getElementById("hud-agent")!;
const authOverlay = document.getElementById("auth-overlay")!;
const authStatus = document.getElementById("auth-status")!;
const authEmail = document.getElementById("auth-email") as HTMLInputElement;
const authBtn = document.getElementById("auth-btn") as HTMLElement;
const codenameInput = document.getElementById("codename-input") as HTMLInputElement;
const codenameSave = document.getElementById("codename-save") as HTMLElement;
const codenameFeedback = document.getElementById("codename-feedback") as HTMLElement;
const logoutBtn = document.getElementById("logout-btn") as HTMLElement;
const tabs = Array.from(document.querySelectorAll("#console-tabs .tab")) as HTMLElement[];

// ---------- kaplay ----------
// The canvas fills the browser window (see index.html); cover-crop
// camera below keeps the map covering the whole screen.
const k = kaplay({
  // No fixed width/height: the canvas fills the browser window and
  // KAPLAY keeps the render resolution in sync on resize (onResize).
  canvas,
  background: [5, 8, 15],
  crisp: true,
  global: false,
  debug: false,
  pixelDensity: window.devicePixelRatio || 1,
});

const PLAYER_SPEED = 80; // px per second (16px tiles)
const INTERACT_RANGE = 22; // px

let world: TiledWorld;
const player = { x: 0, y: 0 }; // px
let playerObj: any;
let idleObj: any;
let consolePos: Vec = { x: 0, y: 0 }; // legacy spot ref (kept for compatibility)
let facing: "right" | "up" | "left" | "down" = "down";
let walkTimer = 0; // seconds, drives the manual walk animation
let idleTimer = 0; // seconds, drives the idle sway while standing
const range = (n: number) => Array.from({ length: n }, (_i) => _i);
// Agent K is one whole-set sheet from the LimeZu Character Generator
// (serpent_agent_k.png, 896x640 = 56x20 slices of 16x32). Row 0 is the
// static band (frames 0-3: right/up/left/down), row 1 the idle sway,
// row 2 the walk cycle. Inside an animation band, frames group by
// direction, six frames each, order right/up/left/down; frame 0 of each
// idle direction doubles as the standing pose.
const ANIM_FRAME: Record<string, number> = { right: 0, up: 6, left: 12, down: 18 };
const IDLE_ROW = 1 * 56; // slice index where the idle band starts
const WALK_ROW = 2 * 56; // slice index where the walk band starts
const WALK_FPS = 10; // walk animation, frames per second
const IDLE_FPS = 4;  // idle sway, frames per second

// ---------- generic interactables ----------
// Any named point object in the map's "Objects" layer can become an
// interactable: give it an entry here (label + behavior).
interface Hotspot { name: string; x: number; y: number; }
let hotspots: Hotspot[] = [];
let toastActive = false;
let toastUntil = 0;

function toast(msg: string) {
  promptEl.textContent = msg;
  promptEl.classList.remove("hidden");
  toastActive = true;
  toastUntil = performance.now() + 3200;
}

// ---------- SERPENT OS desk computer (src/computer.js) ----------
// The computer overlay dispatches "serpent-computer" events so the
// game loop can pause movement while the player sits at the desk.
let computerOpen = false;
window.addEventListener("serpent-computer", ((e: CustomEvent) => {
  computerOpen = !!e.detail?.open;
  if (computerOpen) for (const kk of Object.keys(keys)) keys[kk] = false;
}) as EventListener);

// The in-world whiteboard overlay pauses movement the same way.
let whiteboardOpen = false;
window.addEventListener("serpent-whiteboard", ((e: CustomEvent) => {
  whiteboardOpen = !!e.detail?.open;
  if (whiteboardOpen) for (const kk of Object.keys(keys)) keys[kk] = false;
}) as EventListener);

// The arcade machine overlay (SNAKELOR.EXE, src/arcade.js) same again.
let arcadeOpen = false;
window.addEventListener("serpent-arcade", ((e: CustomEvent) => {
  arcadeOpen = !!e.detail?.open;
  if (arcadeOpen) for (const kk of Object.keys(keys)) keys[kk] = false;
}) as EventListener);

const INTERACTABLES: Record<string, { label: string; action: () => void }> = {
  "contract-console": {
    label: "Agent K's computer",
    action: () => (window as any).SERPENT_COMPUTER?.open(),
  },
  "arcade-machine": {
    label: "Arcade machine",
    action: () => (window as any).SNAKELOR?.open(),
  },
  "notice-board": {
    label: "HQ notice board",
    action: () => (window as any).WHITEBOARD?.open(),
  },
  "coffee-machine": {
    label: "Coffee machine",
    action: () => toast("The machine sputters to life. Morale restored. Back to work, Agent."),
  },
};

function nearestInteractable(): { spot: Hotspot; def: { label: string; action: () => void } } | null {
  let best: { spot: Hotspot; def: { label: string; action: () => void } } | null = null;
  let bestD = INTERACT_RANGE;
  for (const spot of hotspots) {
    const def = INTERACTABLES[spot.name];
    if (!def) continue;
    const d = Math.max(Math.abs(player.x - spot.x), Math.abs(player.y - spot.y));
    if (d <= bestD) { bestD = d; best = { spot, def }; }
  }
  return best;
}

// ---------- NPCs ----------
// The cast lives in public/content/npcs.json (Frank edits it there);
// each NPC is placed via a Tiled point object named "npc-<id>" on the
// map's "Objects" layer (a plain x/y in the JSON works as a fallback).
// Sprites follow the same whole-set export pattern as Agent K
// (896x640 = 56x20 slices of 16x32, band order verified Nov 21).
// Until a sprite PNG exists at the configured path the NPC renders as
// a colored placeholder block with a name tag, so the cast can be
// walked, talked to and debugged before Frank drops the art in.
interface NpcDef {
  id: string;
  name: string;
  sprite?: string;
  color?: number[];
  x?: number;
  y?: number;
  wander?: boolean;
  wanderRadius?: number;
  speed?: number;
  dialogue: string[];
}
interface Npc extends NpcDef {
  hx: number; hy: number; // home position
  px: number; py: number; // current position
  fx: number; fy: number; // facing vector (one axis dominant)
  state: "idle" | "walk";
  timer: number;
  tx: number; ty: number; // walk target
  walkObj: any;
  idleObj: any;
  tagObj: any | null;
  hasSheet: boolean;
  animTimer: number;
}
const npcs: Npc[] = [];
let npcDefs: NpcDef[] = [];

// Dialogue box (DOM, SERPENT OS chrome; built here, styled in
// serpent-os.css).
const dialogueEl = document.createElement("div");
dialogueEl.id = "npc-dialogue";
dialogueEl.className = "hidden";
dialogueEl.innerHTML =
  '<div class="nd-name"></div><div class="nd-text"></div>' +
  '<div class="nd-hint">[E] next · [Esc] end conversation</div>';
document.body.appendChild(dialogueEl);
const dlgName = dialogueEl.querySelector(".nd-name") as HTMLElement;
const dlgText = dialogueEl.querySelector(".nd-text") as HTMLElement;
let dialogueOpen = false;
let dialogueNpc: Npc | null = null;
let dialogueLine = 0;

function openDialogue(npc: Npc) {
  dialogueNpc = npc;
  dialogueLine = 0;
  dialogueOpen = true;
  dlgName.textContent = npc.name;
  dlgText.textContent = npc.dialogue[0] ?? "...";
  dialogueEl.classList.remove("hidden");
}

function advanceDialogue() {
  if (!dialogueNpc) return;
  dialogueLine++;
  if (dialogueLine >= dialogueNpc.dialogue.length) { closeDialogue(); return; }
  dlgText.textContent = dialogueNpc.dialogue[dialogueLine];
}

function closeDialogue() {
  dialogueOpen = false;
  dialogueNpc = null;
  dialogueEl.classList.add("hidden");
}

function nearestNpc(): Npc | null {
  let best: Npc | null = null;
  let bestD = INTERACT_RANGE;
  for (const npc of npcs) {
    const d = Math.max(Math.abs(player.x - npc.px), Math.abs(player.y - npc.py));
    if (d <= bestD) { bestD = d; best = npc; }
  }
  return best;
}

async function spriteExists(url: string): Promise<boolean> {
  try { const r = await fetch(url, { method: "HEAD" }); return r.ok; } catch { return false; }
}

async function spawnNpcs() {
  // cast definitions from public/content/npcs.json
  try {
    const res = await fetch("/content/npcs.json");
    if (res.ok) npcDefs = await res.json();
  } catch { /* no cast file: world still loads */ }
  for (const def of npcDefs) {
    // placement: Tiled point object "npc-<id>" wins, else JSON x/y
    const spot = world.objects.find((o) => o.name === "npc-" + def.id);
    const startX = spot ? spot.x : def.x;
    const startY = spot ? spot.y : def.y;
    if (startX === undefined || startY === undefined) {
      console.warn("NPC skipped (no position): add a Tiled object named npc-" + def.id);
      continue;
    }
    const npc: Npc = {
      ...def,
      hx: startX, hy: startY,
      px: startX, py: startY,
      fx: 0, fy: 1, // default facing down
      state: "idle",
      timer: 1 + Math.random() * 3,
      tx: startX, ty: startY,
      walkObj: null, idleObj: null, tagObj: null,
      hasSheet: false,
      animTimer: 0,
    };
    // sprite: whole-set sheet if the PNG exists, else placeholder block
    if (def.sprite && (await spriteExists(def.sprite))) {
      try {
        await k.loadSprite("npc-" + def.id, def.sprite, { sliceX: 56, sliceY: 20 });
        npc.hasSheet = true;
      } catch { /* fall through to placeholder */ }
    }
    const col = def.color ?? [200, 200, 200];
    if (npc.hasSheet) {
      npc.walkObj = k.add([
        k.pos(npc.px, npc.py),
        k.sprite("npc-" + def.id, { frame: WALK_ROW + ANIM_FRAME.down }),
        k.anchor("bot"),
      ]);
      npc.idleObj = k.add([
        k.pos(npc.px, npc.py),
        k.sprite("npc-" + def.id, { frame: IDLE_ROW + ANIM_FRAME.down }),
        k.anchor("bot"),
      ]);
      npc.walkObj.hidden = true;
    } else {
      npc.walkObj = k.add([
        k.pos(npc.px, npc.py),
        k.rect(12, 22),
        k.color(col[0], col[1], col[2]),
        k.anchor("bot"),
        k.opacity(0.9),
      ]);
      npc.tagObj = k.add([
        k.pos(npc.px, npc.py - 26),
        k.text(def.name, { size: 8 }),
        k.color(255, 255, 255),
        k.anchor("bot"),
      ]);
    }
    npcs.push(npc);
  }
}

function npcSolidAt(px: number, py: number): boolean {
  return solidAt(px, py);
}

function updateNpcs(dt: number) {
  for (const npc of npcs) {
    if (npc.state === "idle") {
      npc.timer -= dt;
      if (npc.timer <= 0) {
        if (npc.wander) {
          // pick a reachable target within the wander radius of home
          const r = npc.wanderRadius ?? 40;
          for (let tries = 0; tries < 6; tries++) {
            const ang = Math.random() * Math.PI * 2;
            const dist = 8 + Math.random() * r;
            const tx = npc.hx + Math.cos(ang) * dist;
            const ty = npc.hy + Math.sin(ang) * dist;
            if (!npcSolidAt(tx, ty)) { npc.tx = tx; npc.ty = ty; npc.state = "walk"; break; }
          }
        }
        npc.timer = 1.5 + Math.random() * 3.5;
      }
    } else {
      // walk toward the target, one axis at a time (like the player)
      const spd = npc.speed ?? 36;
      const dx = npc.tx - npc.px;
      const dy = npc.ty - npc.py;
      if (Math.abs(dx) < 1.5 && Math.abs(dy) < 1.5) {
        npc.px = npc.tx; npc.py = npc.ty;
        npc.state = "idle";
        npc.timer = 1.5 + Math.random() * 3.5;
      } else {
        let moved = false;
        const stepX = Math.abs(dx) > 1.5 ? Math.sign(dx) * spd * dt : 0;
        const stepY = Math.abs(dy) > 1.5 ? Math.sign(dy) * spd * dt : 0;
        if (stepX && !npcSolidAt(npc.px + stepX, npc.py)) { npc.px += stepX; moved = true; }
        if (stepY && !npcSolidAt(npc.px, npc.py + stepY)) { npc.py += stepY; moved = true; }
        if (!moved) {
          // stuck against furniture: give up and idle for a bit
          npc.state = "idle";
          npc.timer = 1 + Math.random() * 2;
        } else {
          if (Math.abs(dx) > Math.abs(dy)) { npc.fx = Math.sign(dx); npc.fy = 0; }
          else { npc.fx = 0; npc.fy = Math.sign(dy); }
          npc.animTimer += dt;
        }
      }
    }
    // render
    if (npc.walkObj) { npc.walkObj.pos.x = npc.px; npc.walkObj.pos.y = npc.py; }
    if (npc.idleObj) { npc.idleObj.pos.x = npc.px; npc.idleObj.pos.y = npc.py; }
    if (npc.tagObj) { npc.tagObj.pos.x = npc.px; npc.tagObj.pos.y = npc.py - 26; }
    if (npc.hasSheet && npc.idleObj && npc.walkObj) {
      const dirName = npc.fx === 1 ? "right" : npc.fx === -1 ? "left" : npc.fy === -1 ? "up" : "down";
      if (npc.state === "walk") {
        npc.idleObj.hidden = true;
        npc.walkObj.hidden = false;
        npc.walkObj.frame = WALK_ROW + ANIM_FRAME[dirName] + (Math.floor(npc.animTimer * 8) % 6);
      } else {
        npc.walkObj.hidden = true;
        npc.idleObj.hidden = false;
        npc.idleObj.frame = IDLE_ROW + ANIM_FRAME[dirName] + (Math.floor(npc.animTimer * IDLE_FPS) % 6);
      }
    }
  }
}

// ---------- camera: fullscreen cover-crop with edge snap ----------
// The camera zoom is an integer (world px -> screen px) so pixels stay
// crisp at any window size, and big enough that the map always covers
// the whole viewport (cover-crop: no black bars anywhere).
let camZoom = 1;

function fitCamera() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let z = Math.max(1, Math.floor(Math.min(vw / 320, vh / 224)));
  if (world) {
    const mapPxW = world.mapW * world.tile;
    const mapPxH = world.mapH * world.tile;
    // zoom up so the full screen is still covered by the map
    z = Math.max(z, Math.ceil(vw / mapPxW), Math.ceil(vh / mapPxH));
  }
  if (z !== camZoom) {
    camZoom = z;
    k.camScale(camZoom);
  }
}

function updateCamera() {
  if (!world) return;
  const viewW = k.width() / camZoom;
  const viewH = k.height() / camZoom;
  const mapPxW = world.mapW * world.tile;
  const mapPxH = world.mapH * world.tile;
  // follow the player, but never show beyond the map (snap to edges);
  // if the view can show the whole map axis, just center it.
  let cx = viewW >= mapPxW ? mapPxW / 2
    : Math.min(Math.max(player.x, viewW / 2), mapPxW - viewW / 2);
  let cy = viewH >= mapPxH ? mapPxH / 2
    : Math.min(Math.max(player.y, viewH / 2), mapPxH - viewH / 2);
  // round to the world-pixel grid so there is no shimmer while walking
  cx = Math.round(cx * camZoom) / camZoom;
  cy = Math.round(cy * camZoom) / camZoom;
  k.camPos(cx, cy);
}

k.onResize(() => fitCamera());

function solidAt(px: number, py: number): boolean {
  if (!world) return true;
  const tx = Math.floor(px / world.tile);
  const ty = Math.floor(py / world.tile);
  if (tx < 0 || ty < 0 || tx >= world.mapW || ty >= world.mapH) return true;
  return world.solid[ty * world.mapW + tx] === 1;
}

async function buildWorld() {
  world = await loadTiled(k, "/assets/maps/hq.json");
  player.x = world.spawn.x;
  player.y = world.spawn.y;
  const c = world.objects.find((o) => o.name === "contract-console");
  if (c) consolePos = { x: c.x, y: c.y };
  fitCamera();

  // Agent K: the whole-set generator export, one PNG. (Earlier this ran
  // as one PNG per animation, and before that as a `frames` quad array —
  // the quad path renders blank outside the sheet's top-left 64x64 px,
  // root cause unknown; slices work everywhere, keep using slices.)
  await k.loadSprite(
    "ak",
    "/assets/characters/serpent_agent_k.png",
    { sliceX: 56, sliceY: 20 },
  );

  // The walk-cycle renderer; hidden while standing (idleObj shows then).
  playerObj = k.add([
    k.pos(player.x, player.y),
    k.sprite("ak", { frame: WALK_ROW + ANIM_FRAME.down }),
    k.anchor("bot"),
  ]);
  // `hidden` is a built-in game-object property in kaplay; setting it
  // as a component value collides ("Duplicate component property"), so
  // assign it right after creation instead.
  playerObj.hidden = true;
  // Standing/idle renderer; visible while not moving.
  idleObj = k.add([
    k.pos(player.x, player.y),
    k.sprite("ak", { frame: IDLE_ROW + ANIM_FRAME.down }),
    k.anchor("bot"),
  ]);

  // The NPC cast (public/content/npcs.json + Tiled npc-<id> objects)
  await spawnNpcs();

  // Hotspot markers for everything the game knows how to interact with
  for (const o of world.objects) {
    if (!INTERACTABLES[o.name]) continue;
    hotspots.push({ name: o.name, x: o.x, y: o.y });
    k.add([
      k.pos(o.x, o.y),
      k.circle(6),
      k.color(34, 211, 238),
      k.opacity(0.35),
      k.anchor("center"),
    ]);
  }

  k.onUpdate(() => {
    if (!overlaysDown()) return;
    const dt = k.dt();
    const dx = (keys["arrowright"] || keys["d"] ? 1 : 0) - (keys["arrowleft"] || keys["a"] ? 1 : 0);
    const dy = (keys["arrowdown"] || keys["s"] ? 1 : 0) - (keys["arrowup"] || keys["w"] ? 1 : 0);
    const nx = player.x + dx * PLAYER_SPEED * dt;
    const ny = player.y + dy * PLAYER_SPEED * dt;
    if (dx && !solidAt(nx, player.y)) player.x = nx;
    if (dy && !solidAt(player.x, ny)) player.y = ny;
    playerObj.pos.x = player.x;
    playerObj.pos.y = player.y;
    idleObj.pos.x = player.x;
    idleObj.pos.y = player.y;
    if (dx > 0) facing = "right";
    else if (dx < 0) facing = "left";
    else if (dy > 0) facing = "down";
    else if (dy < 0) facing = "up";
    const moving = dx !== 0 || dy !== 0;
    if (moving) {
      // Six-frame walk cycle per direction, stepped manually.
      idleObj.hidden = true;
      playerObj.hidden = false;
      walkTimer += dt;
      idleTimer = 0;
      playerObj.frame =
        WALK_ROW + ANIM_FRAME[facing] + (Math.floor(walkTimer * WALK_FPS) % 6);
    } else {
      // Standing: gentle idle sway; frame 0 is the plain standing pose.
      playerObj.hidden = true;
      idleObj.hidden = false;
      walkTimer = 0;
      idleTimer += dt;
      idleObj.frame =
        IDLE_ROW + ANIM_FRAME[facing] + (Math.floor(idleTimer * IDLE_FPS) % 6);
    }
    updateNpcs(dt);
    updateCamera();
    if (toastActive) {
      if (performance.now() > toastUntil) {
        toastActive = false;
        promptEl.classList.add("hidden");
      }
      return;
    }
    const near = nearestInteractable();
    const nearNpc = nearestNpc();
    // prefer whichever is actually closest (talk vs use)
    const dSpot = near
      ? Math.max(Math.abs(player.x - near.spot.x), Math.abs(player.y - near.spot.y))
      : Infinity;
    const dNpc = nearNpc
      ? Math.max(Math.abs(player.x - nearNpc.px), Math.abs(player.y - nearNpc.py))
      : Infinity;
    if (nearNpc && dNpc <= dSpot) {
      promptEl.textContent = "[E] Talk to " + nearNpc.name;
      promptEl.classList.remove("hidden");
    } else if (near) {
      promptEl.textContent = "[E] " + near.def.label;
      promptEl.classList.remove("hidden");
    } else {
      promptEl.classList.add("hidden");
    }
  });
}

// ---------- state ----------
const keys: Record<string, boolean> = {};
window.addEventListener("keydown", (e) => {
  const k2 = e.key.toLowerCase();
  if (["arrowup","arrowdown","arrowleft","arrowright"," "].includes(k2)) e.preventDefault();
  if (e.target instanceof HTMLInputElement) return; // typing in a field
  keys[k2] = true;
  if (k2 === "escape" && dialogueOpen) { closeDialogue(); return; }
  if (dialogueOpen) {
    if (k2 === "e" && !e.repeat) advanceDialogue();
    return;
  }
  if (k2 === "e" && !e.repeat && overlaysDown()) {
    const nearNpc = nearestNpc();
    const near = nearestInteractable();
    const dSpot = near
      ? Math.max(Math.abs(player.x - near.spot.x), Math.abs(player.y - near.spot.y))
      : Infinity;
    const dNpc = nearNpc
      ? Math.max(Math.abs(player.x - nearNpc.px), Math.abs(player.y - nearNpc.py))
      : Infinity;
    if (nearNpc && dNpc <= dSpot) openDialogue(nearNpc);
    else if (near) near.def.action();
  }
});
window.addEventListener("keyup", (e) => {
  if (e.target instanceof HTMLInputElement) return;
  keys[e.key.toLowerCase()] = false;
});

function overlaysDown(): boolean {
  return modal.classList.contains("hidden") && authOverlay.classList.contains("hidden")
    && !computerOpen && !whiteboardOpen && !arcadeOpen && !dialogueOpen;
}

let contracts: Contract[] = [];
const devAnswers: Record<string, string> = {};
const solved = new Set<string>();
let score = 0;
let attempts = 0;
let activeContract: Contract | null = null;

// ---------- supabase / auth ----------
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const CHECK_ENDPOINT = import.meta.env.VITE_CHECK_ANSWER_URL as string | undefined;

const supabase = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

let userId: string | null = null;

async function initAuth() {
  if (!supabase) return; // DEV MODE: no auth
  const { data: { session } } = await supabase.auth.getSession();
  if (session) await onSignedIn();
  else authOverlay.classList.remove("hidden");
  supabase.auth.onAuthStateChange(async (_event, s) => {
    if (s) { authOverlay.classList.add("hidden"); await onSignedIn(); }
    else { authOverlay.classList.remove("hidden"); userId = null; solved.clear(); score = 0; agentEl.textContent = "Agent K"; scoreEl.textContent = "0 pts"; }
  });
}

authBtn.addEventListener("click", async () => {
  if (!supabase) return;
  const email = authEmail.value.trim();
  if (!email) { setAuthStatus("Enter an email address.", "bad"); return; }
  authBtn.textContent = "SENDING…";
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: location.origin },
  });
  authBtn.textContent = "SEND MAGIC LINK";
  if (error) { setAuthStatus("Sign-in failed: " + error.message, "bad"); return; }
  setAuthStatus("Magic link sent to " + email + ". Open it in this browser to continue.", "ok");
});

authEmail.addEventListener("keydown", (e) => {
  if (e.key === "Enter") authBtn.click();
  e.stopPropagation();
});

function setAuthStatus(msg: string, cls: string) {
  authStatus.textContent = msg;
  authStatus.className = cls;
}

async function onSignedIn() {
  if (!supabase) return;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  userId = user.id;
  // Profile (created by trigger) → codename
  const { data: profile } = await supabase
    .from("profiles").select("codename").eq("id", userId).single();
  agentEl.textContent = profile?.codename ?? "Agent";
  codenameInput.value = profile?.codename ?? "";
  // Own correct submissions → solved set + score
  const { data: rows } = await supabase
    .from("submissions").select("contract_slug").eq("profile_id", userId).eq("correct", true);
  solved.clear();
  score = 0;
  for (const r of rows ?? []) {
    solved.add(r.contract_slug);
    const c = contracts.find((x) => x.slug === r.contract_slug);
    score += c?.points ?? 0;
  }
  scoreEl.textContent = score + " pts";
  renderList();
}

codenameSave.addEventListener("click", async () => {
  if (!supabase || !userId) return;
  const name = codenameInput.value.trim();
  if (!name) { codenameFeedback.textContent = "Pick a codename, Agent."; codenameFeedback.className = "bad"; return; }
  const { error } = await supabase.from("profiles").update({ codename: name }).eq("id", userId);
  if (error) {
    codenameFeedback.textContent = error.message.includes("duplicate")
      ? "Codename taken. You are not the only agent with taste."
      : "Rename failed: " + error.message;
    codenameFeedback.className = "bad";
    return;
  }
  agentEl.textContent = name;
  codenameFeedback.textContent = "Codename updated. ✔";
  codenameFeedback.className = "ok";
});

logoutBtn.addEventListener("click", async () => {
  if (!supabase) return;
  await supabase.auth.signOut();
  modal.classList.add("hidden");
});

// ---------- console UI ----------
function openConsole() {
  modal.classList.remove("hidden");
  showTab("contracts");
}
(document.getElementById("console-close") as HTMLElement).onclick = () => modal.classList.add("hidden");

for (const t of tabs) {
  t.addEventListener("click", () => showTab(t.dataset.tab!));
}

function showTab(name: string) {
  for (const t of tabs) t.classList.toggle("active", t.dataset.tab === name);
  listEl.classList.toggle("hidden", name !== "contracts");
  detailEl.classList.add("hidden");
  leaderboardEl.classList.toggle("hidden", name !== "leaderboard");
  agentIdEl.classList.toggle("hidden", name !== "agent");
  if (name === "contracts") renderList();
  if (name === "leaderboard") loadLeaderboard();
  if (name === "agent") codenameFeedback.textContent = "";
}

function renderList() {
  listEl.innerHTML = "";
  for (const c of contracts) {
    const li = document.createElement("li");
    if (solved.has(c.slug)) li.classList.add("done");
    li.innerHTML = `<span class="cl-title">${c.emoji} ${c.title}</span>` +
      `<span class="cl-pts">${solved.has(c.slug) ? "✔ " : ""}${c.points} pts · ${c.difficulty}</span>`;
    li.onclick = () => showDetail(c);
    listEl.appendChild(li);
  }
}

function showDetail(c: Contract) {
  activeContract = c;
  attempts = 0;
  renderList();
  listEl.classList.add("hidden");
  detailEl.classList.remove("hidden");
  (document.getElementById("cd-title") as HTMLElement).textContent = `${c.emoji} ${c.title}`;
  (document.getElementById("cd-meta") as HTMLElement).textContent =
    `${c.discipline} · ${c.difficulty} · ${c.points} pts`;
  (document.getElementById("cd-brief") as HTMLElement).textContent = c.brief;
  (document.getElementById("cd-hint") as HTMLElement).classList.add("hidden");
  (document.getElementById("cd-answer") as HTMLInputElement).value = "";
  const fb = document.getElementById("cd-feedback") as HTMLElement;
  fb.textContent = solved.has(c.slug) ? "Already solved. ✔" : "";
  setTimeout(() => (document.getElementById("cd-answer") as HTMLInputElement).focus(), 30);
}

(document.getElementById("cd-back") as HTMLElement).onclick = () => showTab("contracts");

async function loadLeaderboard() {
  leaderboardList.innerHTML = "<li><em>Loading…</em></li>";
  let rows: { codename: string; points: number }[] | null = null;
  if (supabase) {
    const { data } = await supabase
      .from("leaderboard")
      .select("codename, points")
      .order("points", { ascending: false })
      .limit(10);
    rows = data;
  }
  if (!rows || rows.length === 0) {
    leaderboardList.innerHTML = "<li><em>No scores yet. Be the first agent on the board.</em></li>";
    return;
  }
  leaderboardList.innerHTML = "";
  rows.forEach((r, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="lb-rank">${i + 1}.</span><span class="lb-name">${esc(r.codename)}</span><span class="lb-pts">${r.points} pts</span>`;
    leaderboardList.appendChild(li);
  });
}

function esc(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

// ---------- answer checking ----------
async function checkAnswer(c: Contract, answer: string): Promise<{ correct: boolean; error?: string }> {
  if (CHECK_ENDPOINT && supabase) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { correct: false, error: "Sign in first, Agent." };
    const res = await fetch(CHECK_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + session.access_token,
      },
      body: JSON.stringify({ slug: c.slug, answer }),
    });
    if (res.status === 401) return { correct: false, error: "Sign-in expired. Refresh and try again." };
    if (res.status === 429) return { correct: false, error: "Too many attempts. Take a breath, Agent." };
    if (!res.ok) {
      // Surface the server's real message so failures are diagnosable.
      let msg = "The console is unreachable (HTTP " + res.status + ").";
      try {
        const body = await res.json();
        if (body && body.error) msg = body.error + " (HTTP " + res.status + ")";
      } catch { /* not JSON: keep default */ }
      return { correct: false, error: msg };
    }
    return res.json();
  }
  // DEV MODE: local compare against gitignored answers.dev.json
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const ans = devAnswers[c.slug];
  return { correct: !!ans && norm(ans) === norm(answer) };
}

(document.getElementById("cd-submit") as HTMLElement).onclick = async () => {
  const c = activeContract;
  if (!c) return;
  const input = document.getElementById("cd-answer") as HTMLInputElement;
  const fb = document.getElementById("cd-feedback") as HTMLElement;
  fb.textContent = "Checking…";
  fb.className = "";
  try {
    const res = await checkAnswer(c, input.value);
    if (res.error) { fb.textContent = res.error; fb.className = "bad"; return; }
    if (res.correct) {
      if (!solved.has(c.slug)) {
        solved.add(c.slug);
        score += c.points;
        scoreEl.textContent = score + " pts";
      }
      fb.textContent = "Correct! +" + c.points + " points.";
      fb.className = "ok";
      setTimeout(() => showTab("contracts"), 1200);
    } else {
      attempts++;
      fb.textContent = "Incorrect, Agent. Look again.";
      fb.className = "bad";
      if (attempts >= 3) {
        const hint = document.getElementById("cd-hint") as HTMLElement;
        hint.textContent = "Hint: " + c.hint;
        hint.classList.remove("hidden");
      }
    }
  } catch {
    fb.textContent = "Connection error. Try again.";
    fb.className = "bad";
  }
};

(document.getElementById("cd-answer") as HTMLInputElement).addEventListener("keydown", (e) => {
  if (e.key === "Enter") (document.getElementById("cd-submit") as HTMLElement).click();
  e.stopPropagation();
});

// ---------- content ----------
async function loadContracts() {
  const res = await fetch("/content/contracts/index.json");
  contracts = await res.json();
}

async function loadDevAnswers() {
  try {
    const r = await fetch("/content/contracts/answers.dev.json");
    if (r.ok) Object.assign(devAnswers, await r.json());
  } catch { /* absent in prod: answers come from the server */ }
}

// ---------- boot ----------
scoreEl.textContent = "0 pts";
agentEl.textContent = "Agent K";
buildWorld()
  .then(() => loadContracts())
  .then(loadDevAnswers)
  .then(initAuth)
  .catch((err) => {
    console.error(err);
    promptEl.textContent = "World failed to load: " + err.message;
    promptEl.classList.remove("hidden");
  });

// ---------- SERPENT OS computer bridge (src/computer.js) ----------
// The desk computer UI talks to the game exclusively through this API.
(window as any).SERPENT_GAME = {
  isAuthed: () => !supabase || !!userId,
  getContracts: () => contracts,
  isSolved: (slug: string) => solved.has(slug),
  submitAnswer: async (c: Contract, answer: string) => {
    let res: { correct: boolean; error?: string };
    try {
      res = await checkAnswer(c, answer);
    } catch {
      return { correct: false, error: "Connection error. Try again." };
    }
    if (res.correct && !solved.has(c.slug)) {
      solved.add(c.slug);
      score += c.points;
      scoreEl.textContent = score + " pts";
    }
    return res;
  },
  getLeaderboard: async () => {
    if (!supabase) return [];
    const { data } = await supabase
      .from("leaderboard")
      .select("codename, points, contracts_solved")
      .order("points", { ascending: false })
      .limit(50);
    return data ?? [];
  },
  getCodename: () => codenameInput.value || agentEl.textContent || "Agent K",
  saveCodename: async (name: string) => {
    if (!supabase || !userId) return { ok: false, error: "Sign in first, Agent." };
    const { error } = await supabase.from("profiles").update({ codename: name }).eq("id", userId);
    if (error) {
      return {
        ok: false,
        error: error.message.includes("duplicate")
          ? "Codename taken. You are not the only agent with taste."
          : "Rename failed: " + error.message,
      };
    }
    agentEl.textContent = name;
    codenameInput.value = name;
    return { ok: true };
  },
  logout: () => logoutBtn.click(),
};
