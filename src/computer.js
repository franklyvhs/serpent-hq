// ============================================================
// SERPENT OS 95 — the desk computer (SERPENT HQ in-game)
// Vanilla JS module: builds and owns the #computer-overlay DOM,
// boots (BIOS POST -> splash -> fingerprint), then shows the
// SERPENT OS desktop with draggable/resizable program windows.
// Talks to the game (src/main.ts) through window.SERPENT_GAME:
//   isAuthed(), getContracts(), isSolved(slug),
//   submitAnswer(contract, answer) -> {correct, error},
//   getLeaderboard() -> [{codename, points, contracts_solved}],
//   getCodename(), saveCodename(name), logout(), getSession()
// Exposes window.SERPENT_COMPUTER = { open(), close(), isOpen() }
// ============================================================
(function () {
  "use strict";

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }
  function esc(s) {
    var d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  // ---------- game bridge (set by main.ts; guarded everywhere) ----------
  function game() { return window.SERPENT_GAME || null; }

  // ---------- overlay skeleton ----------
  var overlay = el("div");
  overlay.id = "computer-overlay";
  overlay.className = "hidden";
  overlay.innerHTML =
    '<div id="boot"><span class="cursor"></span></div>' +
    '<div id="splash">' +
    '  <div class="osname"><span class="sn">SERPENT</span> OS</div>' +
    '  <div class="ver">Version 4.0.95 &nbsp;\u00b7&nbsp; Tiberian Dynamics Worldwide</div>' +
    '  <div class="copyright">\u00a9 1987-1996 Tiberian Dynamics. Do not distribute.<br>Unauthorized access is monitored, logged, and mildly resented.</div>' +
    '  <div class="bar-outer" id="bootbar"></div>' +
    '</div>' +
    '<div id="fingerprint">' +
    '  <div class="fp-box">' +
    '    <svg viewBox="0 0 130 160" width="130" height="160">' +
    '      <g stroke="#2e8b57" stroke-width="2.5" fill="none" stroke-linecap="round">' +
    '        <ellipse cx="65" cy="88" rx="14" ry="24"/>' +
    '        <ellipse cx="65" cy="88" rx="26" ry="40"/>' +
    '        <ellipse cx="65" cy="90" rx="38" ry="56"/>' +
    '        <ellipse cx="65" cy="92" rx="50" ry="70" stroke-dasharray="9 7"/>' +
    '        <path d="M65 64 q-6 8 -5 20 M65 64 q6 8 5 20"/>' +
    '        <path d="M50 110 q10 8 30 0" />' +
    '      </g>' +
    '    </svg>' +
    '    <div class="beam"></div>' +
    '  </div>' +
    '  <div class="fp-status" id="fp-status">PLACE FINGER ON SCANNER</div>' +
    '  <div class="fp-sub">SERPENT SECURE SHELL \u00b7 biometric station TDW-88<br>authorized personnel only \u00b7 have a nice day, agent</div>' +
    '</div>' +
    '<div id="desktop" class="hidden">' +
    '  <div class="icons">' +
    '    <div class="icon" id="ico-cm"><div class="glyph">\u{1F4BC}</div>Contract Manager</div>' +
    '    <div class="icon" id="ico-score"><div class="glyph">\u{1F3C6}</div>Scoreboard</div>' +
    '    <div class="icon" id="ico-note"><div class="glyph">\u{1F4C4}</div>README.TXT</div>' +
    '    <div class="icon" id="ico-agent"><div class="glyph">\u{1F511}</div>Agent ID</div>' +
    '  </div>' +
    '  <div class="window hidden" id="agentwin">' +
    '    <div class="titlebar"><span>\u{1F511}</span><span class="t-text">AGENT ID \u2014 SERPENT Personnel</span><button class="tb-btn" data-close="agentwin">\u2715</button></div>' +
    '    <div class="win-body">' +
    '      <div class="agent-row"><input class="field" id="agent-codename" style="flex:1" maxlength="24" placeholder="codename"><button class="btn" id="agent-save">Rename</button></div>' +
    '      <div class="login-msg" id="agent-msg"></div>' +
    '      <hr style="border:0;border-top:1px solid #808080;border-bottom:1px solid #fff;margin:10px 0">' +
    '      <button class="btn" id="agent-logout" style="width:100%">Sign Out</button>' +
    '    </div>' +
    '    <div class="statusbar"><span>personnel file</span><span>TDW-88</span></div>' +
    '  </div>' +
    '</div>' +
    '<div id="taskbar" class="hidden">' +
    '  <button class="btn" id="startbtn"><span class="sg">\u25B6</span> Start</button>' +
    '  <div id="taskitems"></div>' +
    '  <div id="tray"><span>\u{1F50A}</span><span id="clock">--:--</span></div>' +
    '</div>' +
    '<div id="startmenu">' +
    '  <div class="band">SERPENT 95</div>' +
    '  <ul>' +
    '    <li data-open="cmwin">\u{1F4BC} Contract Manager</li>' +
    '    <li data-open="scorewin">\u{1F3C6} Scoreboard</li>' +
    '    <li data-open="notewin">\u{1F4C4} README.TXT</li>' +
    '    <li data-open="agentwin">\u{1F511} Agent ID</li>' +
    '    <hr>' +
    '    <li id="menu-shutdown">\u{1F6D1} Shut Down (leave desk)</li>' +
    '    <li id="menu-reboot">\u{1F504} Restart (replay boot)</li>' +
    '  </ul>' +
    '</div>' +
    '<div id="dropdown-holder"></div>';
  document.body.appendChild(overlay);

  // windows built lazily on first open (templates depend on nothing dynamic)
  function buildWindows() {
    if ($("#cmwin")) return;
    var desk = $("#desktop");

    var cm = el("div", "window hidden");
    cm.id = "cmwin";
    cm.innerHTML =
      '<div class="titlebar"><span>\u{1F4BC}</span><span class="t-text">SERPENT Contract Manager</span><button class="tb-btn" data-close="cmwin">\u2715</button></div>' +
      '<div class="menubar" id="cm-menu">' +
      '  <div class="mtitle" data-menu="cm-file">File</div>' +
      '  <div class="mtitle" data-menu="cm-contracts">Contracts</div>' +
      '  <div class="mtitle" data-menu="cm-help">Help</div>' +
      '  <div style="flex:1"></div>' +
      '  <div style="padding:2px 8px;color:#606;font-size:11px;" id="cm-count"></div>' +
      '</div>' +
      '<div class="win-body">' +
      '  <div class="cm-split">' +
      '    <div class="cm-list" id="cm-list"></div>' +
      '    <div class="cm-detail">' +
      '      <h3 id="cm-title"></h3>' +
      '      <div class="tagline" id="cm-tag"></div>' +
      '      <div class="brief" id="cm-brief"></div>' +
      '      <div class="gb us">' +
      '        <span class="cap">Submit Solution</span>' +
      '        <div class="gb-row">' +
      '          <input class="field" id="cm-ans" style="flex:1;min-width:80px;" placeholder="type your solution and press Enter">' +
      '          <button class="btn" id="cm-submit">Submit</button>' +
      '        </div>' +
      '        <div class="login-msg" id="cm-msg"></div>' +
      '      </div>' +
      '      <div class="gb us" id="cm-hints-gb">' +
      '        <span class="cap">Hints</span>' +
      '        <div class="gb-row">' +
      '          <span class="medal gold" id="cm-medal">\u{1F3C5} Medal: GOLD (full points)</span>' +
      '          <button class="btn" id="cm-hint-btn" style="margin-left:auto;">Get Hint</button>' +
      '        </div>' +
      '        <div class="hintline" id="cm-hints"></div>' +
      '      </div>' +
      '    </div>' +
      '  </div>' +
      '</div>' +
      '<div class="statusbar"><span id="cm-status"></span><span>FRANKFURT-1 uplink OK</span></div>';

    var sc = el("div", "window hidden");
    sc.id = "scorewin";
    sc.innerHTML =
      '<div class="titlebar"><span>\u{1F3C6}</span><span class="t-text">SCORE.EXE \u2014 SERPENT Agency Scoreboard</span><button class="tb-btn" data-close="scorewin">\u2715</button></div>' +
      '<div class="menubar" id="sc-menu">' +
      '  <div class="mtitle" data-menu="sc-view">View</div>' +
      '  <div class="mtitle" data-menu="sc-help">Help</div>' +
      '  <div style="flex:1"></div>' +
      '  <div style="padding:2px 8px;color:#606;font-size:11px;">LIVE</div>' +
      '</div>' +
      '<div class="win-body">' +
      '  <div class="radio-row">' +
      '    <label><input type="radio" name="sc-range" value="all" checked> All-time</label>' +
      '    <label><input type="radio" name="sc-range" value="month"> This month</label>' +
      '  </div>' +
      '  <div class="sc-scroll"><table class="scores" id="sc-table"></table></div>' +
      '</div>' +
      '<div class="statusbar"><span id="sc-status"></span><span>server-side scores</span></div>';

    var nw = el("div", "window hidden");
    nw.id = "notewin";
    nw.innerHTML =
      '<div class="titlebar"><span>\u{1F4C4}</span><span class="t-text">README.TXT \u2014 Notice Board</span><button class="tb-btn" data-close="notewin">\u2715</button></div>' +
      '<div class="win-body">' +
      '  <div class="notepaper">NOTICE BOARD \u2014 SERPENT HQ\n\n\u00b7 Trust no one. Verify everything.\n\u00b7 New contracts drop Fridays.\n\u00b7 The server room is NOT a phone booth. Cuts both ways, Gary.\n\u00b7 Lost: one (1) rubber spoon. Answers to "Snakelor".\n\u00b7 Klumgongyn requests you stop feeding the printer.\n\n        \u2014 posted by SERPENT Command (do not reply)</div>' +
      '</div>' +
      '<div class="statusbar"><span>README.TXT \u00b7 5 notes</span><span>do not reply</span></div>';

    desk.insertBefore(nw, desk.firstChild);
    desk.insertBefore(sc, desk.firstChild);
    desk.insertBefore(cm, desk.firstChild);
  }

  // ---------- open / close the computer ----------
  var isOpen = false;
  var bootPlayed = false; // once per page session

  function open() {
    if (isOpen) return;
    var g = game();
    if (g && !g.isAuthed()) return; // not signed in: game auth overlay handles it
    isOpen = true;
    buildWindows();
    overlay.classList.remove("hidden");
    window.dispatchEvent(new CustomEvent("serpent-computer", { detail: { open: true } }));
    if (!bootPlayed) runBoot();
    else enterDesktop();
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    overlay.classList.add("hidden");
    hideAllScreens();
    window.dispatchEvent(new CustomEvent("serpent-computer", { detail: { open: false } }));
  }

  function hideAllScreens() {
    $("#boot").style.display = "none";
    $("#splash").style.display = "none";
    $("#fingerprint").style.display = "none";
    $("#desktop").classList.add("hidden");
    $("#taskbar").classList.add("hidden");
    $("#startmenu").style.display = "none";
    $("#dropdown-holder").innerHTML = "";
  }

  window.SERPENT_COMPUTER = { open: open, close: close, isOpen: function () { return isOpen; } };

  // ============================================================
  // BOOT SEQUENCE
  // ============================================================
  var bootLines = [
    ["Tiberian Dynamics Micro Systems BIOS v2.41", 0],
    ["Copyright 1987-1996 Tiberian Dynamics Worldwide", 300],
    ["BIOS date 04/17/96  Ver 2.41", 300],
    ["", 0],
    ["Main Processor : SERPENT-1 66 MHz", 350],
    ["Memory Test    : 00016384K OK", 700],
    ["", 0],
    ["Award Plug and Play BIOS Extension v1.0A", 250],
    ["Detecting IDE Primary Master   ... TDW-2244 SERPENTVAULT", 300],
    ["Detecting IDE Primary Slave    ... None", 200],
    ["Detecting IDE Secondary Master ... SNACD-ROM 8X", 300],
    ["Detecting IDE Secondary Slave  ... None", 200],
    ["", 0],
    ["PCI device listing ...", 250],
    ["  Bus No.  Device No.  Func No.   Vendor/Device   Class", 0],
    ["     0         7           1       8086:7010    IDE ctlr", 250],
    ["     0        12           0       5333:8811    Video (SerpentVue 64)", 250],
    ["     0        14           0       8086:7112    Serial bus (uplink modem)", 250],
    ["     0        15           0       13DR:0007    <span class='amber'>Unknown device: 'spoon.sys'?</span>", 300],
    ["", 0],
    ["Initializing SERPENT Secure Kernel v4.0.95", 400],
    ["Loading C:\\SERPENT\\DRIVERS\\MOUSE.SYS", 200],
    ["Loading C:\\SERPENT\\DRIVERS\\UPLINK_FRANKFURT.SYS", 250],
    ["Loading C:\\SERPENT\\DRIVERS\\COFFEE.DAE", 200],
    ["Energy Star ally: <span class='energy'>snake sleeps when you sleep</span>", 400],
    ["", 0],
    ["Scanning for rubber spoons ......... <span class='ok'>1 FOUND</span> (ignored)", 300],
    ["Booting from C:\\SERPENT\\OS\\KERNEL.SYS", 450],
    ["<span class='white'>SERPENT OS 95</span> starting ...", 350]
  ];

  var bootIdx = 0, bootEgg = null, bootTimer = null;

  window.addEventListener("keydown", function (e) {
    if (bootIdx >= bootLines.length) return; // only collect during boot
    var b = document.getElementById("boot");
    if (!b || b.style.display !== "block") return;
    if (!e.key || e.key.length !== 1) return;
    var typed = (window.__sosTyped || "") + e.key.toUpperCase();
    window.__sosTyped = typed.slice(-5);
    if (window.__sosTyped === "SNAKE") {
      bootEgg = "<span class='egg'>** SNAKELOR UNION TERMINAL DETECTED IN SLOT 7 \u2014 HI FRANK **</span>";
    }
  }, true);

  function renderBoot() {
    var cum = "";
    for (var j = 0; j < bootIdx; j++) cum += bootLines[j][0] + "\n";
    if (bootIdx >= bootLines.length && bootEgg) cum += bootEgg + "\n";
    $("#boot").innerHTML = cum + '<span class="cursor"></span>';
  }

  function runBoot() {
    bootIdx = 0; bootEgg = null; window.__sosTyped = "";
    hideAllScreens();
    overlay.classList.remove("sos-tealbg");
    overlay.classList.add("sos-bootbg");
    var boot = $("#boot");
    boot.style.display = "block";
    boot.innerHTML = '<span class="cursor"></span>';
    boot.ondblclick = function () { bootIdx = bootLines.length; renderBoot(); }; // speed-run
    (function step() {
      if (bootIdx >= bootLines.length) {
        bootTimer = setTimeout(function () {
          boot.style.display = "none";
          showSplash();
        }, 500);
        renderBoot(); // shows egg if any
        return;
      }
      var delay = bootLines[bootIdx][1] || 90;
      bootIdx++;
      renderBoot();
      bootTimer = setTimeout(step, delay);
    })();
  }

  function showSplash() {
    var sp = $("#splash");
    sp.style.display = "flex";
    var bar = $("#bootbar");
    bar.innerHTML = "";
    for (var i = 0; i < 22; i++) bar.appendChild(document.createElement("i"));
    var cells = bar.children, n = 0;
    var iv = setInterval(function () {
      if (n < cells.length) { cells[n].style.opacity = 1; n++; }
      else { clearInterval(iv); setTimeout(showFingerprint, 700); }
    }, 60);
  }

  // ---------- fingerprint ----------
  var fpTaps = 0, fpDone = false;

  function showFingerprint() {
    $("#splash").style.display = "none";
    var fp = $("#fingerprint");
    fp.style.display = "flex";
    fpDone = false; fpTaps = 0;
    var st = $("#fp-status");
    var name = (game() && game().getCodename()) || "Agent K";
    var steps = [
      ["SCANNING FINGERPRINT", 900],
      ["RIDGES: 41 \u00b7 MINUTIAE: 137", 800],
      ["MATCHING AGAINST AGENT DATABASE ...", 1100],
      ["CONFIDENCE 0.9821", 600]
    ];
    var i = 0;
    (function step() {
      if (i < steps.length) {
        st.textContent = steps[i][0];
        setTimeout(step, steps[i][1]);
        i++;
      } else {
        st.innerHTML = "<span class='granted'>ACCESS GRANTED</span>";
        setTimeout(function () {
          st.textContent = "WELCOME BACK, " + String(name).toUpperCase();
          st.className = "fp-status granted";
        }, 200);
        setTimeout(enterDesktop, 1400);
      }
    })();
    $("#fingerprint .fp-box").onclick = function () {
      fpTaps++;
      if (fpTaps === 6) st.textContent = "PLEASE STOP TAPPING THE SCANNER. (GARY.)";
    };
    // skip the scan on any key
    window.addEventListener("keydown", skipFP, true);
  }

  function skipFP(e) {
    if (fpDone) return;
    if (e && e.target && e.target.tagName === "INPUT") return;
    fpDone = true;
    window.removeEventListener("keydown", skipFP, true);
    enterDesktop();
  }

  function enterDesktop() {
    if (fpDone && !$("#desktop").classList.contains("hidden")) return;
    fpDone = true;
    window.removeEventListener("keydown", skipFP, true);
    $("#fingerprint").style.display = "none";
    overlay.classList.remove("sos-bootbg");
    overlay.classList.add("sos-tealbg");
    $("#desktop").classList.remove("hidden");
    $("#taskbar").classList.remove("hidden");
    bootPlayed = true;
    ["cmwin", "scorewin", "notewin", "agentwin"].forEach(function (id) {
      var w = document.getElementById(id);
      if (!w) return;
      initWindow(w);
    });
    openWin("cmwin");
    renderList();
    loadScores("all");
    tick();
  }

  function exitToBootScreens() {
    // hide desktop screens, used by restart
    $("#desktop").classList.add("hidden");
    $("#taskbar").classList.add("hidden");
    $("#startmenu").style.display = "none";
  }

  function tick() {
    var d = new Date();
    var c = $("#clock");
    if (!c) return;
    c.textContent = ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
    setTimeout(tick, 15000);
  }

  // ============================================================
  // CONTRACT MANAGER (real data via SERPENT_GAME)
  // ============================================================
  var sel = 0;
  var hintsUsed = {}; // slug -> hints revealed (local preview; server-side later)

  function contracts() {
    var g = game();
    return g ? (g.getContracts() || []) : [];
  }
  function hintsOf(c) { return (c && c.hints && c.hints.length) ? c.hints : (c && c.hint ? [c.hint] : []); }

  var MEDALS = [
    { label: "GOLD (full points)", cls: "gold" },
    { label: "SILVER", cls: "silver" },
    { label: "BRONZE", cls: "bronze" },
    { label: "NO MEDAL", cls: "none" }
  ];
  function medalOf(c) {
    var used = Math.min(hintsUsed[c.slug] || 0, 3);
    return MEDALS[used];
  }

  function renderList() {
    var l = $("#cm-list");
    if (!l) return;
    var cs = contracts();
    var g = game();
    l.innerHTML = "";
    if (!cs.length) {
      l.innerHTML = "<div class='cm-item'>(no contracts on file)</div>";
      return;
    }
    if (sel >= cs.length) sel = 0;
    var solvedCount = 0;
    cs.forEach(function (c, i) {
      var solved = g ? g.isSolved(c.slug) : false;
      if (solved) solvedCount++;
      var d = el("div", "cm-item" + (i === sel ? " sel" : "") + (solved ? " done" : ""),
        "<b>" + esc(c.slug) + "</b> <span class='st'>" + (solved ? "SOLVED" : esc(c.difficulty)) + "</span><br>" +
        esc(c.emoji + " " + c.title));
      d.onclick = function () { sel = i; renderList(); };
      l.appendChild(d);
    });
    var cc = $("#cm-count");
    if (cc) cc.textContent = "\u26A1 " + solvedCount + "/" + cs.length + " solved";
    var st = $("#cm-status");
    if (st) st.textContent = cs.length + " contracts on file \u00b7 solved: " + solvedCount;
    renderDetail();
  }

  function renderDetail() {
    var cs = contracts();
    var c = cs[sel];
    var g = game();
    if (!c) return;
    var solved = g ? g.isSolved(c.slug) : false;
    $("#cm-title").textContent = c.emoji + " " + c.title;
    $("#cm-tag").textContent = c.discipline + " \u00b7 " + c.difficulty + " \u00b7 " + c.points + " pts \u00b7 " + c.slug;
    $("#cm-brief").textContent = (solved ? "*** SOLVED \u2014 no further submissions accepted ***\n\n" : "") + c.brief;
    $("#cm-ans").value = "";
    $("#cm-msg").textContent = "";
    $("#cm-msg").className = "login-msg";
    $("#cm-submit").disabled = solved;
    $("#cm-ans").disabled = solved;
    updateHintsUI(c);
  }

  function updateHintsUI(c) {
    var g = game();
    var solved = g ? g.isSolved(c.slug) : false;
    var m = medalOf(c);
    var med = $("#cm-medal");
    med.innerHTML = "\u{1F3C5} Medal: " + esc(m.label);
    med.className = "medal " + m.cls;
    var used = hintsUsed[c.slug] || 0;
    var hs = hintsOf(c);
    $("#cm-hint-btn").disabled = solved || used >= hs.length;
    var h = $("#cm-hints");
    if (!used) {
      h.textContent = "(no hints taken \u2014 medals love you for it)";
    } else {
      var html = "";
      for (var i = 0; i < used; i++) {
        var lvl = ["FIRST", "SECOND", "THIRD"][Math.min(i, 2)];
        html += "<div><span class='lvl'>" + lvl + ":</span> " + esc(hs[i]) + "</div>";
      }
      h.innerHTML = html;
    }
  }

  function hintClick() {
    var c = contracts()[sel];
    if (!c) return;
    var hs = hintsOf(c);
    var used = Math.min((hintsUsed[c.slug] || 0) + 1, hs.length);
    if (used === (hintsUsed[c.slug] || 0)) return;
    hintsUsed[c.slug] = used;
    $("#cm-hint-btn").disabled = used >= hs.length;
    var st = $("#cm-status");
    if (st) st.textContent = "Hints used on " + c.slug + ": " + used + "/" + hs.length + " (server tracking: season 2)";
    updateHintsUI(c);
  }

  function submitAnswer() {
    var c = contracts()[sel];
    var g = game();
    if (!c || !g) return;
    if (g.isSolved(c.slug)) return;
    var v = $("#cm-ans").value.trim();
    var msg = $("#cm-msg");
    if (!v) { msg.textContent = "Type an answer first."; msg.className = "login-msg"; return; }
    msg.textContent = "Checking\u2026";
    msg.className = "login-msg";
    $("#cm-submit").disabled = true;
    Promise.resolve(g.submitAnswer(c, v)).then(function (res) {
      $("#cm-submit").disabled = false;
      if (res && res.error) {
        msg.textContent = res.error;
        msg.className = "login-msg";
        return;
      }
      if (res && res.correct) {
        msg.textContent = "CORRECT \u2014 " + c.slug + " closed. " + c.points + " pts awarded (" + medalOf(c).label + ").";
        msg.className = "login-msg ok";
        renderList();
      } else {
        msg.textContent = "Incorrect, Agent. Look again.";
        msg.className = "login-msg";
      }
    }).catch(function () {
      $("#cm-submit").disabled = false;
      msg.textContent = "Connection error. The uplink hiccuped.";
      msg.className = "login-msg";
    });
  }

  overlay.addEventListener("click", function (e) {
    var t = e.target;
    if (!t) return;
    if (t.id === "cm-submit" || t.closest && t.closest("#cm-submit")) { submitAnswer(); return; }
    if (t.id === "cm-hint-btn" || t.closest && t.closest("#cm-hint-btn")) { hintClick(); return; }
  });
  overlay.addEventListener("keydown", function (e) {
    if (e.target && e.target.id === "cm-ans" && e.key === "Enter") {
      submitAnswer();
      e.preventDefault();
    }
  }, true);

  // ============================================================
  // SCOREBOARD (real leaderboard via SERPENT_GAME)
  // ============================================================
  function loadScores(range) {
    var t = $("#sc-table");
    if (!t) return;
    t.innerHTML = "<tr><td>Loading\u2026</td></tr>";
    var g = game();
    if (!g) { t.innerHTML = ""; return; }
    Promise.resolve(g.getLeaderboard()).then(function (rows) {
      rows = rows || [];
      var myName = g.getCodename();
      if (range === "month") {
        t.innerHTML = "";
        t.innerHTML = "<tr><td>Monthly season standings start with the live scoring season. Stay sharp.</td></tr>";
        $("#sc-status").textContent = "monthly view: pending season 1";
        return;
      }
      if (!rows.length) {
        t.innerHTML = "<tr><td>No scores yet. Be the first agent on the board.</td></tr>";
        $("#sc-status").textContent = "0 agents ranked \u00b7 all-time";
        return;
      }
      var h = "<tr><th>#</th><th>Codename</th><th>Points</th><th>Solved</th></tr>";
      rows.forEach(function (r, i) {
        h += "<tr" + (r.codename === myName ? " class='me'" : "") + "><td>" + (i + 1) + "</td><td>" +
          esc(r.codename) + "</td><td>" + esc(r.points) + "</td><td>" + esc(r.contracts_solved) + "</td></tr>";
      });
      t.innerHTML = h;
      $("#sc-status").textContent = rows.length + " agents ranked \u00b7 all-time";
    }).catch(function () {
      t.innerHTML = "<tr><td>Scoreboard unreachable. Try again later.</td></tr>";
    });
  }

  overlay.addEventListener("change", function (e) {
    if (e.target && e.target.name === "sc-range") loadScores(e.target.value);
  });

  // ============================================================
  // AGENT ID window
  // ============================================================
  function fillAgentWin() {
    var g = game();
    if (!g) return;
    $("#agent-codename").value = g.getCodename() || "";
    $("#agent-msg").textContent = "";
  }
  overlay.addEventListener("click", function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    if (t.closest("#agent-save")) {
      var g = game();
      if (!g) return;
      var name = $("#agent-codename").value.trim();
      var msg = $("#agent-msg");
      if (!name) { msg.textContent = "Pick a codename, Agent."; msg.className = "login-msg"; return; }
      Promise.resolve(g.saveCodename(name)).then(function (r) {
        if (r && r.ok) { msg.textContent = "Codename updated. \u2714"; msg.className = "login-msg ok"; }
        else { msg.textContent = (r && r.error) || "Rename failed."; msg.className = "login-msg"; }
      });
      return;
    }
    if (t.closest("#agent-logout")) {
      var g2 = game();
      if (g2) g2.logout();
      close();
      return;
    }
  });

  // ============================================================
  // MENUS
  // ============================================================
  function alertWindow(title, text) {
    var w = el("div", "window");
    w.style.cssText = "left:34%;top:30%;width:320px;z-index:290;";
    w.innerHTML =
      "<div class='titlebar'><span>\u{1F4A1}</span><span class='t-text'>" + esc(title) + "</span><button class='tb-btn'>\u2715</button></div>" +
      "<div class='win-body'><div style='line-height:1.5;white-space:pre-wrap'>" + esc(text) + "</div>" +
      "<div style='display:flex;justify-content:flex-end;gap:6px;margin-top:10px;'><button class='btn'>OK</button></div></div>";
    $("#desktop").appendChild(w);
    initWindow(w);
    var closeFn = function () { w.remove(); };
    w.querySelector(".tb-btn").onclick = closeFn;
    w.querySelector(".btn").onclick = closeFn;
  }

  var menuDefs = {
    "cm-file": [["New Contract\u2026", null, true], ["Print\u2026", null, true], null,
      ["Exit", function () { closeWin("cmwin"); }]],
    "cm-contracts": [["Refresh", function () {
      renderList();
      $("#cm-status").textContent = "Contracts refreshed \u00b7 nothing changed, as usual.";
    }], null,
      ["Report rubber spoon sighting", function () {
        alertWindow("SERPENT Contract Manager", "The spoon has been reported.\nKlumgongyn thanks you and asks you to stop looking at it.");
      }]],
    "cm-help": [["About", function () {
      alertWindow("About SERPENT Contract Manager", "SERPENT Contract Manager 4.0.95\n\u00a9 Tiberian Dynamics Worldwide\n\nThis program respects your privacy and resents your presence.");
    }]],
    "sc-view": [["All-time", function () { loadScores("all"); }],
      ["This month", function () { loadScores("month"); }]],
    "sc-help": [["About", function () {
      alertWindow("About SCORE.EXE", "SCORE.EXE 1.0\nScores are server-side and anti-cheat protected, per Command memo 34-B.");
    }]]
  };
  var openMenu = null;

  overlay.addEventListener("click", function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var mt = t.closest(".mtitle");
    if (mt) {
      e.stopPropagation();
      var id = mt.getAttribute("data-menu");
      if (openMenu === id) { closeMenus(); return; }
      closeMenus();
      var dd = el("div", "dropdown");
      dd.style.left = mt.getBoundingClientRect().left + "px";
      dd.style.top = (mt.getBoundingClientRect().bottom + 1) + "px";
      (menuDefs[id] || []).forEach(function (item) {
        if (!item) { dd.appendChild(document.createElement("hr")); return; }
        var d = el("div", null, "<span>" + esc(item[0]) + "</span>");
        if (item[2]) d.className = "dis";
        else d.onclick = (function (fn) { return function () { closeMenus(); fn(); }; })(item[1]);
        dd.appendChild(d);
      });
      $("#dropdown-holder").appendChild(dd);
      openMenu = id;
      mt.classList.add("open");
      return;
    }
    if (!t.closest(".dropdown")) closeMenus();
  });
  function closeMenus() {
    $("#dropdown-holder").innerHTML = "";
    openMenu = null;
    $$(".mtitle", overlay).forEach(function (t) { t.classList.remove("open"); });
  }

  // ============================================================
  // WINDOW MANAGEMENT: drag / resize / focus / taskbar
  // ============================================================
  var zTop = 10;
  var managed = ["cmwin", "scorewin", "notewin", "agentwin"];

  function bringToFront(w) { w.style.zIndex = ++zTop; }

  function clampToViewport(w) {
    if (window.innerWidth <= 700) return; // stacked mobile layout
    var vw = window.innerWidth, vh = window.innerHeight - 28;
    var x = w.offsetLeft, y = w.offsetTop, ww = w.offsetWidth, hh = w.offsetHeight;
    if (ww > vw - 8) x = 4;
    else x = Math.max(4 - ww + 80, Math.min(x, vw - 80));
    y = Math.max(0, Math.min(y, vh - 30));
    w.style.left = Math.round(x) + "px";
    w.style.top = Math.round(y) + "px";
  }

  function initWindow(w) {
    if (w.dataset.winInit) return;
    w.dataset.winInit = "1";
    var grip = el("div", "grip");
    w.appendChild(grip);
    var seen = {};
    ["n", "e", "s", "w", "se"].forEach(function (side) {
      var r = el("div", "rsz " + side);
      r.dataset.side = side;
      w.appendChild(r);
      seen[side] = 1;
    });

    var drag = null;
    w.addEventListener("pointerdown", function (e) {
      if (w.classList.contains("hidden")) return;
      bringToFront(w);
      var t = e.target;
      if (!t || !t.closest) return;
      if (t.closest(".tb-btn") || t.closest("button.btn")) return;
      if (t.closest(".menubar") || t.closest(".dropdown")) return;
      var rz = t.closest(".rsz");
      if (rz) {
        e.preventDefault();
        drag = { mode: "resize", side: rz.dataset.side, sx: e.clientX, sy: e.clientY,
          ox: w.offsetLeft, oy: w.offsetTop, ow: w.offsetWidth, oh: w.offsetHeight };
        try { w.setPointerCapture(e.pointerId); } catch (_) { }
      } else if (t.closest(".titlebar")) {
        e.preventDefault();
        drag = { mode: "move", dx: e.clientX - w.offsetLeft, dy: e.clientY - w.offsetTop };
        try { w.setPointerCapture(e.pointerId); } catch (_) { }
      }
    });
    w.addEventListener("pointermove", function (e) {
      if (!drag) return;
      if (drag.mode === "move") {
        w.style.left = (e.clientX - drag.dx) + "px";
        w.style.top = (e.clientY - drag.dy) + "px";
      } else {
        var MINW = 280, MINH = 160;
        var ww = drag.ow, hh = drag.oh, x = drag.ox, y = drag.oy;
        if (drag.side.indexOf("e") >= 0) ww = Math.max(MINW, drag.ow + (e.clientX - drag.sx));
        if (drag.side.indexOf("s") >= 0) hh = Math.max(MINH, drag.oh + (e.clientY - drag.sy));
        if (drag.side.indexOf("w") >= 0) { ww = Math.max(MINW, drag.ow - (e.clientX - drag.sx)); x = drag.ox + (drag.ow - ww); }
        if (drag.side.indexOf("n") >= 0) { hh = Math.max(MINH, drag.oh - (e.clientY - drag.sy)); y = drag.oy + (drag.oh - hh); }
        w.style.width = ww + "px";
        w.style.height = hh + "px";
        w.style.left = x + "px";
        w.style.top = y + "px";
      }
    });
    function endDrag() { drag = null; }
    w.addEventListener("pointerup", endDrag);
    w.addEventListener("pointercancel", endDrag);
  }

  function openWin(id) {
    var w = document.getElementById(id);
    if (!w) return;
    w.classList.remove("hidden");
    initWindow(w);
    bringToFront(w);
    clampToViewport(w);
    if (id === "agentwin") fillAgentWin();
    refreshTasks();
  }
  function closeWin(id) {
    var w = document.getElementById(id);
    if (w) w.classList.add("hidden");
    refreshTasks();
  }

  function refreshTasks() {
    var ti = $("#taskitems");
    if (!ti) return;
    ti.innerHTML = "";
    managed.forEach(function (id) {
      var w = document.getElementById(id);
      if (!w || w.classList.contains("hidden")) return;
      var b = el("button", "task-item on");
      b.type = "button";
      b.textContent = w.querySelector(".t-text").textContent;
      b.onclick = (function (wid) { return function () { closeWin(wid); }; })(id);
      ti.appendChild(b);
    });
  }

  overlay.addEventListener("click", function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var cb = t.closest("[data-close]");
    if (cb) { closeWin(cb.getAttribute("data-close")); return; }
    var op = t.closest("[data-open]");
    if (op) { $("#startmenu").style.display = "none"; openWin(op.getAttribute("data-open")); return; }
    if (t.closest("#ico-cm")) { openWin("cmwin"); return; }
    if (t.closest("#ico-score")) { openWin("scorewin"); return; }
    if (t.closest("#ico-note")) { openWin("notewin"); return; }
    if (t.closest("#ico-agent")) { openWin("agentwin"); return; }
    if (t.closest("#startbtn")) {
      e.stopPropagation();
      var sm = $("#startmenu");
      sm.style.display = sm.style.display === "block" ? "none" : "block";
      return;
    }
    if (t.closest("#menu-shutdown")) {
      $("#startmenu").style.display = "none";
      close();
      return;
    }
    if (t.closest("#menu-reboot")) {
      $("#startmenu").style.display = "none";
      exitToBootScreens();
      runBoot();
      return;
    }
    // clicking the desktop closes the start menu
    if (t.id === "desktop" || t.closest("#desktop") && !t.closest(".window")) {
      $("#startmenu").style.display = "none";
      closeMenus();
    }
  });
  overlay.addEventListener("click", function (e) {
    if (e.target && e.target.id === "desktop") $("#startmenu").style.display = "none";
  });

  window.addEventListener("resize", function () {
    $$(".window:not(.hidden)", overlay).forEach(clampToViewport);
  });

  // Esc leaves the computer when the desktop is up
  window.addEventListener("keydown", function (e) {
    if (!isOpen) return;
    if (e.key === "Escape" && !$("#desktop").classList.contains("hidden")) {
      close();
    }
  });
})();
