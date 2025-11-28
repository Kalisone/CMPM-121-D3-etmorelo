// @deno-types="npm:@types/leaflet"
import type {
  Coords,
  GridLayerOptions,
  LatLng,
  LeafletMouseEvent,
} from "leaflet";
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
 * Game Event Types for Observer Pattern
 */
type GameEventType =
  | "stateChanged"
  | "playerMoved"
  | "tokenSpawned"
  | "inventoryUpdated"
  | "winConditionMet";

interface GameEvent {
  type: GameEventType;
  data?: unknown;
}

type EventListener = (event: GameEvent) => void;

/**
 * EventEmitter - Observable pattern implementation
 */
interface EventEmitter {
  subscribe(eventType: GameEventType, listener: EventListener): () => void;
  emit(eventType: GameEventType, data?: unknown): void;
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
  private eventEmitter: EventEmitter | null = null;

  constructor(
    private readonly winValue: number,
    private onStateChange: () => void = () => {},
  ) {
    this.loadFromLocalStorage();
  }

  setOnStateChange(cb: () => void) {
    this.onStateChange = cb;
  }

  setEventEmitter(emitter: EventEmitter) {
    this.eventEmitter = emitter;
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
    this.eventEmitter?.emit("inventoryUpdated", { token });
    this.onStateChange();
  }
  upgradeHeldToken() {
    if (this.heldToken) {
      this.heldToken.exp++;
      this.checkWinCondition();
      this.saveToLocalStorage();
      this.eventEmitter?.emit("inventoryUpdated", { token: this.heldToken });
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
    this.eventEmitter?.emit("inventoryUpdated", { token: null });
    this.onStateChange();
  }
  private checkWinCondition() {
    if (this.heldToken && (2 ** this.heldToken.exp) === this.winValue) {
      this.hasWon = true;
      this.eventEmitter?.emit("winConditionMet", { token: this.heldToken });
    }
  }
}

/**
 * MapManager
 *
 * Wrapper around a Leaflet map instance that centralizes map operations
 */
class MapManager {
  public map: leaflet.Map;
  public playerMarker: leaflet.Marker;
  // Grid-related parameters
  private gridOrigin?: leaflet.Point;
  private gridZoom?: number;
  private gridTileSize?: number;
  private getPlayerLatLng?: () => LatLng;

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

    leaflet.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap",
    }).addTo(this.map);
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

  setGridParams(
    origin: leaflet.Point,
    zoom: number,
    tileSize: number,
    getPlayerLatLng: () => LatLng,
  ) {
    this.gridOrigin = origin;
    this.gridZoom = zoom;
    this.gridTileSize = tileSize;
    this.getPlayerLatLng = getPlayerLatLng;
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

  getKey(cell: GridCell): string {
    return `${cell.i}:${cell.j}`;
  }

  parseKey(key: string): GridCell {
    const [iStr, jStr] = key.split(":");
    return { i: Number(iStr), j: Number(jStr) };
  }

  latLngToCell(latlng: LatLng): GridCell {
    if (
      !this.gridOrigin || this.gridZoom === undefined ||
      this.gridTileSize === undefined
    ) {
      throw new Error("Grid parameters not set on MapManager");
    }
    const pt = this.map.project(latlng, this.gridZoom);
    const relX = pt.x - this.gridOrigin.x;
    const relY = pt.y - this.gridOrigin.y;
    const i = Math.floor(relX / this.gridTileSize);
    const j = Math.floor(relY / this.gridTileSize);
    return { i, j };
  }

  cellToLatLngBounds(cell: GridCell): leaflet.LatLngBounds {
    if (
      !this.gridOrigin || this.gridZoom === undefined ||
      this.gridTileSize === undefined
    ) {
      throw new Error("Grid parameters not set on MapManager");
    }
    const nwTile = leaflet.point(
      this.gridOrigin.x + cell.i * this.gridTileSize,
      this.gridOrigin.y + cell.j * this.gridTileSize,
    );
    const seTile = leaflet.point(
      this.gridOrigin.x + (cell.i + 1) * this.gridTileSize,
      this.gridOrigin.y + (cell.j + 1) * this.gridTileSize,
    );
    const nwLatLng = this.map.unproject(nwTile, this.gridZoom);
    const seLatLng = this.map.unproject(seTile, this.gridZoom);
    return leaflet.latLngBounds([
      [nwLatLng.lat, nwLatLng.lng],
      [seLatLng.lat, seLatLng.lng],
    ]);
  }

  distanceToPlayer(cell: GridCell): number {
    if (
      !this.gridOrigin || this.gridZoom === undefined ||
      this.gridTileSize === undefined || !this.getPlayerLatLng
    ) {
      throw new Error("Grid parameters not set on MapManager");
    }
    const playerLatLng = this.getPlayerLatLng();
    const playerPt = this.map.project(playerLatLng, this.gridZoom);
    const relX = playerPt.x - this.gridOrigin.x;
    const relY = playerPt.y - this.gridOrigin.y;
    const playerI = Math.floor(relX / this.gridTileSize);
    const playerJ = Math.floor(relY / this.gridTileSize);
    const dx = Math.abs(cell.i - playerI);
    const dy = Math.abs(cell.j - playerJ);
    return dx + dy;
  }

  cellCenterLatLng(cell: GridCell): leaflet.LatLng {
    const bounds = this.cellToLatLngBounds(cell);
    return bounds.getCenter();
  }
}

interface GridCell {
  i: number;
  j: number;
}

/**
 * MovementController Interface
 *
 * Facade interface for different player movement strategies (manual buttons vs GPS).
 */
interface MovementController {
  start(): void;
  stop(): void;
  isActive(): boolean;
}

/**
 * ManualMovementController
 *
 * Handles player movement via directional buttons.
 */
class ManualMovementController implements MovementController {
  private active = false;

  constructor(
    private onMove: (dx: number, dy: number) => void,
  ) {}

  start(): void {
    this.active = true;
  }

  stop(): void {
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }

  // Called by UI buttons
  movePlayer(dx: number, dy: number): void {
    if (this.active) {
      this.onMove(dx, dy);
    }
  }
}

/**
 * GPSMovementController
 *
 * Handles player movement based on real-world GPS location using the
 * Geolocation API. Automatically updates player position as they move
 * in the physical world.
 */
class GPSMovementController implements MovementController {
  private active = false;
  private watchId: number | null = null;
  private lastKnownPosition: leaflet.LatLng | null = null;
  private lastAcceptedPosition: leaflet.LatLng | null = null;
  private smoothedPosition: leaflet.LatLng | null = null;
  private readonly maxAccuracyMeters = 30;
  private readonly minMoveMeters = 8;
  private readonly smoothingAlpha = 0.25;

  constructor(
    private onLocationUpdate: (lat: number, lng: number) => void,
    private onError?: (error: GeolocationPositionError) => void,
  ) {}

  start(): void {
    if (this.active) return;

    this.active = true;

    if (!navigator.geolocation) {
      console.error("Geolocation is not supported by this browser");
      if (this.onError) {
        this.onError({
          code: 0,
          message: "Geolocation not supported",
        } as GeolocationPositionError);
      }
      this.active = false;
      return;
    }

    this.watchId = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;

        // Filters by reported accuracy
        if (typeof accuracy === "number" && accuracy > this.maxAccuracyMeters) {
          return;
        }

        // Smooths signal using exponential moving average
        const raw = leaflet.latLng(latitude, longitude);
        if (!this.smoothedPosition) {
          this.smoothedPosition = raw;
        } else {
          const a = this.smoothingAlpha;
          const lat = a * raw.lat + (1 - a) * this.smoothedPosition.lat;
          const lng = a * raw.lng + (1 - a) * this.smoothedPosition.lng;
          this.smoothedPosition = leaflet.latLng(lat, lng);
        }

        // Decide whether to emit an update based on minimum movement distance
        if (!this.lastAcceptedPosition) {
          this.lastAcceptedPosition = this.smoothedPosition.clone();
          this.lastKnownPosition = this.smoothedPosition.clone();
          this.onLocationUpdate(
            this.smoothedPosition.lat,
            this.smoothedPosition.lng,
          );
          return;
        }

        const moved = haversineMeters(
          this.lastAcceptedPosition.lat,
          this.lastAcceptedPosition.lng,
          this.smoothedPosition.lat,
          this.smoothedPosition.lng,
        );

        this.lastKnownPosition = this.smoothedPosition.clone();
        if (moved >= this.minMoveMeters) {
          this.lastAcceptedPosition = this.smoothedPosition.clone();
          this.onLocationUpdate(
            this.smoothedPosition.lat,
            this.smoothedPosition.lng,
          );
        }
      },
      (error) => {
        console.error("GPS error:", error);
        if (this.onError) {
          this.onError(error);
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 45000,
      },
    );
  }

  stop(): void {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }

  getLastKnownPosition(): leaflet.LatLng | null {
    return this.lastKnownPosition;
  }
}

// Great-circle distance (Haversine) used for movement threshold filtering
function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371000; // Earth radius in meters
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * MovementFacade
 *
 * Facade that manages switching between manual and GPS movement controllers.
 * Provides a unified interface for the game to interact with player movement
 * regardless of the underlying control mechanism.
 */
class MovementFacade {
  private currentController: MovementController;
  private manualController: ManualMovementController;
  private gpsController: GPSMovementController;
  private useGPS = false;

  constructor(
    private onManualMove: (dx: number, dy: number) => void,
    private onGPSUpdate: (lat: number, lng: number) => void,
    private onGPSError?: (error: GeolocationPositionError) => void,
  ) {
    this.manualController = new ManualMovementController(onManualMove);
    this.gpsController = new GPSMovementController(onGPSUpdate, onGPSError);
    this.currentController = this.manualController;
    this.manualController.start();
  }

  switchToManual(): void {
    if (!this.useGPS) return;
    this.gpsController.stop();
    this.manualController.start();
    this.currentController = this.manualController;
    this.useGPS = false;
  }

  switchToGPS(): void {
    if (this.useGPS) return;
    this.manualController.stop();
    this.gpsController.start();
    this.currentController = this.gpsController;
    this.useGPS = true;
  }

  isUsingGPS(): boolean {
    return this.useGPS;
  }

  getCurrentController(): MovementController {
    return this.currentController;
  }

  getManualController(): ManualMovementController {
    return this.manualController;
  }

  stop(): void {
    this.currentController.stop();
  }
}

/**
 * GridUtils
 *
 * Provides conversions between world pixel coordinates and the
 * logical grid used by the game: mapping lat/lng to tile indices,
 * computing cell bounds and distances relative to the player.
 */
// GridUtils removed; methods moved into MapManager

const DIRECTIONS = [
  { label: "△", dx: 0, dy: -1, aria: "Move up" },
  { label: "◁", dx: -1, dy: 0, aria: "Move left" },
  { label: "▷", dx: 1, dy: 0, aria: "Move right" },
  { label: "▽", dx: 0, dy: 1, aria: "Move down" },
];

class UIManager {
  private controlPanel: HTMLElement;
  private inventoryBadge: HTMLElement;
  private winBanner: HTMLElement;
  private currentFreeLook = false;
  private onToggle?: (enabled: boolean) => void;
  private onMovementModeToggle?: (useGPS: boolean) => void;
  private directionalButtons: HTMLButtonElement[] = [];
  private movementModeButton?: HTMLButtonElement;

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
    for (let i = 0; i < 6; i++) {
      const b = document.createElement("button");
      b.type = "button";
      buttons.push(b);
    }

    // View mode toggle button (Player Lock/Free Look)
    for (let i = 0; i < 4; i++) {
      buttons[i].innerText = DIRECTIONS[i].label;
      this.directionalButtons.push(buttons[i]);
    }
    buttons[4].innerText = "⛯";
    buttons[4].setAttribute("aria-label", "Toggle view mode");
    buttons[4].title = "View: Player Lock";

    // Movement mode toggle button (GPS/Manual)
    buttons[5].innerText = "🌐";
    buttons[5].setAttribute("aria-label", "Toggle movement mode");
    buttons[5].title = "Movement: GPS";
    buttons[5].id = "movementModeButton";
    this.movementModeButton = buttons[5];

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
          button.innerText = newState ? "👁" : "⛯";
          button.title = newState ? "View: Free Look" : "View: Player Lock";
        });
      } else if (idx === 5) {
        button.addEventListener("click", () => {
          if (this.onMovementModeToggle) {
            // Toggle between GPS and manual
            const currentlyGPS = button.innerText === "🌐";
            this.onMovementModeToggle(!currentlyGPS);
          }
        });
      }
    }

    const rowTop = document.createElement("div");
    rowTop.className = "directional-row row-top";
    // Add invisible spacers to center the up arrow above the view button
    const spacerL = document.createElement("button");
    spacerL.type = "button";
    spacerL.className = "btn-spacer";
    spacerL.setAttribute("aria-hidden", "true");
    const spacerR = document.createElement("button");
    spacerR.type = "button";
    spacerR.className = "btn-spacer";
    spacerR.setAttribute("aria-hidden", "true");
    rowTop.appendChild(spacerL);
    rowTop.appendChild(buttons[0]);
    rowTop.appendChild(spacerR);

    const rowMiddle = document.createElement("div");
    rowMiddle.className = "directional-row row-middle";
    rowMiddle.appendChild(buttons[1]);
    rowMiddle.appendChild(buttons[4]);
    rowMiddle.appendChild(buttons[2]);

    const rowBottom = document.createElement("div");
    rowBottom.className = "directional-row row-bottom";
    // Bottom row order: control scheme button to the left of down button
    rowBottom.appendChild(buttons[5]);
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
    resetButton.innerText = "↻";
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

  setMovementModeToggleHandler(onToggle: (useGPS: boolean) => void) {
    this.onMovementModeToggle = onToggle;
  }

  updateMovementMode(useGPS: boolean) {
    if (this.movementModeButton) {
      this.movementModeButton.innerText = useGPS ? "🌐" : "✥";
      this.movementModeButton.title = useGPS
        ? "Movement: GPS"
        : "Movement: Manual";
    }
    // Hide/show directional arrow buttons based on mode
    this.directionalButtons.forEach((btn) => {
      btn.style.display = useGPS ? "none" : "";
    });
  }
}

// Instantiate UI manager (map element needs to exist before MapManager)
// Use no-op handlers here and wire real handlers after `game` exists.
const uiManager = new UIManager(
  "map",
  (_dx, _dy) => {},
  () => {},
);

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
  TOKEN_MAX_EXP: 8,
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

mapManager.setGridParams(
  WORLD_ORIGIN_POINT,
  GameConfig.GAMEPLAY_ZOOM_LEVEL,
  GameConfig.TILE_SIZE_PX,
  () => mapManager.playerMarker.getLatLng(),
);

class BoardState {
  // The "Memento" map only stores modified cells (flyweight pattern). Keys: "i:j".
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
    // Serialize Map to object for JSON storage (avoids custom reviver)
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

const WIN_VALUE = Math.pow(2, GameConfig.TOKEN_MAX_EXP);

const gameState = new GameStateManager(WIN_VALUE);

// TokenManager encapsulates token layer and spawn logic
class TokenManager {
  public tokensLayer: leaflet.LayerGroup;
  public tokensMap: Map<string, { layer: leaflet.Layer; exp: number }>;

  private readonly expDistribution: number[];
  private readonly expSpawnMultiplier: number[];

  constructor(
    private readonly mapManager: MapManager,
    private readonly gameState: GameStateManager,
    private readonly luckFn: (k: string) => number,
    private readonly tileSize: number,
    private readonly zoom: number,
    private readonly spawnProbability: number,
    private readonly maxExp: number,
    private readonly proximityRadius: number,
  ) {
    // Build inverse-power weighting for exponents (rarer high values)
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

  /*
   * Reconcile visible tokens against the current viewport without
   * clearing everything. This removes off-screen token layers and
   * creates missing token layers for newly-visible cells.
   */
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
        visibleKeys.add(this.mapManager.getKey({ i, j }));
      }
    }

    // Removes off-screen token layers
    for (const [k, v] of Array.from(this.tokensMap.entries())) {
      if (!visibleKeys.has(k)) {
        if (this.tokensLayer.hasLayer(v.layer)) {
          this.tokensLayer.removeLayer(v.layer);
        }
        this.tokensMap.delete(k);
      }
    }

    // Adds tokens for newly-visible cells only
    for (const key of visibleKeys) {
      if (!this.tokensMap.has(key)) {
        const cell = this.mapManager.parseKey(key);
        this.trySpawnCell(cell);
      }
    }
  }

  /*
   * Determines visible grid cells for the current viewport and ensure
   * tokens for those cells are present. Off-screen token layers are
   * removed to free memory; logical state is preserved in the memento.
   */
  spawnTokens() {
    this.reconcileVisible();
  }

  /**
   * Update inventory and win UI elements.
   *
   * Uses flyweight check + deterministic generation, checks memento first
   */
  public trySpawnCell(cell: GridCell) {
    const key = this.mapManager.getKey(cell);

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

      const gridDist = this.mapManager.distanceToPlayer(cell);

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
    const bounds = this.mapManager.cellToLatLngBounds(cell);
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

const tokenManager = new TokenManager(
  mapManager,
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
class Game implements EventEmitter {
  public freeLook: boolean = false;
  private movementFacade: MovementFacade;
  private listeners: Map<GameEventType, Set<EventListener>> = new Map();

  constructor(
    private readonly mapManager: MapManager,
    private readonly gameState: GameStateManager,
    private readonly uiManager: UIManager,
    private readonly boardState: BoardState,
    private tokenManager?: TokenManager,
  ) {
    // Store token manager reference
    this.tokenManager = tokenManager;

    // Initialize movement facade
    this.movementFacade = new MovementFacade(
      // Manual movement handler
      (dx: number, dy: number) => this.handlePlayerMove(dx, dy),
      // GPS location update handler
      (lat: number, lng: number) => this.handleGPSUpdate(lat, lng),
      // GPS error handler
      (error: GeolocationPositionError) => this.handleGPSError(error),
    );

    this.gameState.setOnStateChange(() => this.onStateChange());
    this.gameState.setEventEmitter(this);

    // Wire UI handlers to this Game
    this.uiManager.setReset(() => this.resetGame());
    this.uiManager.setMoveHandler((dx: number, dy: number) => {
      const manual = this.getMovementFacade().getManualController();
      manual.movePlayer(dx, dy);
    });
    this.uiManager.setMovementModeToggleHandler((useGPS: boolean) => {
      this.switchMovementMode(useGPS);
      this.uiManager.updateMovementMode(useGPS);
    });
    this.uiManager.setToggleHandler((enabled: boolean) =>
      this.setFreeLook(enabled)
    );

    // Wire player marker events
    const pm = this.mapManager.playerMarker;
    pm.on("mouseover", () => {
      this.onStateChange();
      pm.openTooltip();
    });
    pm.on("mouseout", () => pm.closeTooltip());
    pm.on("click", () => {
      this.onStateChange();
      pm.openTooltip();
    });

    // Map events
    this.mapManager.on("moveend", () => {
      if (this.freeLook) {
        this.tokenManager?.reconcileVisible();
        this.spawnTokens();
      }
    });
    this.mapManager.on("zoomend", () => this.spawnTokens());
    this.mapManager.on("resize", () => this.spawnTokens());

    // Initial render / state sync
    this.onStateChange();
    this.spawnTokens();

    // Default start in GPS mode
    this.switchMovementMode(true);
    this.uiManager.updateMovementMode(true);

    // Subscribe UI updates to game events (Observer pattern)
    this.subscribe("stateChanged", () => {
      this.updateStatusPanel();
      this.updatePlayerTooltip();
    });

    this.subscribe("playerMoved", () => {
      this.updatePlayerTooltip();
    });

    this.subscribe("inventoryUpdated", () => {
      this.updateStatusPanel();
    });

    this.subscribe("winConditionMet", () => {
      this.updateStatusPanel();
    });

    this.setFreeLook(false);
  }

  /**
   * Subscribe to game events (Observer pattern)
   */
  subscribe(eventType: GameEventType, listener: EventListener): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType)!.add(listener);

    // Return unsubscribe function
    return () => {
      this.listeners.get(eventType)?.delete(listener);
    };
  }

  /**
   * Emit game events to subscribers (Observer pattern)
   */
  emit(eventType: GameEventType, data?: unknown): void {
    const event: GameEvent = { type: eventType, data };
    this.listeners.get(eventType)?.forEach((listener) => {
      try {
        listener(event);
      } catch (error) {
        console.error(`Error in event listener for ${eventType}:`, error);
      }
    });
  }

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
    this.emit("playerMoved", { latLng: newLatLng });

    if (!this.freeLook) {
      this.mapManager.setView(newLatLng, GameConfig.GAMEPLAY_ZOOM_LEVEL);
    }

    // Reconcile visible tokens for new viewport after movement
    this.spawnTokens();
  }

  setTokenManager(tm: TokenManager) {
    this.tokenManager = tm;
  }

  onStateChange() {
    // Emit event instead of directly calling UI updates
    this.emit("stateChanged");
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
      const cell = this.mapManager.latLngToCell(latlng);
      const content = `Player ${this.mapManager.getKey(cell)}`;
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
    const key = this.mapManager.getKey(cell);
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

  handleGPSUpdate(lat: number, lng: number) {
    const newLatLng = leaflet.latLng(lat, lng);
    this.mapManager.playerMarker.setLatLng(newLatLng);
    this.emit("playerMoved", { latLng: newLatLng });

    if (!this.freeLook) {
      this.mapManager.setView(newLatLng, GameConfig.GAMEPLAY_ZOOM_LEVEL);
    }

    this.spawnTokens();
  }

  handleGPSError(error: GeolocationPositionError) {
    let message = "GPS Error: ";
    switch (error.code) {
      case error.PERMISSION_DENIED:
        message += "Location permission denied. Please enable location access.";
        break;
      case error.POSITION_UNAVAILABLE:
        message += "Location information unavailable.";
        break;
      case error.TIMEOUT:
        message += "Location request timed out.";
        break;
      default:
        message += error.message;
    }
    console.error(message);
    alert(message);
  }

  switchMovementMode(useGPS: boolean) {
    if (useGPS) {
      this.movementFacade.switchToGPS();
    } else {
      this.movementFacade.switchToManual();
    }
  }

  isUsingGPS(): boolean {
    return this.movementFacade.isUsingGPS();
  }

  getMovementFacade(): MovementFacade {
    return this.movementFacade;
  }
}

// Instantiate the Game object
const _game = new Game(
  mapManager,
  gameState,
  uiManager,
  boardState,
  tokenManager,
);

/*
 * GRID OVERLAY
 *
 * Render a custom grid layer aligned to the `WORLD_ORIGIN_POINT` so that
 * visual grid lines line up with the logical grid cells used by the
 * gameplay code. Tiles are styled with repeating linear gradients sized
 * to `TILE_SIZE_PX`.
 */
class GridLayer extends leaflet.GridLayer {
  constructor(options?: GridLayerOptions) {
    super(options);
  }

  override createTile(coords: Coords): HTMLElement {
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
  }
}

mapManager.addLayer(
  new GridLayer({
    tileSize: GameConfig.TILE_SIZE_PX,
  }),
);
