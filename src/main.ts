// @deno-types="npm:@types/leaflet"
import type { LatLng, LeafletMouseEvent } from "leaflet";
import leaflet from "leaflet";

// Style sheets
import "leaflet/dist/leaflet.css"; // supporting style for Leaflet
import "./style.css"; // student-controlled page style

// Fix missing marker images
import "./_leafletWorkaround.ts"; // fixes for missing Leaflet images
// Import our luck function for deterministic randomness
import luck from "./_luck.ts";

// Interfaces for tokens and game state
interface Token {
  key: string;
  exp: number;
}

interface GameState {
  heldToken: Token | null;
  collectedSet: Set<string>;
  hasWon: boolean;
}

// Grid cell abstraction: integer grid coordinates independent of screen representation
interface GridCell {
  i: number; // x/tile index
  j: number; // y/tile index
}

// Create basic UI elements
const controlPanelDiv = document.createElement("div");
controlPanelDiv.id = "controlPanel";

const mapDiv = document.createElement("div");
mapDiv.id = "map";
document.body.append(mapDiv);

// Put the control panel inside the map so it overlays the map area
mapDiv.append(controlPanelDiv);

// statusPanelDiv removed: we only show holding text as an overlay on the map

// Inventory badge shown over the map canvas
const inventoryBadge = document.createElement("div");
inventoryBadge.id = "inventoryBadge";
inventoryBadge.innerText = "Holding: none";
mapDiv.append(inventoryBadge);

// Win banner (hidden until player wins). Includes a Play Again button.
const winBanner = document.createElement("div");
winBanner.id = "winBanner";
winBanner.innerHTML = `
  <div>You win!</div>
  <div style="margin-top:10px;"><button id="playAgain">Play again</button></div>
`;
winBanner.style.display = "none";
mapDiv.append(winBanner);

// Centralized game state
const gameState: GameState = {
  heldToken: null,
  collectedSet: new Set<string>(),
  hasWon: false,
};

// Play again handler: clear collected/held state and respawn tokens
function playAgain() {
  gameState.hasWon = false;
  gameState.heldToken = null;
  gameState.collectedSet.clear();
  tokensLayer.clearLayers();
  tokensMap.clear();
  updateStatusPanel();
  spawnTokens();
}

// Attach listener to the Play Again button once the element exists
winBanner.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  if (target && target.id === "playAgain") playAgain();
});

// Our classroom location
const CLASSROOM_LATLNG = leaflet.latLng(
  36.997936938057016,
  -122.05703507501151,
);

// Tunable gameplay parameters
const GAMEPLAY_ZOOM_LEVEL = 19;
const TILE_SIZE_PX = 60;
const PROXIMITY_DETECT_RADIUS = 6;
const SPAWN_ANIMATION_DURATION_MS = 900;

// //// //// //// //// //// ////
// MAP
// //// //// //// //// //// ////

// Create the map (element with id "map" is defined in index.html)
const map = leaflet.map(mapDiv, {
  center: CLASSROOM_LATLNG,
  zoom: GAMEPLAY_ZOOM_LEVEL,
  minZoom: GAMEPLAY_ZOOM_LEVEL,
  maxZoom: GAMEPLAY_ZOOM_LEVEL,
  zoomControl: false,
  scrollWheelZoom: false,
  touchZoom: false,
  doubleClickZoom: false,
  boxZoom: false,
  keyboard: false,
});

// Populate the map with a background tile layer
leaflet.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution:
    '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

// Add a marker to represent the player
const playerMarker = leaflet.marker(CLASSROOM_LATLNG);
playerMarker.bindTooltip("Cell ", {
  permanent: false,
  direction: "top",
  className: "player-label",
});
playerMarker.addTo(map);

updatePlayerTooltip();

playerMarker.on("mouseover", () => {
  updatePlayerTooltip();
  playerMarker.openTooltip();
});

playerMarker.on("mouseout", () => {
  playerMarker.closeTooltip();
});

// On click, update and show the tooltip (do not pin it)
playerMarker.on("click", () => {
  updatePlayerTooltip();
  playerMarker.openTooltip();
});

updatePlayerTooltip();

// //// //// //// //// //// ////
// BUTTONS
// //// //// //// //// //// ////

const EYE_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"></path>
    <circle cx="12" cy="12" r="3"></circle>
  </svg>
`;

const PIN_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M21 10c0 6-9 13-9 13S3 16 3 10a9 9 0 1118 0z"></path>
    <circle cx="12" cy="10" r="2"></circle>
  </svg>
`;

const controlsContainer = document.createElement("div");
controlsContainer.id = "directionalControls";
controlsContainer.className = "directional-controls";

let freeLook = false;

function setFreeLook(enabled: boolean) {
  freeLook = enabled;

  if (!enabled) {
    map.dragging.disable();

    map.setView(playerMarker.getLatLng(), GAMEPLAY_ZOOM_LEVEL);
  } else {
    map.dragging.enable();
  }
}

const buttons: HTMLButtonElement[] = [];

for (let i = 0; i < 5; i++) {
  buttons.push(document.createElement("button"));
  buttons[i].type = "button";
}

buttons[0].innerText = "↑";
buttons[1].innerText = "←";
buttons[2].innerText = "→";
buttons[3].innerText = "↓";
buttons[4].innerHTML = PIN_SVG;

// Helper: move player by a grid delta (dx,dj)
function movePlayerBy(dx: number, dy: number) {
  const current = playerMarker.getLatLng();
  const currentPt = map.project(current, GAMEPLAY_ZOOM_LEVEL);

  const relX = currentPt.x - WORLD_ORIGIN_POINT.x;
  const relY = currentPt.y - WORLD_ORIGIN_POINT.y;

  const newRelX = relX + dx * TILE_SIZE_PX;
  const newRelY = relY + dy * TILE_SIZE_PX;

  const newWorldX = WORLD_ORIGIN_POINT.x + newRelX;
  const newWorldY = WORLD_ORIGIN_POINT.y + newRelY;
  const newLatLng = map.unproject(
    leaflet.point(newWorldX, newWorldY),
    GAMEPLAY_ZOOM_LEVEL,
  );

  playerMarker.setLatLng(newLatLng);
  updatePlayerTooltip();

  // Recenter camera only when freeLook is disabled
  if (!freeLook) {
    map.setView(newLatLng, GAMEPLAY_ZOOM_LEVEL);
  }

  spawnTokens();
}

// Update the player's marker tooltip to show the grid cell the player is currently in.
function updatePlayerTooltip() {
  try {
    const latlng = playerMarker.getLatLng();
    const cell = _latLngToGridCell(latlng);
    const content = `Player ${gridCellKey(cell)}`;
    const t = playerMarker.getTooltip();
    if (t) {
      t.setContent(content);
    } else {
      playerMarker.bindTooltip(content, {
        permanent: false,
        direction: "top",
        className: "player-label",
      });
    }
  } catch (error) {
    console.log("Error updating player tooltip", error);
  }
}

for (let idx = 0; idx < buttons.length; idx++) {
  const button = buttons[idx];
  if (idx !== 4) {
    button.className = "directional-button";
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => {
      switch (idx) {
        case 0: // up
          movePlayerBy(0, -1);
          break;
        case 1: // left
          movePlayerBy(-1, 0);
          break;
        case 2: // right
          movePlayerBy(1, 0);
          break;
        case 3: // down
          movePlayerBy(0, 1);
          break;
      }
      // brief press feedback
      button.setAttribute("aria-pressed", "true");
      setTimeout(() => button.setAttribute("aria-pressed", "false"), 150);
    });
  } else {
    // free-look toggle: use global `freeLook` state via setFreeLook
    button.setAttribute("aria-pressed", String(freeLook));
    button.addEventListener("click", () => {
      const newState = !freeLook;
      setFreeLook(newState);
      button.innerHTML = newState ? EYE_SVG : PIN_SVG;
      button.setAttribute("aria-pressed", String(newState));
    });
  }
}

// Arrange buttons visually: up above, left/center/right in a row, down below.
const rowTop = document.createElement("div");
rowTop.className = "directional-row row-top";
rowTop.appendChild(buttons[0]);

const rowMiddle = document.createElement("div");
rowMiddle.className = "directional-row row-middle";
rowMiddle.appendChild(buttons[1]);
rowMiddle.appendChild(buttons[4]);
rowMiddle.appendChild(buttons[2]);

const rowBottom = document.createElement("div");
rowBottom.className = "directional-row row-bottom";
rowBottom.appendChild(buttons[3]);

controlsContainer.appendChild(rowTop);
controlsContainer.appendChild(rowMiddle);
controlsContainer.appendChild(rowBottom);

controlPanelDiv.appendChild(controlsContainer);

// Apply initial freeLook state (locked by default)
setFreeLook(freeLook);

// //// //// //// //// //// ////
// TOKEN SPAWNING
// //// //// //// //// //// ////

// World-origin point (pixel coordinates) for lat=0,lng=0 at our game zoom.
// This makes gridspace (0,0) correspond to geographic (0,0) — "null island".
const WORLD_ORIGIN_POINT = map.project(
  leaflet.latLng(0, 0),
  GAMEPLAY_ZOOM_LEVEL,
);

// Token spawning parameters
const TOKEN_SPAWN_PROBABILITY = 0.12;
// Token exponents: tokens are 2^exp, exp range 0..TOKEN_MAX_EXP
const TOKEN_MAX_EXP = 4;
const WIN_VALUE = Math.pow(2, TOKEN_MAX_EXP); // value needed to win the game

const _expWeights: number[] = [];
for (let e = 0; e <= TOKEN_MAX_EXP; e++) {
  _expWeights.push(1 / Math.pow(2, e));
}
const expTotal = _expWeights.reduce((s, v) => s + v, 0);
const EXP_DISTRIBUTION: number[] = [];
let acc = 0;
for (let e = 0; e <= TOKEN_MAX_EXP; e++) {
  acc += _expWeights[e] / expTotal;
  EXP_DISTRIBUTION.push(acc);
}
const EXP_SPAWN_MULTIPLIER = _expWeights.map((w) => w / _expWeights[0]);

// Layer to hold token markers (persist across view changes)
const tokensLayer = leaflet.layerGroup().addTo(map);
// Map of tokens keyed by base world-tile (tx:ty); stores layer + exponent
const tokensMap = new Map<string, { layer: leaflet.Layer; exp: number }>();

function updateStatusPanel() {
  const holding = gameState.heldToken
    ? `Holding: ${2 ** gameState.heldToken.exp}`
    : "Holding: none";
  // Also update the on-map inventory badge
  if (inventoryBadge) inventoryBadge.innerText = holding;
  // Show win banner when player is holding the max-value token
  const hasWinToken = gameState.heldToken &&
    2 ** gameState.heldToken.exp === WIN_VALUE;
  if (hasWinToken) {
    gameState.hasWon = true;
    winBanner.classList.add("show-win");
  } else {
    gameState.hasWon = false;
    winBanner.classList.remove("show-win");
  }
}

// Initialize status panel
updateStatusPanel();

// Small helper to show a temporary popup at a given location and auto-close it.
function openTempPopup(
  latlng: LatLng,
  content: string,
  duration = SPAWN_ANIMATION_DURATION_MS,
) {
  const popup = leaflet.popup({ closeButton: false, autoClose: true })
    .setLatLng(latlng)
    .setContent(content);
  popup.openOn(map);
  setTimeout(() => map.closePopup(popup), duration);
}

// Spawn tokens for the currently visible world-tile cells.
function spawnTokens() {
  const bounds = map.getBounds();

  const nw = bounds.getNorthWest();
  const se = bounds.getSouthEast();

  const nwPt = map.project(nw, GAMEPLAY_ZOOM_LEVEL);
  const sePt = map.project(se, GAMEPLAY_ZOOM_LEVEL);

  // Compute positions relative to WORLD_ORIGIN_POINT so grid (0,0) == lat/lng (0,0)
  const nwRelX = nwPt.x - WORLD_ORIGIN_POINT.x;
  const seRelX = sePt.x - WORLD_ORIGIN_POINT.x;
  const nwRelY = nwPt.y - WORLD_ORIGIN_POINT.y;
  const seRelY = sePt.y - WORLD_ORIGIN_POINT.y;

  const minI = Math.floor(Math.min(nwRelX, seRelX) / TILE_SIZE_PX);
  const maxI = Math.floor((Math.max(nwRelX, seRelX) - 1) / TILE_SIZE_PX);
  const minJ = Math.floor(Math.min(nwRelY, seRelY) / TILE_SIZE_PX);
  const maxJ = Math.floor((Math.max(nwRelY, seRelY) - 1) / TILE_SIZE_PX);

  for (let i = minI; i <= maxI; i++) {
    for (let j = minJ; j <= maxJ; j++) {
      trySpawnCell({ i, j });
    }
  }
}

// Compute Manhattan grid distance (in tile units) from the player to a cell.
function gridDistanceToPlayer(cell: GridCell): number {
  const playerLatLng = playerMarker.getLatLng();
  const playerPt = map.project(playerLatLng, GAMEPLAY_ZOOM_LEVEL);
  const relX = playerPt.x - WORLD_ORIGIN_POINT.x;
  const relY = playerPt.y - WORLD_ORIGIN_POINT.y;
  const playerI = Math.floor(relX / TILE_SIZE_PX);
  const playerJ = Math.floor(relY / TILE_SIZE_PX);
  const dx = Math.abs(cell.i - playerI);
  const dy = Math.abs(cell.j - playerJ);
  return dx + dy;
}

// Utility: stable string key for a grid cell
function gridCellKey(cell: GridCell): string {
  return `${cell.i}:${cell.j}`;
}

// Utility: parse a key back into a GridCell
function _parseGridCellKey(key: string): GridCell {
  const [iStr, jStr] = key.split(":");
  return { i: Number(iStr), j: Number(jStr) };
}

// Convert a continuous LatLng into a GridCell at our base zoom / tile size
function _latLngToGridCell(latlng: LatLng): GridCell {
  const pt = map.project(latlng, GAMEPLAY_ZOOM_LEVEL);
  const relX = pt.x - WORLD_ORIGIN_POINT.x;
  const relY = pt.y - WORLD_ORIGIN_POINT.y;
  const i = Math.floor(relX / TILE_SIZE_PX);
  const j = Math.floor(relY / TILE_SIZE_PX);
  return { i, j };
}

// Convert a GridCell into its NW (top-left) and SE (bottom-right) LatLng bounds
// Return a Leaflet `LatLngBounds` for a grid cell (top-left -> bottom-right)
function gridCellToLatLngBounds(cell: GridCell): leaflet.LatLngBounds {
  // Convert cell coords into world pixel coordinates by adding the world-origin offset
  const nwTile = leaflet.point(
    WORLD_ORIGIN_POINT.x + cell.i * TILE_SIZE_PX,
    WORLD_ORIGIN_POINT.y + cell.j * TILE_SIZE_PX,
  );
  const seTile = leaflet.point(
    WORLD_ORIGIN_POINT.x + (cell.i + 1) * TILE_SIZE_PX,
    WORLD_ORIGIN_POINT.y + (cell.j + 1) * TILE_SIZE_PX,
  );
  const nwLatLng = map.unproject(nwTile, GAMEPLAY_ZOOM_LEVEL);
  const seLatLng = map.unproject(seTile, GAMEPLAY_ZOOM_LEVEL);
  return leaflet.latLngBounds([
    [nwLatLng.lat, nwLatLng.lng],
    [seLatLng.lat, seLatLng.lng],
  ]);
}

function trySpawnCell(cell: GridCell) {
  const key = gridCellKey(cell);

  // Don't spawn if already collected
  if (gameState.collectedSet.has(key)) return;

  // If token already exists for this cell, ensure it's in the layer and return
  const existing = tokensMap.get(key);
  if (existing) {
    if (!tokensLayer.hasLayer(existing.layer)) {
      tokensLayer.addLayer(existing.layer);
    }
    return;
  }

  // Determine deterministic token value for this cell using a rarity distribution
  const vRand = luck(key + ":value");
  let exp = 0;
  for (let e = 0; e <= TOKEN_MAX_EXP; e++) {
    if (vRand < EXP_DISTRIBUTION[e]) {
      exp = e;
      break;
    }
  }

  const spawnRand = luck(key + ":spawn");
  const spawnThreshold = TOKEN_SPAWN_PROBABILITY * EXP_SPAWN_MULTIPLIER[exp];
  if (!(spawnRand < spawnThreshold)) return;
  // Create a rectangle snapped to the integer grid cell bounds
  const rect = createTokenRectangle(cell, exp);

  rect.on("click", (e: LeafletMouseEvent) => {
    if (gameState.hasWon) {
      const popup = leaflet.popup({ closeButton: false, autoClose: true })
        .setLatLng(e.latlng)
        .setContent("Game complete — press Play again to continue");
      popup.openOn(map);
      setTimeout(() => map.closePopup(popup), 900);
      return;
    }

    const gridDist = gridDistanceToPlayer(cell);

    if (gridDist <= PROXIMITY_DETECT_RADIUS) {
      // If already holding a token
      if (gameState.heldToken) {
        // If held exponent matches map exponent, attempt to deposit/merge
        if (gameState.heldToken!.exp === exp) {
          if (exp < TOKEN_MAX_EXP) {
            // merge: increment exponent on the map token
            exp = exp + 1;
            const newValue = 2 ** exp;
            // update tooltip
            const t = rect.getTooltip();
            if (t) {
              t.setContent(String(newValue));
            } else {
              rect.bindTooltip(String(newValue), {
                permanent: true,
                direction: "center",
                className: "token-label",
              });
            }
            // update stored exponent for this tile
            tokensMap.set(key, { layer: rect, exp });
            // consume held token
            gameState.heldToken = null;
            updateStatusPanel();
          } else {
            openTempPopup(e.latlng, `Token already at max value`);
          }
        } else {
          openTempPopup(
            e.latlng,
            `You are already carrying a different token (value ${
              2 ** gameState.heldToken!.exp
            })`,
          );
        }
      } else {
        // Pick up token into the single-slot inventory (do not award points now)
        tokensLayer.removeLayer(rect);
        tokensMap.delete(key);
        gameState.collectedSet.add(key);
        gameState.heldToken = { key, exp };
        updateStatusPanel();
      }
    } else {
      // Show a temporary popup indicating token is too far
      openTempPopup(e.latlng, `Too far — ${gridDist} gridspaces away`);
    }
  });

  tokensMap.set(key, { layer: rect, exp });
  tokensLayer.addLayer(rect);
}

// Create a token rectangle for a grid cell and bind a centered tooltip.
function createTokenRectangle(cell: GridCell, exp: number) {
  const bounds = gridCellToLatLngBounds(cell);
  const rect = leaflet.rectangle(bounds, {
    weight: 1,
    color: "#cc6600",
    fillColor: "#ff7f0e",
    fillOpacity: 0.2,
  });
  // Ensure tooltip is anchored at the cell center for perfect alignment
  const center = bounds.getCenter();
  rect.bindTooltip(String(2 ** exp), {
    permanent: true,
    direction: "center",
    className: "token-label",
  });
  // Force tooltip position to the exact center
  const tooltip = rect.getTooltip();
  if (tooltip) tooltip.setLatLng(center);
  return rect;
}

// Refresh tokens when the view changes or the map is resized
map.on("moveend", spawnTokens);
map.on("zoomend", spawnTokens);
map.on("resize", spawnTokens);

// Initial spawn
spawnTokens();

// //// //// //// //// //// ////
// GRID OVERLAY
// //// //// //// //// //// ////
leaflet.GridLayer = leaflet.GridLayer.extend({
  createTile: function (coords: { x: number; y: number; z: number }) {
    const tile = document.createElement("div");

    const size = TILE_SIZE_PX;
    // The tile's top-left in world pixel coordinates
    const tilePixelX = coords.x * size;
    const tilePixelY = coords.y * size;

    // Compute how far this tile's top-left is from the world origin, modulo tile size
    const offsetX = ((tilePixelX - WORLD_ORIGIN_POINT.x) % size + size) % size; // normalized 0..size-1
    const offsetY = ((tilePixelY - WORLD_ORIGIN_POINT.y) % size + size) % size;

    tile.style.width = `${size}px`;
    tile.style.height = `${size}px`;
    tile.style.pointerEvents = "none"; // allow clicks to hit the map
    tile.style.backgroundImage =
      `repeating-linear-gradient(to right, transparent 0 ${
        size - 1
      }px, orange ${
        size - 1
      }px ${size}px), repeating-linear-gradient(to bottom, transparent 0 ${
        size - 1
      }px, orange ${size - 1}px ${size}px)`;
    tile.style.backgroundSize = `${size}px ${size}px, ${size}px ${size}px`;
    tile.style.backgroundPosition =
      `${-offsetX}px ${-offsetY}px, ${-offsetX}px ${-offsetY}px`;

    return tile;
  },
});

leaflet.gridLayer = function (opts) {
  return new leaflet.GridLayer(opts);
};

map.addLayer(leaflet.gridLayer({
  tileSize: TILE_SIZE_PX,
}));

// For testing: UI shows grid cell info when user clicks the map (uses our conversion helpers)
/*
map.on("click", (e: LeafletMouseEvent) => {
  const cell = _latLngToGridCell(e.latlng);
  const bounds = gridCellToLatLngBounds(cell);
  const nw = bounds.getNorthWest();
  const se = bounds.getSouthEast();
  const content = `Cell: ${gridCellKey(cell)}<br/>NW: ${nw.lat.toFixed(6)}, ${
    nw.lng.toFixed(6)
  }<br/>SE: ${se.lat.toFixed(6)}, ${se.lng.toFixed(6)}`;
  openTempPopup(e.latlng, content, 1600);
});

map.setView([0, 0], GAMEPLAY_ZOOM_LEVEL);
*/
