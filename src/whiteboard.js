// ============================================================
// SERPENT HQ — in-world notice board (the physical whiteboard)
// Not part of SERPENT OS: a hand-authored whiteboard with paper
// notes, rendered as its own overlay. Notice-board map object in
// main.ts opens this via window.WHITEBOARD.open().
// ============================================================
(function () {
  "use strict";

  var NOTES = [
    { pin: "#c0392b", text: "New contracts drop Fridays.\nVerify everything. Trust no one." },
    { pin: "#2980b9", text: "Pizza Friday is CANCELLED.\nYou know who you are." },
    { pin: "#c0392b", text: "The server room is NOT a phone booth.\nCuts both ways, Gary." },
    { pin: "#e67e22", text: "Lost: one (1) rubber spoon.\nAnswers to \u201cSnakelor\u201d.\nReward: a slightly smaller spoon." },
    { pin: "#8e44ad", text: "Klumgongyn requests you stop\nfeeding the printer." },
    { pin: "#c0392b", text: "Bio-scanner fixed. No more thumbs\nin the coin tray. (GARY.)" },
    { pin: "#27ae60", text: "How to play: read README.TXT\non the computer. Mandatory." }
  ];

  var overlay = document.createElement("div");
  overlay.id = "whiteboard-overlay";
  overlay.className = "hidden";

  var board = document.createElement("div");
  board.className = "wb-board";
  var title = document.createElement("div");
  title.className = "wb-title";
  title.textContent = "NOTICE BOARD \u2014 SERPENT HQ";
  board.appendChild(title);

  NOTES.forEach(function (n, i) {
    var note = document.createElement("div");
    note.className = "wb-note";
    note.innerHTML = "<span class='wb-pin' style='background:" + n.pin + "'></span>" + n.text.replace(/\n/g, "<br>");
    board.appendChild(note);
  });

  var closeBtn = document.createElement("button");
  closeBtn.className = "wb-close";
  closeBtn.type = "button";
  closeBtn.title = "Step away from the board";
  closeBtn.textContent = "\u2715";
  board.appendChild(closeBtn);

  overlay.appendChild(board);
  document.body.appendChild(overlay);

  function open() {
    overlay.classList.remove("hidden");
    window.dispatchEvent(new CustomEvent("serpent-whiteboard", { detail: { open: true } }));
  }
  function close() {
    overlay.classList.add("hidden");
    window.dispatchEvent(new CustomEvent("serpent-whiteboard", { detail: { open: false } }));
  }

  closeBtn.onclick = function (e) { e.stopPropagation(); close(); };
  overlay.onclick = function (e) { if (e.target === overlay) close(); };
  window.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !overlay.classList.contains("hidden")) {
      if (e.target instanceof HTMLInputElement) return;
      close();
    }
  }, true);

  window.WHITEBOARD = { open: open, close: close, isOpen: function () { return !overlay.classList.contains("hidden"); } };
})();
