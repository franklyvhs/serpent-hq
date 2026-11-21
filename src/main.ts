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
document.title = "SERPENT HQ - dbg-walk-1";
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
let consolePos: Vec = { x: 0, y: 0 }; // legacy spot ref (kept for compatibility)
let facing: "right" | "up" | "left" | "down" = "down";
let walkTimer = 0; // seconds, drives the manual walk animation
const range = (n: number) => Array.from({ length: n }, (_i) => _i);
const STATIC_FRAME: Record<string, number> = { right: 0, up: 1, left: 2, down: 3 };
// Walk band (sheet band row 2) frame ranges per direction, first frame of 6.
const WALK_FRAME: Record<string, number> = { right: 28, up: 34, left: 40, down: 46 };
const WALK_FPS = 10; // animation speed, frames per second

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

const INTERACTABLES: Record<string, { label: string; action: () => void }> = {
  "contract-console": { label: "Mission console", action: () => openConsole() },
  "notice-board": {
    label: "HQ notice board",
    action: () => toast("The board reads: \"Trust no one. Verify everything. New contracts drop Fridays.\""),
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

  // LimeZu Modern Interiors walk sheet: 16x32 frames. Bands: row 0 =
  // static [right, up, left, down]; rows 1 (idle) and 2 (walk) hold 6
  // frames per direction, ordered right/up/left/down. Frames are uv
  // quads (the sheet is 896x656 -> 56 cols, half-rows of 32px).
  const FW = 16 / 896, FH = 32 / 656;
  const q = (col: number, band: number) => ({ x: col * FW, y: band * 32 / 656, w: FW, h: FH });
  const frames = [
    q(0, 0), q(1, 0), q(2, 0), q(3, 0), // static right/up/left/down
    ...range(24).map((i) => q(i, 1)),    // idle  (indices 4-27)
    ...range(24).map((i) => q(i, 2)),    // walk  (indices 28-51)
  ];
  await k.loadSprite(
    "player",
    "/assets/limezu/moderninteriors-win/2_Characters/Character_Generator/0_Premade_Characters/16x16/Premade_Character_01.png",
    { frames },
  );

  playerObj = k.add([
    k.pos(player.x, player.y),
    k.sprite("player", { frame: STATIC_FRAME.down }),
    k.anchor("bot"),
  ]);

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

  // DEBUG strip (dbg-walk-1): screen-space row of frames, fixed = ignores
  // camera. 0-3 static, 4/10/27 idle band, 28/34/40/46/51 walk band.
  const testFrames = [0, 1, 2, 3, 4, 10, 27, 28, 34, 40, 46, 51];
  for (let i = 0; i < testFrames.length; i++) {
    k.add([
      k.fixed(),
      k.pos(16 + i * 20, 60),
      k.sprite("player", { frame: testFrames[i] }),
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
    if (dx > 0) facing = "right";
    else if (dx < 0) facing = "left";
    else if (dy > 0) facing = "down";
    else if (dy < 0) facing = "up";
    const moving = dx !== 0 || dy !== 0;
    if (moving) {
      // DEBUG (dbg-walk-1): keep the static pose while moving, to test
      // whether invisibility comes from the walk frames or from movement.
      walkTimer += dt;
      playerObj.frame = STATIC_FRAME[facing];
    } else {
      walkTimer = 0;
      playerObj.frame = STATIC_FRAME[facing];
    }
    updateCamera();
    if (toastActive) {
      if (performance.now() > toastUntil) {
        toastActive = false;
        promptEl.classList.add("hidden");
      }
      return;
    }
    const near = nearestInteractable();
    if (near) {
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
  if (k2 === "e" && !e.repeat && overlaysDown()) {
    const near = nearestInteractable();
    if (near) near.def.action();
  }
});
window.addEventListener("keyup", (e) => {
  if (e.target instanceof HTMLInputElement) return;
  keys[e.key.toLowerCase()] = false;
});

function overlaysDown(): boolean {
  return modal.classList.contains("hidden") && authOverlay.classList.contains("hidden");
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
