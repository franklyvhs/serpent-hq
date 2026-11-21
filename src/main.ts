// ============================================================
// SERPENT HQ — v0.3 (a Hacktoria game)
// M3a: KAPLAY engine renders the world (world data in world.ts);
// DOM still owns the console modal, auth and HUD.
// ============================================================

import kaplay from "kaplay";
import { createClient } from "@supabase/supabase-js";
import {
  TILE, MAP_W, MAP_H, MAP, CONSOLE, SPAWN, PLAYER_SPEED,
  EMOJI, TILE_COLOR, walkable, nearConsole, hexRGB,
} from "./world";

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

// ---------- kaplay world ----------
const k = kaplay({
  width: 640,
  height: 448,
  canvas,
  background: [5, 8, 15],
  crisp: true,
  global: false,
  debug: false,
});

// Static level: one colored rect per tile (+ emoji decoration on top).
for (let y = 0; y < MAP_H; y++) {
  for (let x = 0; x < MAP_W; x++) {
    const ch = MAP[y][x] ?? ".";
    const [r, g, b] = hexRGB(TILE_COLOR[ch] ?? TILE_COLOR["."]);
    k.add([k.pos(x * TILE, y * TILE), k.rect(TILE, TILE), k.color(r, g, b)]);
    if (EMOJI[ch]) {
      const deco = k.add([
        k.pos(x * TILE + TILE / 2, y * TILE + TILE / 2),
        k.text(EMOJI[ch], { size: 16 }),
        k.anchor("center"),
        k.color(120, 140, 160),
      ]);
      if (ch === "#") deco.color = k.rgb(34, 211, 238);
    }
  }
}

// Contract console hotspot (drawn once, above tiles)
k.add([
  k.pos(CONSOLE.x * TILE + TILE / 2, CONSOLE.y * TILE + TILE / 2),
  k.text("\u{1F5A5}\uFE0F", { size: 16 }),
  k.anchor("center"),
]);

// Player (placeholder agent glyph; gets a sprite sheet in M3)
const playerObj = k.add([
  k.pos(SPAWN.x * TILE, SPAWN.y * TILE),
  k.text("\u{1F575}\uFE0F", { size: 20 }),
  k.anchor("center"),
]);

// ---------- state ----------
const keys: Record<string, boolean> = {};
window.addEventListener("keydown", (e) => {
  const k2 = e.key.toLowerCase();
  if (["arrowup","arrowdown","arrowleft","arrowright"," "].includes(k2)) e.preventDefault();
  if (e.target instanceof HTMLInputElement) return; // typing in a field
  keys[k2] = true;
  if (k2 === "e" && overlaysDown() && nearConsole(player.x, player.y)) openConsole();
});
window.addEventListener("keyup", (e) => {
  if (e.target instanceof HTMLInputElement) return;
  keys[e.key.toLowerCase()] = false;
});

// Movement runs in KAPLAY's update loop instead of requestAnimationFrame.
const player = { x: SPAWN.x, y: SPAWN.y }; // tile units

function overlaysDown(): boolean {
  return modal.classList.contains("hidden") && authOverlay.classList.contains("hidden");
}

k.onUpdate(() => {
  if (!overlaysDown()) return;
  const dt = k.dt();
  const dx = (keys["arrowright"] || keys["d"] ? 1 : 0) - (keys["arrowleft"] || keys["a"] ? 1 : 0);
  const dy = (keys["arrowdown"] || keys["s"] ? 1 : 0) - (keys["arrowup"] || keys["w"] ? 1 : 0);
  const nx = player.x + dx * PLAYER_SPEED * dt;
  const ny = player.y + dy * PLAYER_SPEED * dt;
  if (dx && walkable(nx, player.y)) player.x = nx;
  if (dy && walkable(player.x, ny)) player.y = ny;
  playerObj.pos.x = player.x * TILE;
  playerObj.pos.y = player.y * TILE;
  promptEl.classList.toggle("hidden", !nearConsole(player.x, player.y));
});

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
loadContracts()
  .then(loadDevAnswers)
  .then(initAuth);
