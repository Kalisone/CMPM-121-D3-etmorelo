// @deno-types="npm:@types/leaflet"
import type { LatLng, LeafletMouseEvent } from "leaflet";
import leaflet from "leaflet";

import "leaflet/dist/leaflet.css";
import "./_leafletWorkaround.ts";
import luck from "./_luck.ts";
import "./style.css";

interface Token {
  key: string;
  exp: number;
}

class GameStateManager {
  public heldToken: Token | null = null;
  public collectedSet: Set<string> = new Set();
  public hasWon = false;

  constructor(
    private readonly winValue: number,
    private onStateChange: () => void,
  ) {}

  isCollected(key: string): boolean {
    return this.collectedSet.has(key);
  }

  collectToken(token: Token) {
    this.heldToken = token;
    this.collectedSet.add(token.key);
    this.checkWinCondition();
    this.onStateChange();
  }

  upgradeHeldToken() {
    if (this.heldToken) {
      this.heldToken.exp++;
      this.checkWinCondition();
      this.onStateChange();
    }
  }

  reset() {
    this.heldToken = null;
    this.collectedSet.clear();
    this.hasWon = false;
    this.onStateChange();
  }

  clearHeldToken() {
    this.heldToken = null;
    this.onStateChange();
  }

  private checkWinCondition() {
    if (this.heldToken && (2 ** this.heldToken.exp) === this.winValue) {
      this.hasWon = true;
    }
  }
}

class MapManager {
  public map: leaflet.Map;
  public playerMarker: leaflet.Marker;

  constructor(elementId: string, center: leaflet.LatLng, zoom: number) {
    this.map = leaflet.map(document.getElementById(elementId)!, {
      center: center,
      zoom: zoom,
      minZoom: zoom,
      maxZoom: zoom,
      zoomControl: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      scrollWheelZoom: false,
    });

    // Background
    leaflet.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap",
    }).addTo(this.map);

    // Player
    this.playerMarker = leaflet.marker(center).addTo(this.map);
    this.initPlayerTooltip();
  }

  public initPlayerTooltip() {
    this.playerMarker.bindTooltip("Player", {
      permanent: false,
      direction: "top",
      className: "player-label",
    });
  }

  movePlayer(latLng: leaflet.LatLng) {
    this.playerMarker.setLatLng(latLng);
    this.map.setView(latLng);
  }

  updatePlayerStatus(text: string) {
    this.playerMarker.setTooltipContent(text);
  }

  project(latlng: leaflet.LatLngExpression, zoom: number) {
    return this.map.project(leaflet.latLng(latlng), zoom);
  }

  unproject(point: leaflet.Point, zoom: number) {
    return this.map.unproject(point, zoom);
  }

  getBounds() {
    return this.map.getBounds();
  }

  addLayer(layer: leaflet.Layer) {
    this.map.addLayer(layer);
  }

  on<E = unknown>(event: string, handler: (e: E) => void) {
    (this.map as unknown as { on: (evt: string, h: (e: E) => void) => void })
      .on(event, handler);
  }

  openPopup(popup: leaflet.Popup) {
    popup.openOn(this.map);
  }

  closePopup(popup: leaflet.Popup) {
    this.map.closePopup(popup);
  }

  setView(latlng: leaflet.LatLngExpression, zoom?: number) {
    this.map.setView(latlng, zoom);
  }

  enableDragging() {
    this.map.dragging.enable();
  }

  disableDragging() {
    this.map.dragging.disable();
  }
}

interface GridCell {
  i: number;
  j: number;
}

class GridUtils {
  private map: leaflet.Map;
  private origin: leaflet.Point;
  private zoom: number;
  private tileSize: number;
  private getPlayerLatLng: () => LatLng;

  constructor(
    map: leaflet.Map,
    origin: leaflet.Point,
    zoom: number,
    tileSize: number,
    getPlayerLatLng: () => LatLng,
  ) {
    this.map = map;
    this.origin = origin;
    this.zoom = zoom;
    this.tileSize = tileSize;
    this.getPlayerLatLng = getPlayerLatLng;
  }

  getKey(cell: GridCell): string {
    return `${cell.i}:${cell.j}`;
  }

  parseKey(key: string): GridCell {
    const [iStr, jStr] = key.split(":");
    return { i: Number(iStr), j: Number(jStr) };
  }

  latLngToCell(latlng: LatLng): GridCell {
    const pt = this.map.project(latlng, this.zoom);
    const relX = pt.x - this.origin.x;
    const relY = pt.y - this.origin.y;
    const i = Math.floor(relX / this.tileSize);
    const j = Math.floor(relY / this.tileSize);
    return { i, j };
  }

  cellToLatLngBounds(cell: GridCell): leaflet.LatLngBounds {
    const nwTile = leaflet.point(
      this.origin.x + cell.i * this.tileSize,
      this.origin.y + cell.j * this.tileSize,
    );
    const seTile = leaflet.point(
      this.origin.x + (cell.i + 1) * this.tileSize,
      this.origin.y + (cell.j + 1) * this.tileSize,
    );
    const nwLatLng = this.map.unproject(nwTile, this.zoom);
    const seLatLng = this.map.unproject(seTile, this.zoom);
    return leaflet.latLngBounds([
      [nwLatLng.lat, nwLatLng.lng],
      [seLatLng.lat, seLatLng.lng],
    ]);
  }

  distanceToPlayer(cell: GridCell): number {
    const playerLatLng = this.getPlayerLatLng();
    const playerPt = this.map.project(playerLatLng, this.zoom);
    const relX = playerPt.x - this.origin.x;
    const relY = playerPt.y - this.origin.y;
    const playerI = Math.floor(relX / this.tileSize);
    const playerJ = Math.floor(relY / this.tileSize);
    const dx = Math.abs(cell.i - playerI);
    const dy = Math.abs(cell.j - playerJ);
    return dx + dy;
  }

  cellCenterLatLng(cell: GridCell): leaflet.LatLng {
    const bounds = this.cellToLatLngBounds(cell);
    return bounds.getCenter();
  }
}

// Create basic UI elements
const controlPanelDiv = document.createElement("div");
controlPanelDiv.id = "controlPanel";

const mapDiv = document.createElement("div");
mapDiv.id = "map";
document.body.append(mapDiv);
mapDiv.append(controlPanelDiv);

const inventoryBadge = document.createElement("div");
inventoryBadge.id = "inventoryBadge";
inventoryBadge.innerText = "Holding: none";
mapDiv.append(inventoryBadge);

const winBanner = document.createElement("div");
winBanner.id = "winBanner";
winBanner.innerHTML = `
  <div>You win!</div>
  <div style="margin-top:10px;"><button id="playAgain">Play again</button></div>
`;
winBanner.style.display = "none";
mapDiv.append(winBanner);

/**
 * Reset the game state and respawn tokens.
 *
 * Resets the `gameState` (clears held token and collected set) and
 * instructs the `TokenManager` to remove existing token layers and
 * spawn new tokens for the current view.
 */
function playAgain() {
  gameState.reset();
  tokenManager.clearAll();
  tokenManager.spawnTokens();
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

/*
 * MAP
 *
 * Initialize the Leaflet map with a base tile layer and the player
 * marker, and expose a `MapManager` instance used by the rest of the
 * application to perform map operations without touching Leaflet APIs
 * directly.
 */

const mapManager = new MapManager("map", CLASSROOM_LATLNG, GAMEPLAY_ZOOM_LEVEL);
const playerMarker = mapManager.playerMarker;

updateUI();

playerMarker.on("mouseover", () => {
  updateUI();
  playerMarker.openTooltip();
});

playerMarker.on("mouseout", () => {
  playerMarker.closeTooltip();
});

// On click, update and show the tooltip (do not pin it)
playerMarker.on("click", () => {
  updateUI();
  playerMarker.openTooltip();
});

updateUI();

/*
 * BUTTONS
 *
 * Build directional controls for moving the player one grid cell at a
 * time and a toggle for free-look mode. Controls include accessibility
 * attributes and minimal state handling.
 */

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

const DIRECTIONS = [
  { label: "↑", dx: 0, dy: -1, aria: "Move up" },
  { label: "←", dx: -1, dy: 0, aria: "Move left" },
  { label: "→", dx: 1, dy: 0, aria: "Move right" },
  { label: "↓", dx: 0, dy: 1, aria: "Move down" },
];

/**
 * Toggle free-look (map dragging) mode.
 *
 * When `enabled` is false the map recenters on the player's position and
 * dragging is disabled. When `enabled` is true dragging is enabled so the
 * user can pan independently of the player's marker.
 */
function setFreeLook(enabled: boolean) {
  freeLook = enabled;

  if (!enabled) {
    mapManager.disableDragging();

    mapManager.setView(playerMarker.getLatLng(), GAMEPLAY_ZOOM_LEVEL);
  } else {
    mapManager.enableDragging();
  }
}

let freeLook = false;

/**
 * Move the player by a grid delta (dx, dy).
 *
 * Preserves the player's intra-cell offset (so movement is in world pixel
 * space aligned to the grid anchor), updates the tooltip/UI, and spawns
 * tokens for newly-visible cells.
 */
function movePlayerBy(dx: number, dy: number) {
  const current = playerMarker.getLatLng();
  const currentPt = mapManager.project(current, GAMEPLAY_ZOOM_LEVEL);

  const relX = currentPt.x - WORLD_ORIGIN_POINT.x;
  const relY = currentPt.y - WORLD_ORIGIN_POINT.y;

  const newRelX = relX + dx * TILE_SIZE_PX;
  const newRelY = relY + dy * TILE_SIZE_PX;

  const newWorldX = WORLD_ORIGIN_POINT.x + newRelX;
  const newWorldY = WORLD_ORIGIN_POINT.y + newRelY;
  const newLatLng = mapManager.unproject(
    leaflet.point(newWorldX, newWorldY),
    GAMEPLAY_ZOOM_LEVEL,
  );

  playerMarker.setLatLng(newLatLng);
  updateUI();

  if (!freeLook) {
    mapManager.setView(newLatLng, GAMEPLAY_ZOOM_LEVEL);
  }

  spawnTokens();
}

/**
 * Update the player's tooltip to display the current grid cell key.
 *
 * Converts the marker's lat/lng to a grid cell using `gridUtils` and
 * updates or binds the tooltip accordingly.
 */
function updatePlayerTooltip() {
  try {
    const latlng = playerMarker.getLatLng();
    const cell = gridUtils!.latLngToCell(latlng);
    const content = `Player ${gridUtils!.getKey(cell)}`;
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

/**
 * Create the directional control UI container.
 *
 * Returns a DOM element containing directional buttons and a center
 * toggle. Buttons are wired to call `movePlayerBy` and `setFreeLook`.
 */
function createDirectionalControls() {
  const controlsContainer = document.createElement("div");
  controlsContainer.id = "directionalControls";
  controlsContainer.className = "directional-controls";

  const buttons: HTMLButtonElement[] = [];
  for (let i = 0; i < 5; i++) {
    const b = document.createElement("button");
    b.type = "button";
    buttons.push(b);
  }

  // Assign labels and aria-labels
  for (let i = 0; i < 4; i++) {
    buttons[i].innerText = DIRECTIONS[i].label;
  }
  buttons[4].innerHTML = PIN_SVG;
  buttons[4].setAttribute("aria-label", "Toggle free-look");

  for (let idx = 0; idx < buttons.length; idx++) {
    const button = buttons[idx];
    if (idx < 4) {
      const dir = DIRECTIONS[idx];
      button.addEventListener("click", () => {
        movePlayerBy(dir.dx, dir.dy);
      });
    } else {
      button.addEventListener("click", () => {
        const newState = !freeLook;
        setFreeLook(newState);
        button.innerHTML = newState ? EYE_SVG : PIN_SVG;
      });
    }
  }

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

  return controlsContainer;
}

controlPanelDiv.appendChild(createDirectionalControls());

setFreeLook(freeLook);

/*
 * TOKEN SPAWNING
 *
 * Spawn token rectangles for visible grid cells. Token spawn probability
 * and values are computed deterministically via the `luck` function and
 * distribution logic encapsulated in `TokenManager`.
 */

const WORLD_ORIGIN_POINT = mapManager.project(
  leaflet.latLng(0, 0),
  GAMEPLAY_ZOOM_LEVEL,
);

const gridUtils = new GridUtils(
  mapManager.map,
  WORLD_ORIGIN_POINT,
  GAMEPLAY_ZOOM_LEVEL,
  TILE_SIZE_PX,
  () => playerMarker.getLatLng(),
);

const cellStateMemento: Map<string, { hasToken?: boolean; exp?: number }> =
  new Map();

// Token spawning parameters
const TOKEN_SPAWN_PROBABILITY = 0.12;
const TOKEN_MAX_EXP = 4;
const WIN_VALUE = Math.pow(2, TOKEN_MAX_EXP);

const gameState = new GameStateManager(WIN_VALUE, updateUI);

// TokenManager encapsulates token layer and spawn logic
class TokenManager {
  public tokensLayer: leaflet.LayerGroup;
  public tokensMap: Map<string, { layer: leaflet.Layer; exp: number }>;

  private readonly expDistribution: number[];
  private readonly expSpawnMultiplier: number[];

  constructor(
    private readonly mapManager: MapManager,
    private readonly gridUtils: GridUtils,
    private readonly gameState: GameStateManager,
    private readonly luckFn: (k: string) => number,
    private readonly tileSize: number,
    private readonly zoom: number,
    private readonly spawnProbability: number,
    private readonly maxExp: number,
    private readonly proximityRadius: number,
  ) {
    const _expWeights: number[] = [];
    for (let e = 0; e <= this.maxExp; e++) {
      _expWeights.push(1 / Math.pow(2, e));
    }
    const expTotal = _expWeights.reduce((s, v) => s + v, 0);
    this.expDistribution = [];
    let acc = 0;
    for (let e = 0; e <= this.maxExp; e++) {
      acc += _expWeights[e] / expTotal;
      this.expDistribution.push(acc);
    }
    this.expSpawnMultiplier = _expWeights.map((w) => w / _expWeights[0]);

    this.tokensLayer = leaflet.layerGroup();
    this.tokensLayer.addTo(this.mapManager.map);
    this.tokensMap = new Map();
  }

  clearAll() {
    this.tokensLayer.clearLayers();
    this.tokensMap.clear();
  }

  spawnTokens() {
    const bounds = this.mapManager.getBounds();
    const nw = bounds.getNorthWest();
    const se = bounds.getSouthEast();
    const nwPt = this.mapManager.project(nw, this.zoom);
    const sePt = this.mapManager.project(se, this.zoom);

    const nwRelX = nwPt.x - WORLD_ORIGIN_POINT.x;
    const seRelX = sePt.x - WORLD_ORIGIN_POINT.x;
    const nwRelY = nwPt.y - WORLD_ORIGIN_POINT.y;
    const seRelY = sePt.y - WORLD_ORIGIN_POINT.y;

    const minI = Math.floor(Math.min(nwRelX, seRelX) / this.tileSize);
    const maxI = Math.floor((Math.max(nwRelX, seRelX) - 1) / this.tileSize);
    const minJ = Math.floor(Math.min(nwRelY, seRelY) / this.tileSize);
    const maxJ = Math.floor((Math.max(nwRelY, seRelY) - 1) / this.tileSize);

    // Build a set of visible cell keys for this viewport.
    const visibleKeys = new Set<string>();
    for (let i = minI; i <= maxI; i++) {
      for (let j = minJ; j <= maxJ; j++) {
        visibleKeys.add(this.gridUtils.getKey({ i, j }));
      }
    }

    // Now spawn tokens for visible cells (flyweight checks occur in trySpawnCell)
    for (let i = minI; i <= maxI; i++) {
      for (let j = minJ; j <= maxJ; j++) {
        this.trySpawnCell({ i, j });
      }
    }
  }

  public trySpawnCell(cell: GridCell) {
    const key = this.gridUtils.getKey(cell);

    if (this.gameState.isCollected(key)) return;

    const existing = this.tokensMap.get(key);
    if (existing) {
      if (!this.tokensLayer.hasLayer(existing.layer)) {
        this.tokensLayer.addLayer(existing.layer);
      }
      return;
    }

    const memento = cellStateMemento.get(key);
    let exp = 0;
    if (memento) {
      if (memento.hasToken === false) return;
      exp = memento.exp ?? 0;
    } else {
      const vRand = this.luckFn(key + ":value");
      for (let e = 0; e <= this.maxExp; e++) {
        if (vRand < this.expDistribution[e]) {
          exp = e;
          break;
        }
      }

      const spawnRand = this.luckFn(key + ":spawn");
      const spawnThreshold = this.spawnProbability *
        this.expSpawnMultiplier[exp];
      if (!(spawnRand < spawnThreshold)) return;
    }

    const rect = this.createTokenRectangle(cell, exp);

    rect.on("click", (e: LeafletMouseEvent) => {
      if (this.gameState.hasWon) {
        const popup = leaflet.popup({ closeButton: false, autoClose: true })
          .setLatLng(e.latlng)
          .setContent("Game complete — press Play again to continue");
        this.mapManager.openPopup(popup);
        setTimeout(() => this.mapManager.closePopup(popup), 900);
        return;
      }

      const gridDist = this.gridUtils.distanceToPlayer(cell);

      if (gridDist <= this.proximityRadius) {
        if (this.gameState.heldToken) {
          if (this.gameState.heldToken!.exp === exp) {
            if (exp < this.maxExp) {
              exp = exp + 1;
              const newValue = 2 ** exp;
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
              this.tokensMap.set(key, { layer: rect, exp });
              cellStateMemento.set(key, { hasToken: true, exp });
              this.gameState.clearHeldToken();
            } else {
              const popup = leaflet.popup({
                closeButton: false,
                autoClose: true,
              })
                .setLatLng(e.latlng)
                .setContent(`Token already at max value`);
              this.mapManager.openPopup(popup);
              setTimeout(() => this.mapManager.closePopup(popup), 900);
            }
          } else {
            const popup = leaflet.popup({ closeButton: false, autoClose: true })
              .setLatLng(e.latlng)
              .setContent(
                `You are already carrying a different token (value ${
                  2 ** this.gameState.heldToken!.exp
                })`,
              );
            this.mapManager.openPopup(popup);
            setTimeout(() => this.mapManager.closePopup(popup), 900);
          }
        } else {
          this.tokensLayer.removeLayer(rect);
          this.tokensMap.delete(key);
          cellStateMemento.set(key, { hasToken: false });
          this.gameState.collectToken({ key, exp });
        }
      } else {
        const popup = leaflet.popup({ closeButton: false, autoClose: true })
          .setLatLng(e.latlng)
          .setContent(`Too far — ${gridDist} gridspaces away`);
        this.mapManager.openPopup(popup);
        setTimeout(() => this.mapManager.closePopup(popup), 900);
      }
    });

    this.tokensMap.set(key, { layer: rect, exp });
    this.tokensLayer.addLayer(rect);
  }

  public createTokenRectangle(cell: GridCell, exp: number) {
    const bounds = this.gridUtils.cellToLatLngBounds(cell);
    const rect = leaflet.rectangle(bounds, {
      weight: 1,
      color: "#cc6600",
      fillColor: "#ff7f0e",
      fillOpacity: 0.2,
    });
    const center = bounds.getCenter();
    rect.bindTooltip(String(2 ** exp), {
      permanent: true,
      direction: "center",
      className: "token-label",
    });
    const tooltip = rect.getTooltip();
    if (tooltip) tooltip.setLatLng(center);
    return rect;
  }
}

// Create the token manager
const tokenManager = new TokenManager(
  mapManager,
  gridUtils,
  gameState,
  luck,
  TILE_SIZE_PX,
  GAMEPLAY_ZOOM_LEVEL,
  TOKEN_SPAWN_PROBABILITY,
  TOKEN_MAX_EXP,
  PROXIMITY_DETECT_RADIUS,
);
/**
 * Update inventory and win UI elements.
 *
 * Reads `gameState` to set the on-map inventory badge and to toggle the
 * win banner when the player has obtained the winning token value.
 */
function updateStatusPanel() {
  const holding = gameState.heldToken
    ? `Holding: ${2 ** gameState.heldToken.exp}`
    : "Holding: none";
  // Also update the on-map inventory badge
  if (inventoryBadge) inventoryBadge.innerText = holding;
  // Show win banner when player is holding the max-value token (manager tracks win state)
  if (gameState.hasWon) {
    winBanner.classList.add("show-win");
  } else {
    winBanner.classList.remove("show-win");
  }
}
updateUI();

/**
 * Refresh UI elements tied to game state and player position.
 *
 * Calls `updateStatusPanel` and `updatePlayerTooltip` inside a try/catch
 * to avoid UI updates breaking gameplay flow.
 */
function updateUI() {
  try {
    updateStatusPanel();
    updatePlayerTooltip();
  } catch (error) {
    console.log("Error updating UI", error);
  }
}

/**
 * Show a temporary popup at `latlng` with the provided content and auto-
 * close it after `duration` milliseconds.
 */
function _openTempPopup(
  latlng: LatLng,
  content: string,
  duration = SPAWN_ANIMATION_DURATION_MS,
) {
  const popup = leaflet.popup({ closeButton: false, autoClose: true })
    .setLatLng(latlng)
    .setContent(content);
  mapManager.openPopup(popup);
  setTimeout(() => mapManager.closePopup(popup), duration);
}

/**
 * Spawn tokens for all grid cells that intersect the visible map bounds.
 *
 * Converts the map bounds to world pixel coordinates relative to the
 * `WORLD_ORIGIN_POINT` and iterates the covered grid cells, delegating
 * to `trySpawnCell` for each cell.
 */
function spawnTokens() {
  const bounds = mapManager.getBounds();

  const nw = bounds.getNorthWest();
  const se = bounds.getSouthEast();

  const nwPt = mapManager.project(nw, GAMEPLAY_ZOOM_LEVEL);
  const sePt = mapManager.project(se, GAMEPLAY_ZOOM_LEVEL);

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

/**
 * Compatibility wrapper to delegate a single cell spawn attempt to the
 * `TokenManager` instance.
 */
function trySpawnCell(cell: GridCell) {
  // "flyweight" check: skip if memento says no token
  const key = gridUtils.getKey(cell);
  const m = cellStateMemento.get(key);
  if (m && m.hasToken === false) return;

  tokenManager.trySpawnCell(cell);
}

mapManager.on("moveend", spawnTokens);
mapManager.on("zoomend", spawnTokens);
mapManager.on("resize", spawnTokens);

spawnTokens();

/*
 * GRID OVERLAY
 *
 * Render a custom grid layer aligned to the `WORLD_ORIGIN_POINT` so that
 * visual grid lines line up with the logical grid cells used by the
 * gameplay code. Tiles are styled with repeating linear gradients sized
 * to `TILE_SIZE_PX`.
 */
leaflet.GridLayer = leaflet.GridLayer.extend({
  createTile: function (coords: { x: number; y: number; z: number }) {
    const tile = document.createElement("div");

    const size = TILE_SIZE_PX;
    const tilePixelX = coords.x * size;
    const tilePixelY = coords.y * size;

    const offsetX = ((tilePixelX - WORLD_ORIGIN_POINT.x) % size + size) % size;
    const offsetY = ((tilePixelY - WORLD_ORIGIN_POINT.y) % size + size) % size;

    tile.style.width = `${size}px`;
    tile.style.height = `${size}px`;
    tile.style.pointerEvents = "none";
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

mapManager.addLayer(leaflet.gridLayer({
  tileSize: TILE_SIZE_PX,
}));

// For testing: UI shows grid cell info when user clicks the map (uses our conversion helpers)
/*
map.on("click", (e: LeafletMouseEvent) => {
  const cell = gridUtils!.latLngToCell(e.latlng);
  const bounds = gridUtils!.cellToLatLngBounds(cell);
  const nw = bounds.getNorthWest();
  const se = bounds.getSouthEast();
  const content = `Cell: ${gridUtils!.getKey(cell)}<br/>NW: ${nw.lat.toFixed(6)}, ${
    nw.lng.toFixed(6)
  }<br/>SE: ${se.lat.toFixed(6)}, ${se.lng.toFixed(6)}`;
  openTempPopup(e.latlng, content, 1600);
});

map.setView([0, 0], GAMEPLAY_ZOOM_LEVEL);
*/
