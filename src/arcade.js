// ============================================================
// SERPENT HQ — SNAKELOR.EXE (arcade machine mini game)
// A standalone SERPENT OS 95 window on #arcade-overlay, opened
// from the in-world arcade machine (Tiled object "arcade-machine").
// Snake in Win95 chrome: arrow keys / WASD, Enter to (re)start,
// Esc to walk away. High score persists in localStorage only
// (arcade scores are deliberately NOT anti-cheat protected).
// Talks to the game via "serpent-arcade" {open} events, same
// pattern as serpent-computer / serpent-whiteboard.
// ============================================================

(() => {
  if (document.getElementById("arcade-overlay")) return;

  const COLS = 20;
  const ROWS = 16;
  const CELL = 16;
  const BASE_MS = 150; // tick at score 0, speeds up as you eat
  const MIN_MS = 70;

  const overlay = document.createElement("div");
  overlay.id = "arcade-overlay";
  overlay.className = "hidden";
  overlay.innerHTML = `
    <div id="arcade-win">
      <div class="arc-titlebar">
        <span class="t-text">SNAKELOR.EXE — SERPENT Entertainment Division</span>
        <button class="arc-close tb-btn" title="Walk away">✕</button>
      </div>
      <div class="arc-menubar">
        <span class="am-title">Game</span>
        <span class="am-title am-help">Help</span>
      </div>
      <div class="arc-body">
        <canvas id="arcade-canvas" width="${COLS * CELL}" height="${ROWS * CELL}"></canvas>
        <div class="arc-status">
          <span>SCORE <b id="arc-score">0</b></span>
          <span>HI <b id="arc-hi">0</b></span>
          <span id="arc-state">PRESS ENTER TO PLAY</span>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const canvas = overlay.querySelector("#arcade-canvas");
  const ctx = canvas.getContext("2d");
  const scoreEl = overlay.querySelector("#arc-score");
  const hiEl = overlay.querySelector("#arc-hi");
  const stateEl = overlay.querySelector("#arc-state");
  const helpMenu = overlay.querySelector(".am-help");

  let open = false;
  let running = false;
  let snake = [];
  let dir = { x: 1, y: 0 };
  let pendingDir = { x: 1, y: 0 };
  let food = { x: 0, y: 0 };
  let score = 0;
  let hi = Number(localStorage.getItem("snakelor_hi") || 0);
  hiEl.textContent = String(hi);
  let tickMs = BASE_MS;
  let lastTick = 0;
  let raf = 0;

  function dispatch(o) {
    window.dispatchEvent(new CustomEvent("serpent-arcade", { detail: { open: o } }));
  }

  function placeFood() {
    let fx = 0, fy = 0;
    do {
      fx = Math.floor(Math.random() * COLS);
      fy = Math.floor(Math.random() * ROWS);
    } while (snake.some((s) => s.x === fx && s.y === fy));
    food = { x: fx, y: fy };
  }

  function reset() {
    snake = [{ x: 6, y: 8 }, { x: 5, y: 8 }, { x: 4, y: 8 }];
    dir = { x: 1, y: 0 };
    pendingDir = { x: 1, y: 0 };
    score = 0;
    tickMs = BASE_MS;
    placeFood();
    scoreEl.textContent = "0";
  }

  function start() {
    reset();
    running = true;
    stateEl.textContent = "GOOD LUCK, AGENT";
    lastTick = performance.now();
  }

  function gameOver() {
    running = false;
    if (score > hi) {
      hi = score;
      localStorage.setItem("snakelor_hi", String(hi));
      hiEl.textContent = String(hi);
    }
    stateEl.textContent = "SNAKELOR FEEDS. ENTER TO RETRY";
  }

  function tick() {
    dir = pendingDir;
    const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
    const hitWall = head.x < 0 || head.y < 0 || head.x >= COLS || head.y >= ROWS;
    const hitSelf = snake.some((s) => s.x === head.x && s.y === head.y);
    if (hitWall || hitSelf) { gameOver(); return; }
    snake.unshift(head);
    if (head.x === food.x && head.y === food.y) {
      score += 10;
      scoreEl.textContent = String(score);
      tickMs = Math.max(MIN_MS, BASE_MS - Math.floor(score / 10) * 6);
      placeFood();
    } else {
      snake.pop();
    }
  }

  function draw() {
    // CRT-dark field
    ctx.fillStyle = "#02120a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // faint grid
    ctx.fillStyle = "rgba(255,255,255,0.03)";
    for (let x = 0; x < COLS; x++)
      for (let y = 0; y < ROWS; y++)
        if ((x + y) % 2 === 0) ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
    // food (serpent egg)
    ctx.fillStyle = "#ff4040";
    ctx.beginPath();
    ctx.arc(food.x * CELL + CELL / 2, food.y * CELL + CELL / 2, CELL / 2 - 3, 0, Math.PI * 2);
    ctx.fill();
    // snake (snakelor itself)
    snake.forEach((s, i) => {
      ctx.fillStyle = i === 0 ? "#7dff7d" : i % 2 === 0 ? "#3fbf3f" : "#2f9f2f";
      ctx.fillRect(s.x * CELL + 1, s.y * CELL + 1, CELL - 2, CELL - 2);
    });
  }

  function loop(now) {
    if (!open) return;
    if (running && now - lastTick >= tickMs) {
      lastTick = now;
      tick();
    }
    draw();
    raf = requestAnimationFrame(loop);
  }

  function setOpen(o) {
    if (open === o) return;
    open = o;
    overlay.classList.toggle("hidden", !o);
    dispatch(o);
    if (o) {
      reset();
      running = false;
      stateEl.textContent = "PRESS ENTER TO PLAY";
      lastTick = performance.now();
      raf = requestAnimationFrame(loop);
    } else {
      running = false;
      cancelAnimationFrame(raf);
    }
  }

  window.addEventListener("keydown", (e) => {
    if (!open) return;
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(e.key.toLowerCase()))
      e.preventDefault();
    if (e.target instanceof HTMLInputElement) return;
    const kk = e.key.toLowerCase();
    if (kk === "escape") { setOpen(false); return; }
    if (kk === "enter") { if (!running) start(); return; }
    let nd = null;
    if (kk === "arrowup" || kk === "w") nd = { x: 0, y: -1 };
    else if (kk === "arrowdown" || kk === "s") nd = { x: 0, y: 1 };
    else if (kk === "arrowleft" || kk === "a") nd = { x: -1, y: 0 };
    else if (kk === "arrowright" || kk === "d") nd = { x: 1, y: 0 };
    if (nd && running) {
      // no 180-degree turns into yourself
      if (nd.x !== -dir.x || nd.y !== -dir.y) pendingDir = nd;
    }
  });

  (overlay.querySelector(".arc-close")).onclick = () => setOpen(false);
  helpMenu.onclick = () => {
    alert("SNAKELOR.EXE\n\nArrow keys or WASD to steer. Eat the serpent eggs.\nDo not eat yourself. SERPENT is family.\n\nEsc walks away. High score is stored on this machine only. (Gary has the record. Gary says.)");
  };

  window.SNAKELOR = {
    open: () => setOpen(true),
    close: () => setOpen(false),
  };
})();
