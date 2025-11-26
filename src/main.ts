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

/**
 * GameStateManager
 *
 * Tracks the player's current held token, which grid cells have been
 * collected during this play session, and whether the win condition
 * has been met. Exposes methods to mutate state and notify a
 * UI/state-change callback.
 */
class GameStateManager {
  public heldToken: Token | null = null;
  public collectedSet: Set<string> = new Set();
  public hasWon = false;
  private readonly storageKey = "gameState";

  constructor(
    private readonly winValue: number,
    private onStateChange: () => void,
  ) {
    this.loadFromLocalStorage();
  }

  private loadFromLocalStorage() {
    try {
      const saved = localStorage.getItem(this.storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        this.heldToken = parsed.heldToken || null;
        this.collectedSet = new Set(parsed.collectedSet || []);
        this.hasWon = parsed.hasWon || false;
      }
    } catch (error) {
      console.warn("Failed to load game state from localStorage:", error);
    }
  }

  private saveToLocalStorage() {
    try {
      const data = {
        heldToken: this.heldToken,
        collectedSet: Array.from(this.collectedSet),
        hasWon: this.hasWon,
      };
      localStorage.setItem(this.storageKey, JSON.stringify(data));
    } catch (error) {
      console.warn("Failed to save game state to localStorage:", error);
    }
  }

  isCollected(key: string): boolean {
    return this.collectedSet.has(key);
  }
  collectToken(token: Token) {
    this.heldToken = token;
    this.collectedSet.add(token.key);
    this.checkWinCondition();
    this.saveToLocalStorage();
    this.onStateChange();
  }
  upgradeHeldToken() {
    if (this.heldToken) {
      this.heldToken.exp++;
      this.checkWinCondition();
      this.saveToLocalStorage();
      this.onStateChange();
    }
  }
  reset() {
    this.heldToken = null;
    this.collectedSet.clear();
    this.hasWon = false;
    try {
      localStorage.removeItem(this.storageKey);
    } catch (error) {
      console.warn("Failed to remove game state from localStorage:", error);
    }
    this.onStateChange();
  }
  clearHeldToken() {
    this.heldToken = null;
    this.saveToLocalStorage();
    this.onStateChange();
  }
  private checkWinCondition() {
    if (this.heldToken && (2 ** this.heldToken.exp) === this.winValue) {
      this.hasWon = true;
    }
  }
}

/**
 * MapManager
 *
 * Lightweight wrapper around a Leaflet map instance that centralizes
 * common map operations used throughout the app (marker, view, layer
 * management and event hookup).
 */
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

  // Attach an event handler to the underlying Leaflet map.
  on<E = unknown>(event: string, handler: (e: E) => void) {
    (this.map as unknown as { on: (evt: string, h: (e: E) => void) => void })
      .on(event, handler);
  }

  // Open a popup on the map.
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

/**
 * GridUtils
 *
 * Provides conversions between world pixel coordinates and the
 * logical grid used by the game: mapping lat/lng to tile indices,
 * computing cell bounds and distances relative to the player.
 */
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
    // Convert a LatLng into integer grid indices based on the world
    // origin and configured tile size.
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

class UIManager {
  private controlPanel: HTMLElement;
  private inventoryBadge: HTMLElement;
  private winBanner: HTMLElement;
  private currentFreeLook = false;
  private onToggle?: (enabled: boolean) => void;

  constructor(
    private containerId: string,
    private onMove: (dx: number, dy: number) => void,
    private onReset: () => void,
  ) {
    const mapDiv = document.createElement("div");
    mapDiv.id = this.containerId;
    document.body.append(mapDiv);

    this.controlPanel = document.createElement("div");
    this.controlPanel.id = "controlPanel";
    mapDiv.append(this.controlPanel);

    this.inventoryBadge = document.createElement("div");
    this.inventoryBadge.id = "inventoryBadge";
    this.inventoryBadge.innerText = "Holding: none";
    mapDiv.append(this.inventoryBadge);

    this.winBanner = document.createElement("div");
    this.winBanner.id = "winBanner";
    this.winBanner.innerHTML = `
      <div>You win!</div>
      <div class="win-banner-actions"><button id="playAgain">Play again</button></div>
    `;
    mapDiv.append(this.winBanner);

    // Play again button listener
    this.winBanner.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (target && target.id === "playAgain") this.onReset();
    });

    this.buildDirectionalControls();
    this.buildResetButton(mapDiv);
  }

  private buildDirectionalControls() {
    const controlsContainer = document.createElement("div");
    controlsContainer.id = "directionalControls";
    controlsContainer.className = "directional-controls";

    const buttons: HTMLButtonElement[] = [];
    for (let i = 0; i < 5; i++) {
      const b = document.createElement("button");
      b.type = "button";
      buttons.push(b);
    }

    // Assign labels and aria attributes
    for (let i = 0; i < 4; i++) {
      buttons[i].innerText = DIRECTIONS[i].label;
    }
    buttons[4].innerHTML = PIN_SVG;
    buttons[4].setAttribute("aria-label", "Toggle free-look");
    buttons[4].title = "View: Player Lock";

    for (let idx = 0; idx < buttons.length; idx++) {
      const button = buttons[idx];
      if (idx < 4) {
        const dir = DIRECTIONS[idx];
        button.addEventListener("click", () => {
          this.onMove(dir.dx, dir.dy);
        });
      } else if (idx === 4) {
        button.addEventListener("click", () => {
          const newState = !this.currentFreeLook;
          this.currentFreeLook = newState;
          if (this.onToggle) this.onToggle(newState);
          button.innerHTML = newState ? EYE_SVG : PIN_SVG;
          button.title = newState ? "View: Free Look" : "View: Player Lock";
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

    this.controlPanel.appendChild(controlsContainer);
  }

  buildResetButton(container: HTMLElement) {
    // Create reset button in top-left corner
    const resetButton = document.createElement("button");
    resetButton.type = "button";
    resetButton.id = "resetButton";
    resetButton.innerText = "🔄";
    resetButton.setAttribute("aria-label", "Reset game");
    resetButton.title = "Reset Game";
    resetButton.addEventListener("click", () => {
      if (
        confirm(
          "Reset game? This will clear all saved data and reload the page.",
        )
      ) {
        localStorage.clear();
        location.reload();
      }
    });
    container.append(resetButton);
  }

  updateInventory(label: string) {
    this.inventoryBadge.innerText = label;
  }

  toggleWinState(hasWon: boolean) {
    if (hasWon) {
      this.winBanner.classList.add("show-win");
    } else {
      this.winBanner.classList.remove("show-win");
    }
  }

  setReset(onReset: () => void) {
    // Replace reset handler used by the play-again button
    this.onReset = onReset;
  }

  setMoveHandler(onMove: (dx: number, dy: number) => void) {
    this.onMove = onMove;
  }

  setToggleHandler(onToggle: (enabled: boolean) => void) {
    this.onToggle = onToggle;
  }
}

// Instantiate UI manager (map element needs to exist before MapManager)
// Use no-op handlers here and wire real handlers after `game` exists.
const uiManager = new UIManager(
  "map",
  (_dx, _dy) => {},
  () => {},
);

// Wire the UI toggle to the free-look setter so clicks enable/disable dragging.
uiManager.setToggleHandler((enabled: boolean) => setFreeLook(enabled));

// Our classroom location
// Centralized game tuning/configuration
const GameConfig = {
  CLASSROOM_LAT: 36.997936938057016,
  CLASSROOM_LNG: -122.05703507501151,
  GAMEPLAY_ZOOM_LEVEL: 19,
  TILE_SIZE_PX: 60,
  PROXIMITY_DETECT_RADIUS: 6,
  SPAWN_ANIMATION_DURATION_MS: 900,
  TOKEN_SPAWN_PROBABILITY: 0.12,
  TOKEN_MAX_EXP: 4,
} as const;

const CLASSROOM_LATLNG = leaflet.latLng(
  GameConfig.CLASSROOM_LAT,
  GameConfig.CLASSROOM_LNG,
);

/*
 * MAP
 *
 * Initialize the Leaflet map with a base tile layer and the player
 * marker, and expose a `MapManager` instance used by the rest of the
 * application to perform map operations without touching Leaflet APIs
 * directly.
 */

const mapManager = new MapManager(
  "map",
  CLASSROOM_LATLNG,
  GameConfig.GAMEPLAY_ZOOM_LEVEL,
);
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

/**
 * Toggle free-look (map dragging) mode.
 *
 * When `enabled` is false the map recenters on the player's position and
 * dragging is disabled. When `enabled` is true dragging is enabled so the
 * user can pan independently of the player's marker.
 */
function setFreeLook(enabled: boolean) {
  // Prefer Game method when available (new OO entrypoint).
  const _g1 = (globalThis as unknown as { game?: Game }).game;
  if (_g1) {
    _g1.setFreeLook(enabled);
    return;
  }

  freeLook = enabled;

  if (!enabled) {
    mapManager.disableDragging();

    mapManager.setView(
      playerMarker.getLatLng(),
      GameConfig.GAMEPLAY_ZOOM_LEVEL,
    );
    // If the token manager is available, rebuild the visible grid so the
    // camera-lock (programmatic follow) view matches the player's new
    // position. Use `typeof` check to avoid referencing the const before
    // it's initialized during startup.
    try {
      if (typeof tokenManager !== "undefined" && tokenManager) {
        tokenManager.reconcileVisible();
        spawnTokens();
      }
    } catch {
      // tokenManager not yet initialized; ignore
    }
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

/**
 * Update the player's tooltip to display the current grid cell key.
 *
 * Converts the marker's lat/lng to a grid cell using `gridUtils` and
 * updates or binds the tooltip accordingly.
 */
function updatePlayerTooltip() {
  // Delegate to Game when available.
  const _g2 = (globalThis as unknown as { game?: Game }).game;
  if (_g2) {
    try {
      _g2.updatePlayerTooltip();
    } catch (error) {
      console.log("Error updating player tooltip via game", error);
    }
    return;
  }

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
  GameConfig.GAMEPLAY_ZOOM_LEVEL,
);

const gridUtils = new GridUtils(
  mapManager.map,
  WORLD_ORIGIN_POINT,
  GameConfig.GAMEPLAY_ZOOM_LEVEL,
  GameConfig.TILE_SIZE_PX,
  () => playerMarker.getLatLng(),
);

class BoardState {
  // The "Memento"
  private state: Map<string, { hasToken?: boolean; exp?: number }> = new Map();
  private readonly storageKey = "boardState";

  constructor() {
    this.loadFromLocalStorage();
  }

  private loadFromLocalStorage() {
    try {
      const saved = localStorage.getItem(this.storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        this.state = new Map(Object.entries(parsed));
      }
    } catch (error) {
      console.warn("Failed to load board state from localStorage:", error);
    }
  }

  private saveToLocalStorage() {
    try {
      const obj = Object.fromEntries(this.state);
      localStorage.setItem(this.storageKey, JSON.stringify(obj));
    } catch (error) {
      console.warn("Failed to save board state to localStorage:", error);
    }
  }

  get(key: string) {
    return this.state.get(key);
  }

  set(key: string, value: { hasToken?: boolean; exp?: number }) {
    this.state.set(key, value);
    this.saveToLocalStorage();
  }

  reset() {
    this.state.clear();
    try {
      localStorage.removeItem(this.storageKey);
    } catch (error) {
      console.warn("Failed to remove board state from localStorage:", error);
    }
  }
}

const boardState = new BoardState();

// Token spawning parameters are in `GameConfig`.
const WIN_VALUE = Math.pow(2, GameConfig.TOKEN_MAX_EXP);

const gameState = new GameStateManager(WIN_VALUE, updateUI);

// Declare `game` early as undefined so other startup helpers can safely
// check for its presence without triggering the temporal dead zone.
// deno-lint-ignore prefer-const
let game: Game | undefined;

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

  // Reconcile visible tokens against the current viewport without
  // clearing everything. This removes off-screen token layers and
  // creates missing token layers for newly-visible cells.
  reconcileVisible() {
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

    const visibleKeys = new Set<string>();
    for (let i = minI; i <= maxI; i++) {
      for (let j = minJ; j <= maxJ; j++) {
        visibleKeys.add(this.gridUtils.getKey({ i, j }));
      }
    }

    // Remove off-screen token layers
    for (const [k, v] of Array.from(this.tokensMap.entries())) {
      if (!visibleKeys.has(k)) {
        if (this.tokensLayer.hasLayer(v.layer)) {
          this.tokensLayer.removeLayer(v.layer);
        }
        this.tokensMap.delete(k);
      }
    }

    // Add tokens for newly-visible cells only
    for (const key of visibleKeys) {
      if (!this.tokensMap.has(key)) {
        const cell = this.gridUtils.parseKey(key);
        this.trySpawnCell(cell);
      }
    }
  }

  // Remove all token layers and clear the internal tokens map.

  // Determine visible grid cells for the current viewport and ensure
  // tokens for those cells are present. Off-screen token layers are
  // removed to free memory; logical state is preserved in the memento.
  spawnTokens() {
    // Reconcile visible tokens (adds new, removes off-screen)
    this.reconcileVisible();
  }

  /**
   * Update inventory and win UI elements.
   *
   * Uses flyweight check + deterministic generation, checks memento first
   */
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

    const memento = boardState.get(key);
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
        setTimeout(
          () => this.mapManager.closePopup(popup),
          GameConfig.SPAWN_ANIMATION_DURATION_MS,
        );
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
              boardState.set(key, { hasToken: true, exp });
              this.gameState.clearHeldToken();
            } else {
              const popup = leaflet.popup({
                closeButton: false,
                autoClose: true,
              })
                .setLatLng(e.latlng)
                .setContent(`Token already at max value`);
              this.mapManager.openPopup(popup);
              setTimeout(
                () => this.mapManager.closePopup(popup),
                GameConfig.SPAWN_ANIMATION_DURATION_MS,
              );
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
            setTimeout(
              () => this.mapManager.closePopup(popup),
              GameConfig.SPAWN_ANIMATION_DURATION_MS,
            );
          }
        } else {
          this.tokensLayer.removeLayer(rect);
          this.tokensMap.delete(key);
          boardState.set(key, { hasToken: false });
          this.gameState.collectToken({ key, exp });
        }
      } else {
        const popup = leaflet.popup({ closeButton: false, autoClose: true })
          .setLatLng(e.latlng)
          .setContent(`Too far — ${gridDist} gridspaces away`);
        this.mapManager.openPopup(popup);
        setTimeout(
          () => this.mapManager.closePopup(popup),
          GameConfig.SPAWN_ANIMATION_DURATION_MS,
        );
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

  // Create a visible rectangle layer for a token with the given exponent.
}

// Create the token manager
const tokenManager = new TokenManager(
  mapManager,
  gridUtils,
  gameState,
  luck,
  GameConfig.TILE_SIZE_PX,
  GameConfig.GAMEPLAY_ZOOM_LEVEL,
  GameConfig.TOKEN_SPAWN_PROBABILITY,
  GameConfig.TOKEN_MAX_EXP,
  GameConfig.PROXIMITY_DETECT_RADIUS,
);

/**
 * Game class that encapsulates higher-level game operations and ties
 * together the map, UI, token manager and state containers. This class
 * wraps existing global functions so the codebase can migrate towards
 * an object-oriented structure without changing program flow.
 */
class Game {
  public freeLook: boolean = false;

  constructor(
    private readonly mapManager: MapManager,
    private readonly gridUtils: GridUtils,
    private readonly gameState: GameStateManager,
    private readonly uiManager: UIManager,
    private readonly boardState: BoardState,
    private tokenManager?: TokenManager,
  ) {}

  handlePlayerMove(dx: number, dy: number) {
    const current = this.mapManager.playerMarker.getLatLng();
    const currentPt = this.mapManager.project(
      current,
      GameConfig.GAMEPLAY_ZOOM_LEVEL,
    );

    const relX = currentPt.x - WORLD_ORIGIN_POINT.x;
    const relY = currentPt.y - WORLD_ORIGIN_POINT.y;

    const newRelX = relX + dx * GameConfig.TILE_SIZE_PX;
    const newRelY = relY + dy * GameConfig.TILE_SIZE_PX;

    const newWorldX = WORLD_ORIGIN_POINT.x + newRelX;
    const newWorldY = WORLD_ORIGIN_POINT.y + newRelY;
    const newLatLng = this.mapManager.unproject(
      leaflet.point(newWorldX, newWorldY),
      GameConfig.GAMEPLAY_ZOOM_LEVEL,
    );

    this.mapManager.playerMarker.setLatLng(newLatLng);
    this.onStateChange();

    if (!this.freeLook) {
      this.mapManager.setView(newLatLng, GameConfig.GAMEPLAY_ZOOM_LEVEL);
    }

    // Rebuild visible grid from scratch on every move (reconcile instead of clearing)
    this.spawnTokens();
  }

  setTokenManager(tm: TokenManager) {
    this.tokenManager = tm;
  }

  onStateChange() {
    try {
      this.updateStatusPanel();
      this.updatePlayerTooltip();
    } catch (error) {
      console.log("Error updating UI", error);
    }
  }

  updateStatusPanel() {
    const holding = this.gameState.heldToken
      ? `Holding: ${2 ** this.gameState.heldToken.exp}`
      : "Holding: none";
    this.uiManager.updateInventory(holding);
    this.uiManager.toggleWinState(this.gameState.hasWon);
  }

  updatePlayerTooltip() {
    try {
      const latlng = this.mapManager.playerMarker.getLatLng();
      const cell = this.gridUtils.latLngToCell(latlng);
      const content = `Player ${this.gridUtils.getKey(cell)}`;
      const t = this.mapManager.playerMarker.getTooltip();
      if (t) {
        t.setContent(content);
      } else {
        this.mapManager.playerMarker.bindTooltip(content, {
          permanent: false,
          direction: "top",
          className: "player-label",
        });
      }
    } catch (error) {
      console.log("Error updating player tooltip", error);
    }
  }

  openTempPopup(
    latlng: LatLng,
    content: string,
    duration = GameConfig.SPAWN_ANIMATION_DURATION_MS,
  ) {
    const popup = leaflet.popup({ closeButton: false, autoClose: true })
      .setLatLng(latlng)
      .setContent(content);
    this.mapManager.openPopup(popup);
    setTimeout(() => this.mapManager.closePopup(popup), duration);
  }

  spawnTokens() {
    const bounds = this.mapManager.getBounds();

    const nw = bounds.getNorthWest();
    const se = bounds.getSouthEast();

    const nwPt = this.mapManager.project(nw, GameConfig.GAMEPLAY_ZOOM_LEVEL);
    const sePt = this.mapManager.project(se, GameConfig.GAMEPLAY_ZOOM_LEVEL);

    const nwRelX = nwPt.x - WORLD_ORIGIN_POINT.x;
    const seRelX = sePt.x - WORLD_ORIGIN_POINT.x;
    const nwRelY = nwPt.y - WORLD_ORIGIN_POINT.y;
    const seRelY = sePt.y - WORLD_ORIGIN_POINT.y;

    const minI = Math.floor(Math.min(nwRelX, seRelX) / GameConfig.TILE_SIZE_PX);
    const maxI = Math.floor(
      (Math.max(nwRelX, seRelX) - 1) / GameConfig.TILE_SIZE_PX,
    );
    const minJ = Math.floor(Math.min(nwRelY, seRelY) / GameConfig.TILE_SIZE_PX);
    const maxJ = Math.floor(
      (Math.max(nwRelY, seRelY) - 1) / GameConfig.TILE_SIZE_PX,
    );

    for (let i = minI; i <= maxI; i++) {
      for (let j = minJ; j <= maxJ; j++) {
        this.trySpawnCell({ i, j });
      }
    }
  }

  trySpawnCell(cell: GridCell) {
    const key = this.gridUtils.getKey(cell);
    const m = this.boardState.get(key);
    if (m && m.hasToken === false) return;
    this.tokenManager?.trySpawnCell(cell);
  }

  setFreeLook(enabled: boolean) {
    this.freeLook = enabled;
    if (!enabled) {
      this.mapManager.disableDragging();
      this.mapManager.setView(
        this.mapManager.playerMarker.getLatLng(),
        GameConfig.GAMEPLAY_ZOOM_LEVEL,
      );
      try {
        if (this.tokenManager) {
          this.spawnTokens();
        }
      } catch {
        // ignore
      }
    } else {
      this.mapManager.enableDragging();
    }
  }

  resetGame() {
    this.gameState.reset();
    this.boardState.reset();
    this.tokenManager?.clearAll();
    this.spawnTokens();
  }
}

// Instantiate the Game object to start migrating global behaviors
game = new Game(
  mapManager,
  gridUtils,
  gameState,
  uiManager,
  boardState,
  tokenManager,
);

// Make the `game` instance available on `globalThis` so startup helpers
// can check for presence without causing TDZ errors by referencing the
// `game` identifier itself.
(globalThis as unknown as { game?: Game }).game = game;

// Wire the UI reset and move handlers to the Game instance (guarded)
uiManager.setReset(() =>
  (globalThis as unknown as { game?: Game }).game?.resetGame()
);
uiManager.setMoveHandler((dx, dy) =>
  (globalThis as unknown as { game?: Game }).game?.handlePlayerMove(dx, dy)
);

/**
 * Update inventory and win UI elements.
 *
 * Reads `gameState` to set the on-map inventory badge and to toggle the
 * win banner when the player has obtained the winning token value.
 */
function updateStatusPanel() {
  // Prefer Game's status panel when available
  const _g3 = (globalThis as unknown as { game?: Game }).game;
  if (_g3) {
    try {
      _g3.updateStatusPanel();
    } catch (error) {
      console.log("Error updating status via game", error);
    }
    return;
  }

  const holding = gameState.heldToken
    ? `Holding: ${2 ** gameState.heldToken.exp}`
    : "Holding: none";
  // Update the on-map inventory badge and win banner via UI manager
  uiManager.updateInventory(holding);
  uiManager.toggleWinState(gameState.hasWon);
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
    // Game has its own UI update orchestration; prefer it when present.
    const _g4 = (globalThis as unknown as { game?: Game }).game;
    if (_g4) {
      _g4.onStateChange();
    } else {
      updateStatusPanel();
      updatePlayerTooltip();
    }
  } catch (error) {
    console.log("Error updating UI", error);
  }
}

/**
 * Show a temporary popup at `latlng` with the provided content and auto-
 * close it after `duration` milliseconds. Used for testing.
 */
function _openTempPopup(
  latlng: LatLng,
  content: string,
  duration = GameConfig.SPAWN_ANIMATION_DURATION_MS,
) {
  // Prefer Game method if present
  const _g5 = (globalThis as unknown as { game?: Game }).game;
  if (_g5) {
    _g5.openTempPopup(latlng, content, duration);
    return;
  }

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
  // Delegate to Game when available; otherwise use the existing logic.
  const _g6 = (globalThis as unknown as { game?: Game }).game;
  if (_g6) {
    _g6.spawnTokens();
    return;
  }

  const bounds = mapManager.getBounds();

  const nw = bounds.getNorthWest();
  const se = bounds.getSouthEast();

  const nwPt = mapManager.project(nw, GameConfig.GAMEPLAY_ZOOM_LEVEL);
  const sePt = mapManager.project(se, GameConfig.GAMEPLAY_ZOOM_LEVEL);

  const nwRelX = nwPt.x - WORLD_ORIGIN_POINT.x;
  const seRelX = sePt.x - WORLD_ORIGIN_POINT.x;
  const nwRelY = nwPt.y - WORLD_ORIGIN_POINT.y;
  const seRelY = sePt.y - WORLD_ORIGIN_POINT.y;

  const minI = Math.floor(Math.min(nwRelX, seRelX) / GameConfig.TILE_SIZE_PX);
  const maxI = Math.floor(
    (Math.max(nwRelX, seRelX) - 1) / GameConfig.TILE_SIZE_PX,
  );
  const minJ = Math.floor(Math.min(nwRelY, seRelY) / GameConfig.TILE_SIZE_PX);
  const maxJ = Math.floor(
    (Math.max(nwRelY, seRelY) - 1) / GameConfig.TILE_SIZE_PX,
  );

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
  const m = boardState.get(key);
  if (m && m.hasToken === false) return;

  const _g7 = (globalThis as unknown as { game?: Game }).game;
  if (_g7) {
    // Prefer Game delegation when available
    try {
      _g7.trySpawnCell(cell);
    } catch {
      tokenManager.trySpawnCell(cell);
    }
    return;
  }

  tokenManager.trySpawnCell(cell);
}

// When the map finishes moving due to user dragging (free-look), rebuild
// the visible grid from scratch. For programmatic moves (camera follow)
// `movePlayerBy` already clears and spawns, so skip extra work.
mapManager.on("moveend", () => {
  // Prefer Game-managed behavior when available
  const _g8 = (globalThis as unknown as { game?: Game }).game;
  if (_g8) {
    if (_g8.freeLook) {
      tokenManager.reconcileVisible();
      _g8.spawnTokens();
    }
    return;
  }

  if (freeLook) {
    tokenManager.reconcileVisible();
    spawnTokens();
  }
});

mapManager.on("zoomend", () => spawnTokens());
mapManager.on("resize", () => spawnTokens());

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

    const size = GameConfig.TILE_SIZE_PX;
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
  tileSize: GameConfig.TILE_SIZE_PX,
}));
