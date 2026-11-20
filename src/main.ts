// ============================================================
// SERPENT HQ — v0 skeleton (a Hacktoria game)
// Custom canvas renderer; Kaplay + Tiled replace this in M3.
// ============================================================

const TILE = 32;
const MAP_W = 20;
const MAP_H = 14;

// Legend: # wall  . floor  c carpet  B briefing table  s server rack  a alien flora
const MAP = [
  "####################",
  "#..................#",
  "#.........s....s...#",
  "#..................#",
  "#....BBBBB.....#..s#",
  "#....BBBBB.....#...#",
  "#....BBBBB.....s...#",
  "#..................#",
  "#..................#",
  "#.......c......s...#",
  "#......cccc........#",
  "#......cccc....a...#",
  "#..........a.......#",
  "####################",
];

// Central contract console (interactive hotspot)
const CONSOLE = { x: 8, y: 8 };

// Contract content (public form; in dev mode answers are checked locally,
// in prod the Supabase Edge Function checks them server-side).
interface Contract {
  slug: string;
  emoji: string;
  title: string;
  discipline: string;
  difficulty: "Easy" | "Medium" | "Hard";
  points: number;
  brief: string;
  hint: string;
  answer?: string;
}

const canvas = document.getElementById("game") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const promptEl = document.getElementById("prompt")!;
const modal = document.getElementById("console-modal")!;
const listEl = document.getElementById("contract-list")!;
const detailEl = document.getElementById("contract-detail")!;
const scoreEl = document.getElementById("hud-score")!;
const agentEl = document.getElementById("hud-agent")!;

const keys: Record<string, boolean> = {};
window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
  keys[k] = true;
  if (k === "e" && modal.classList.contains("hidden") && nearConsole()) openConsole();
});
window.addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; });

const player = { x: 9.5, y: 10.5, speed: 3.2 }; // tile units, y is row

let contracts: Contract[] = [];
const solved = new Set<string>();
let score = 0;
let attempts = 0;
let activeContract: Contract | null = null;

function walkable(x: number, y: number): boolean {
  const tx = Math.floor(x), ty = Math.floor(y);
  if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return false;
  const ch = MAP[ty][tx];
  if (tx === CONSOLE.x && ty === CONSOLE.y) return false; // console is solid
  return ch === "." || ch === "c";
}

async function loadContracts() {
  const res = await fetch("/content/contracts/index.json");
  contracts = await res.json();
}

function nearConsole(): boolean {
  return Math.abs(player.x - (CONSOLE.x + 0.5)) <= 1.3 && Math.abs(player.y - (CONSOLE.y + 0.5)) <= 1.3;
}

// ——— rendering ———
function tileColor(ch: string): string {
  switch (ch) {
    case "#": return "#1e293b";
    case "c": return "#3b1145";
    case "B": return "#475569";
    case "s": return "#0f172a";
    case "a": return "#14532d";
    default: return "#0b1626";
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < MAP_H; y++) {
    const row = MAP[y];
    for (let x = 0; x < MAP_W; x++) {
      const ch = row[x] ?? ".";
      ctx.fillStyle = tileColor(ch);
      ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
      ctx.font = "16px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      if (ch === "B") ctx.fillText("🖥️", x * TILE + 16, y * TILE + 16);
      if (ch === "s") ctx.fillText("🗄️", x * TILE + 16, y * TILE + 16);
      if (ch === "a") ctx.fillText("🛸", x * TILE + 16, y * TILE + 16);
      if (ch === "#") { ctx.fillStyle = "rgba(34,211,238,0.15)"; ctx.fillText("▓", x * TILE + 16, y * TILE + 16); }
    }
  }
  // console
  ctx.font = "18px sans-serif";
  ctx.fillText("🖥️", CONSOLE.x * TILE + 16, CONSOLE.y * TILE + 16);
  // player
  ctx.font = "20px sans-serif";
  ctx.fillText("🕵️", player.x * TILE, player.y * TILE);
}

// ——— movement ———
let last = performance.now();
function update(now: number) {
  const dt = (now - last) / 1000;
  last = now;
  if (modal.classList.contains("hidden")) {
    const dx = (keys["arrowright"] || keys["d"] ? 1 : 0) - (keys["arrowleft"] || keys["a"] ? 1 : 0);
    const dy = (keys["arrowdown"] || keys["s"] ? 1 : 0) - (keys["arrowup"] || keys["w"] ? 1 : 0);
    const nx = player.x + dx * player.speed * dt;
    const ny = player.y + dy * player.speed * dt;
    if (dx && walkable(nx, player.y)) player.x = nx;
    if (dy && walkable(player.x, ny)) player.y = ny;
    promptEl.classList.toggle("hidden", !nearConsole());
  }
  draw();
  requestAnimationFrame(update);
}

// ——— contract console UI ———
function openConsole() {
  modal.classList.remove("hidden");
  showList();
}
(document.getElementById("console-close") as HTMLElement).onclick = () => modal.classList.add("hidden");

function showList() {
  detailEl.classList.add("hidden");
  listEl.classList.remove("hidden");
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
  focusAnswer();
}

function focusAnswer() {
  const el = document.getElementById("cd-answer") as HTMLInputElement;
  setTimeout(() => el.focus(), 30);
}

(document.getElementById("cd-back") as HTMLElement).onclick = showList;

async function checkAnswer(c: Contract, answer: string): Promise<{ correct: boolean }> {
  const endpoint = import.meta.env.VITE_CHECK_ANSWER_URL;
  if (endpoint) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: c.slug, answer }),
    });
    return res.json();
  }
  // DEV MODE: local compare (strip answers from index.json in prod builds!)
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  return { correct: !!c.answer && norm(c.answer) === norm(answer) };
}

(document.getElementById("cd-submit") as HTMLElement).onclick = async () => {
  const c = activeContract;
  if (!c) return;
  const input = document.getElementById("cd-answer") as HTMLInputElement;
  const fb = document.getElementById("cd-feedback") as HTMLElement;
  fb.textContent = "Checking…";
  fb.className = "";
  try {
    const { correct } = await checkAnswer(c, input.value);
    if (correct) {
      solved.add(c.slug);
      score += c.points;
      scoreEl.textContent = `${score} pts`;
      fb.textContent = `Correct! +${c.points} points.`;
      fb.className = "ok";
      setTimeout(showList, 1200);
    } else {
      attempts++;
      fb.textContent = "Incorrect, Agent. Look again.";
      fb.className = "bad";
      if (attempts >= 3) {
        const hint = document.getElementById("cd-hint") as HTMLElement;
        hint.textContent = `Hint: ${c.hint}`;
        hint.classList.remove("hidden");
      }
    }
  } catch {
    fb.textContent = "Connection error. Try again.";
    fb.className = "bad";
  }
};

(document.getElementById("cd-answer") as HTMLElement).addEventListener("keydown", (e) => {
  if (e.key === "Enter") (document.getElementById("cd-submit") as HTMLElement).click();
  e.stopPropagation();
});

// ——— boot ———
const agent = new URLSearchParams(location.search).get("agent") || "Agent K";
agentEl.textContent = agent;
scoreEl.textContent = "0 pts";
loadContracts().then(() => requestAnimationFrame(update));
