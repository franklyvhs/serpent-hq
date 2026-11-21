// ============================================================
// SERPENT HQ — world module (M3a)
// Map data + collision rules. Written to be swapped for a
// Tiled map export later: keep everything positional in data,
// not in the renderer.
// ============================================================

export const TILE = 32;
export const MAP_W = 20;
export const MAP_H = 14;

// Legend: # wall  . floor  c carpet  B briefing table  s server rack  a alien flora
export const MAP = [
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

// Central contract console (interactive hotspot, in tile coords)
export const CONSOLE = { x: 8, y: 8 };

// Player spawn (tile units, center-ish of the tile)
export const SPAWN = { x: 9.5, y: 10.5 };
export const PLAYER_SPEED = 3.2; // tiles per second

// Solid tiles the player can never cross
const SOLID = new Set(["#", "B", "s"]);

// Tiles that get a decoration emoji (matches the old ASCII look)
export const EMOJI: Record<string, string> = {
  B: "\u{1F5A5}\uFE0F",
  s: "\u{1F5C4}\uFE0F",
  a: "\u{1F6F8}",
  "#": "\u2593",
};

// Floor-ish base colors per tile (hex, without #)
export const TILE_COLOR: Record<string, string> = {
  "#": "1e293b",
  c: "3b1145",
  B: "475569",
  s: "0f172a",
  a: "14532d",
  ".": "0b1626",
};

export function tileAt(tx: number, ty: number): string {
  if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return "#";
  return MAP[ty][tx] ?? "#";
}

export function walkable(x: number, y: number): boolean {
  const tx = Math.floor(x), ty = Math.floor(y);
  if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return false;
  if (tx === CONSOLE.x && ty === CONSOLE.y) return false; // console is solid
  return !SOLID.has(tileAt(tx, ty));
}

export function nearConsole(px: number, py: number): boolean {
  // px/py are tile-units player coordinates
  return Math.abs(px - (CONSOLE.x + 0.5)) <= 1.3 && Math.abs(py - (CONSOLE.y + 0.5)) <= 1.3;
}

// Parse "#rrggbb" (no leading #) to an [r,g,b] triple for KAPLAY colors.
export function hexRGB(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
}
