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
}

interface TiledTileset {
  firstgid: number;
  name: string;
  image: string;
  columns: number;
  tilecount: number;
  tilewidth: number;
  tileheight: number;
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
  const loaded: { ts: TiledTileset; name: string }[] = [];
  for (const ts of tilesets) {
    // "data:" images (small placeholder tilesets) pass through as-is;
    // everything else resolves relative to the map URL (handles "../").
    const imgPath = ts.image.startsWith("data:")
      ? ts.image
      : new URL(ts.image, mapPath).pathname;
    await k.loadSprite(ts.name, imgPath, {
      sliceX: ts.columns,
      sliceY: Math.ceil(ts.tilecount / ts.columns),
    });
    loaded.push({ ts, name: ts.name });
  }

  const gidToSprite = (gid: number): { name: string; frame: number } | null => {
    if (gid <= 0) return null;
    for (let i = loaded.length - 1; i >= 0; i--) {
      if (gid >= loaded[i].ts.firstgid) {
        return { name: loaded[i].name, frame: gid - loaded[i].ts.firstgid };
      }
    }
    return null;
  };

  const solid = new Uint8Array(mapW * mapH);
  const objects: Interactable[] = [];
  const tilesByLayer: Record<string, DoorTile[]> = {};

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
          const isDoors = layer.name === "Doors";
          const isDoorsOpen = layer.name === "DoorsOpen";
          const flags = (fh ? 1 : 0) | (fv ? 2 : 0) | (fd ? 4 : 0);
          const comps: any[] = [
            k.pos(x * tile + tile / 2, y * tile + tile / 2),
            k.anchor("center"),
            k.sprite(s.name, { frame: s.frame }),
          ];
          // Depth sorting: a layer named "Overhead" holds tall
          // furniture the characters can walk BEHIND. Its tiles get
          // z = the tile's bottom edge, so the renderer z-sorts them
          // against the player/NPCs (whose z is their feet position):
          // north of the furniture = behind it, south = in front.
          // All other layers stay at z 0 = always under characters.
          if (layer.name === "Overhead") comps.push(k.z((y + 1) * tile));
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
    spawn: { x: spawnObj.x, y: spawnObj.y },
    objects,
    tilesByLayer,
  };
}
