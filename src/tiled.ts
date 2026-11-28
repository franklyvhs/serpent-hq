// ============================================================
// SERPENT HQ — minimal Tiled (JSON) map loader
// Maps are authored in Tiled and exported as .json.
// Conventions:
//   - tile layers render bottom to top in file order (skip
//     invisible layers; a layer named "Collision" is NOT
//     rendered, its tiles only mark solid cells)
//   - a layer named "Overhead" is z-sorted against characters:
//     put tall furniture (counters, beds, shelves) there and the
//     player/NPCs walk behind it when north of the piece
//   - an object layer named "Objects" holds named point
//     objects: "player-spawn", "contract-console", future
//     interactables get their own names here
//   - DOORS: closed door art on a layer "Doors" (renders normally);
//     optional open-door art on "DoorsOpen" (same cells, hidden until
//     opened); a rectangle object named "door-<id>" on "Objects" marks
//     the door region. The game toggles visibility + collision cells.
//   - ANIMATED PROPS: point objects named "prop-<id>" on "Objects"
//     play the spritesheet listed for that id in
//     public/content/props.json (character-style: no painting needed).
// ============================================================

export interface Vec {
  x: number;
  y: number;
}

export interface Interactable {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DoorTile {
  x: number;   // world px (tile center)
  y: number;
  tx: number;  // tile coords
  ty: number;
  name: string; // kaplay sprite name (= Tiled tileset name)
  frame: number; // frame inside that tileset (gid - firstgid)
  obj: any;     // live game object (hide/destroy to swap art)
}

export interface TiledWorld {
  tile: number;              // tile size in px (16)
  mapW: number;              // map width in tiles
  mapH: number;              // map height in tiles
  solid: Uint8Array;         // 1 = solid, length mapW*mapH, row-major (mutable: doors toggle it)
  spawn: Vec;                // px
  objects: Interactable[];  // named objects from "Objects" layer (px)
  tilesByLayer: Record<string, DoorTile[]>; // "Doors" / "DoorsOpen" / "Animated" tile handles
  animatedTiles: AnimatedTileInfo[]; // Tiled tile animations to step every frame
}

export interface AnimatedTileInfo {
  obj: any;        // live game object whose .frame we step
  frames: number[];   // tile ids (sprite frames) in order
  durations: number[]; // ms per frame (Tiled animation editor)
  tx: number;      // cell the tile was painted in (for door regions)
  ty: number;
}

interface TiledTileset {
  firstgid: number;
  name: string;
  image: string;
  columns: number;
  tilecount: number;
  tilewidth: number;
  tileheight: number;
  // Tiled stores per-tile meta here, incl. the Tile Animation Editor data
  tiles?: { id: number; animation?: { tileid: number; duration: number }[] }[];
}

interface TiledLayer {
  name: string;
  type: "tilelayer" | "objectgroup" | string;
  visible: boolean;
  width?: number;
  height?: number;
  data?: number[];
  objects?: { name: string; type: string; x: number; y: number; width: number; height: number }[];
}

// k is the KAPLAY context (typed loosely on purpose: this module
// should not depend on kaplay's full type surface).
export async function loadTiled(k: any, mapUrl: string): Promise<TiledWorld> {
  const res = await fetch(mapUrl);
  if (!res.ok) throw new Error("Map not found: " + mapUrl + " (HTTP " + res.status + ")");
  const map = await res.json();

  const tile: number = map.tilewidth;
  if (tile !== map.tileheight) throw new Error("Non-square tiles not supported");

  const mapW: number = map.width;
  const mapH: number = map.height;
  const layers: TiledLayer[] = map.layers ?? [];
  const tilesets: TiledTileset[] = map.tilesets ?? [];

  // Resolve tileset image paths against the map URL (handles "../").
  const mapPath = new URL(mapUrl, location.origin);
  const loaded: { ts: TiledTileset; name: string; chunkRows: number; chunked: boolean }[] = [];
  // GPU textures have a maximum size (4096 on weak/mobile GPUs, up to
  // 16384 on desktops). Tileset images taller than that (e.g.
  // Interiors_16x16 is 256x17024) render as SOLID BLACK in the browser,
  // while Tiled itself shows them fine (it draws in chunks). So: split
  // any oversized sheet into vertical chunks of <=MAX_TEX px and load
  // each chunk as its own sprite "<name>~<chunk>".
  const MAX_TEX = 4096;
  for (const ts of tilesets) {
    // "data:" images (small placeholder tilesets) pass through as-is;
    // everything else resolves relative to the map URL (handles "../").
    const imgPath = ts.image.startsWith("data:")
      ? ts.image
      : new URL(ts.image, mapPath).pathname;
    const sliceX = ts.columns;
    const sliceY = Math.ceil(ts.tilecount / ts.columns);
    const sheetH = ts.tileheight * sliceY;
    if (ts.image.startsWith("data:") || sheetH <= MAX_TEX) {
      await k.loadSprite(ts.name, imgPath, { sliceX, sliceY });
      loaded.push({ ts, name: ts.name, chunkRows: sliceY, chunked: false });
      continue;
    }
    // oversized sheet: fetch pixels, slice into chunk sprites
    const img = new Image();
    img.src = imgPath;
    await new Promise<void>((ok, err) => {
      img.onload = () => ok();
      img.onerror = () => err(new Error("Tileset image failed: " + imgPath));
    });
    const chunkRows = Math.floor(MAX_TEX / ts.tileheight); // tile rows per chunk
    const chunkPx = chunkRows * ts.tileheight;
    const chunkCount = Math.ceil(img.height / chunkPx);
    for (let c = 0; c < chunkCount; c++) {
      const cy = c * chunkPx;
      const chPx = Math.min(chunkPx, img.height - cy);
      const cv = document.createElement("canvas");
      cv.width = img.width;
      cv.height = chPx;
      cv.getContext("2d")!.drawImage(img, 0, cy, img.width, chPx, 0, 0, img.width, chPx);
      await k.loadSprite(ts.name + "~" + c, cv.toDataURL("image/png"), {
        sliceX,
        sliceY: Math.ceil(chPx / ts.tileheight),
      });
    }
    loaded.push({ ts, name: ts.name, chunkRows, chunked: true });
  }

  const gidToSprite = (gid: number): { name: string; frame: number; ts: TiledTileset } | null => {
    if (gid <= 0) return null;
    for (let i = loaded.length - 1; i >= 0; i--) {
      const e = loaded[i];
      if (gid >= e.ts.firstgid) {
        const frame = gid - e.ts.firstgid;
        if (!e.chunked) return { name: e.name, frame, ts: e.ts };
        const perChunk = e.ts.columns * e.chunkRows;
        const chunk = Math.floor(frame / perChunk);
        return { name: e.name + "~" + chunk, frame: frame - chunk * perChunk, ts: e.ts };
      }
    }
    return null;
  };

  const solid = new Uint8Array(mapW * mapH);
  // Wall cells (for depth-boosting Behind Walls runs that sit on a wall)
  const wallCells = new Set<number>();
  // Behind Walls cells that sit flush on top of a wall: their art must
  // draw at the wall's depth so a player walking the wall cap behind
  // them gets fully occluded (closets against a wall hide the player
  // in the 1-tile seam, instead of the player's head pasting over them)
  const bwBoost = new Set<number>();
  const bwBoostBottom = new Map<number, number>(); // cell -> first row below the run (the wall row)
  const objects: Interactable[] = [];
  const tilesByLayer: Record<string, DoorTile[]> = {};
  const animatedTiles: AnimatedTileInfo[] = [];

  // PRE-PASS: collect wall cells before the main loop — the map's layer
  // order puts "Behind Walls" BEFORE "Walls", so the depth boost must
  // not depend on "Walls" having been processed already.
  for (const layer of layers) {
    if (layer.type === "tilelayer" && layer.name === "Walls" && layer.data) {
      for (let i = 0; i < layer.data.length; i++) {
        if ((layer.data[i] & 0x1fffffff) > 0) wallCells.add(i);
      }
    }
  }

  for (const layer of layers) {
    if (layer.type === "tilelayer" && layer.data) {
      // A short/long array renders garbage and breaks collision silently:
      // fail loudly instead.
      if (layer.data.length !== mapW * mapH) {
        throw new Error(
          `Map layer "${layer.name}" has ${layer.data.length} tiles, expected ${mapW * mapH} (${mapW}x${mapH})`
        );
      }
      if (layer.name === "Collision") {
        for (let i = 0; i < layer.data.length && i < solid.length; i++) {
          if (layer.data[i] > 0) solid[i] = 1;
        }
        continue; // collision layer is never rendered
      }
      if (layer.name === "Walls" || layer.name === "Behind Walls") {
        // Wall layers are automatically solid — no need to paint them on
        // the Collision layer (doorways are gaps, so they stay passable).
        // EXCEPT the outer rows of a horizontal band stay walkable so
        // the player can step behind/into them for a depth effect:
        //  - WALLS act as barriers: only their north row is a walkable
        //    cap (no tile above, tiles below). The face row stays solid
        //    so walls can never be walked through.
        //  - BEHIND WALLS content (closets, furniture backs) also gets
        //    a SOUTH cap (tile row with tiles above, regardless of
        //    what's below: the wall or floor below already blocks
        //    through-passage), so the player can step into its front
        //    row from the wall cap behind it.
        // Interior rows of a band are always solid. Paint the Collision
        // layer on any cap cell to re-block it: Collision is processed
        // first and this rule never unsets it.
        const isHere = (x: number, y: number): boolean => {
          if (x < 0 || x >= mapW || y < 0 || y >= mapH) return false;
          return (layer.data[y * mapW + x] & 0x1fffffff) > 0;
        };
        for (let y = 0; y < mapH; y++) {
          for (let x = 0; x < mapW; x++) {
            if (!isHere(x, y)) continue;
            if (layer.name === "Walls") wallCells.add(y * mapW + x);
            const inHorizontalBand = isHere(x - 1, y) || isHere(x + 1, y);
            const hasFaceRowBelow = isHere(x, y + 1);
            const hasTileAbove = isHere(x, y - 1);
            const northCap = inHorizontalBand && hasFaceRowBelow && !hasTileAbove;
            const southCap =
              layer.name === "Behind Walls" && inHorizontalBand && hasTileAbove;
            if (!northCap && !southCap) solid[y * mapW + x] = 1;
          }
        }
        if (layer.name === "Behind Walls") {
          // bottom-up: a cell is boosted if the run below it lands on a
          // Walls cell; the whole run then shares one z (the wall's)
          for (let y = mapH - 1; y >= 0; y--) {
            for (let x = 0; x < mapW; x++) {
              const cell = y * mapW + x;
              if (!isHere(x, y)) continue;
              const belowCell = (y + 1) * mapW + x;
              const belowIsWall = y + 1 < mapH && wallCells.has(belowCell);
              const belowIsBoosted =
                y + 1 < mapH && isHere(x, y + 1) && bwBoost.has(belowCell);
              if (belowIsWall) {
                bwBoost.add(cell);
                bwBoostBottom.set(cell, y + 1);
              } else if (belowIsBoosted) {
                bwBoost.add(cell);
                bwBoostBottom.set(cell, bwBoostBottom.get(belowCell)!);
              }
            }
          }
        }
      }
      if (!layer.visible) continue;
      for (let y = 0; y < mapH; y++) {
        for (let x = 0; x < mapW; x++) {
          // Tiled packs flip/rotate flags into the top 3 bits of
          // every gid (0x80000000=H, 0x40000000=V, 0x20000000=diag).
          // Strip them before resolving the sprite and re-create the
          // transform as kaplay scale/rotate on a centered tile, so
          // rotated corner pieces and flipped walls render correctly.
          const raw = layer.data[y * mapW + x] ?? 0;
          const fh = (raw & 0x80000000) !== 0;
          const fv = (raw & 0x40000000) !== 0;
          const fd = (raw & 0x20000000) !== 0;
          const gid = raw & 0x1fffffff;
          const s = gidToSprite(gid);
          if (!s) continue;
          // Tiled renders tiles BIGGER than the map's tile size anchored
          // to the cell's BOTTOM-LEFT (they extend up/right; see the TMX
          // format docs). Match that here so oversized tiles (32x32 door
          // frames on this 16px map) land exactly where Tiled shows them.
          const big = s.ts.tilewidth > tile || s.ts.tileheight > tile;
          const px = big ? x * tile + s.ts.tilewidth / 2 : x * tile + tile / 2;
          const py = big ? (y + 1) * tile - s.ts.tileheight / 2 : y * tile + tile / 2;
          const isDoors = layer.name === "Doors";
          const isDoorsOpen = layer.name === "DoorsOpen";
          const flags = (fh ? 1 : 0) | (fv ? 2 : 0) | (fd ? 4 : 0);
          const comps: any[] = [
            k.pos(px, py),
            k.anchor("center"),
            k.sprite(s.name, { frame: s.frame }),
          ];
          // Depth sorting: every tile layer EXCEPT "Ground" (the floor,
          // always under everything) gets z = the tile's bottom edge.
          // The renderer z-sorts these against characters (whose z is
          // their feet position): north of furniture = behind it,
          // south = in front. This includes "Behind Walls" — its
          // closets/trim must draw OVER a player standing in the wall
          // cap or closet cap rows (the depth effect), not under him.
          if (layer.name !== "Ground") {
            // Behind Walls runs flush on a wall draw at the wall's depth
            const boostedCell = layer.name === "Behind Walls" && bwBoost.has(y * mapW + x);
            const tileZ = boostedCell
              ? (bwBoostBottom.get(y * mapW + x)! + 2) * tile
              : (y + 1) * tile;
            comps.push(k.z(tileZ));
          }
          switch (flags) {
            case 1: comps.push(k.scale(-1, 1)); break;               // H
            case 2: comps.push(k.scale(1, -1)); break;               // V
            case 3: comps.push(k.scale(-1, -1)); break;             // H|V
            case 4: comps.push(k.rotate(90), k.scale(1, -1)); break; // D (transpose)
            case 5: comps.push(k.rotate(90)); break;                // D|H
            case 6: comps.push(k.rotate(270)); break;              // D|V
            case 7: comps.push(k.rotate(90), k.scale(-1, 1)); break; // D|H|V
          }
          const go = k.add(comps);
          // Tiled Tile Animation Editor data: remember tiles carrying an
          // animation so main.ts can step their frames (duration in ms).
          const animDef = (s.ts.tiles ?? []).find(
            (tl) => tl.id === s.frame && tl.animation && tl.animation.length > 1
          );
          if (animDef && animDef.animation) {
            animatedTiles.push({
              obj: go,
              frames: animDef.animation.map((f) => f.tileid),
              durations: animDef.animation.map((f) => f.duration),
              tx: x,
              ty: y,
            });
          }
          // Door tiles keep live handles so the game can swap them;
          // DoorsOpen art stays hidden until a door opens (`.hidden`
          // must be assigned after creation, not as a component).
          if (isDoors) {
            (tilesByLayer.Doors ??= []).push({ x: x * tile + tile / 2, y: y * tile + tile / 2, tx: x, ty: y, name: s.name, frame: s.frame, obj: go });
          } else if (isDoorsOpen) {
            go.hidden = true;
            (tilesByLayer.DoorsOpen ??= []).push({ x: x * tile + tile / 2, y: y * tile + tile / 2, tx: x, ty: y, name: s.name, frame: s.frame, obj: go });
          }
        }
      }
    } else if (layer.type === "objectgroup" && layer.objects) {
      for (const o of layer.objects) {
        objects.push({ name: o.name, x: o.x, y: o.y, width: o.width || 0, height: o.height || 0 });
      }
    }
  }

  const spawnObj = objects.find((o) => o.name === "player-spawn");
  if (!spawnObj) throw new Error("Map missing 'player-spawn' object");

  return {
    tile,
    mapW,
    mapH,
    solid,
    spawn: {
      // a 16x16 spawn object covers a cell: feet go at its bottom edge
      x: spawnObj.x,
      y: spawnObj.y + (spawnObj.height || 0),
    },
    objects,
    tilesByLayer,
    animatedTiles,
  };
}
