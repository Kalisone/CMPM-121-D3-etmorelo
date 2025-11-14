// @deno-types="npm:@types/leaflet"
import type { LeafletMouseEvent } from "leaflet";
import leaflet from "leaflet";

// Style sheets
import "leaflet/dist/leaflet.css"; // supporting style for Leaflet
import "./style.css"; // student-controlled page style

// Fix missing marker images
import "./_leafletWorkaround.ts"; // fixes for missing Leaflet images
// Import our luck function for deterministic randomness
import luck from "./_luck.ts";

// Create basic UI elements
const controlPanelDiv = document.createElement("div");
controlPanelDiv.id = "controlPanel";
document.body.append(controlPanelDiv);

const mapDiv = document.createElement("div");
mapDiv.id = "map";
document.body.append(mapDiv);

const statusPanelDiv = document.createElement("div");
statusPanelDiv.id = "statusPanel";
document.body.append(statusPanelDiv);

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

let hasWon = false;

// Play again handler: clear collected/held state and respawn tokens
function playAgain() {
  hasWon = false;
  heldToken = null;
  collectedSet.clear();
  tokensLayer.clearLayers();
  tokensMap.clear();
  updateStatusPanel();
  spawnTokensForViewport();
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
const GRID_SIZE = 60;

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
});

// Populate the map with a background tile layer
leaflet.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution:
    '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

// Add a marker to represent the player
const playerMarker = leaflet.marker(CLASSROOM_LATLNG);
playerMarker.bindTooltip("Player");
playerMarker.addTo(map);

// //// //// //// //// //// ////
// TOKEN SPAWNING
// //// //// //// //// //// ////

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
const PROXI_DETECT_RANGE = 20;

// Layer to hold token markers (persist across view changes)
const tokensLayer = leaflet.layerGroup().addTo(map);
// In-memory collected tokens (session-only).
const collectedSet = new Set<string>();
// Map of tokens keyed by base world-tile (tx:ty); stores layer + exponent
const tokensMap = new Map<string, { layer: leaflet.Layer; exp: number }>();
// Single-slot inventory: player can hold at most one token at a time (store exponent)
let heldToken: { key: string; exp: number } | null = null;

function updateStatusPanel() {
  const holding = heldToken
    ? `Holding: ${2 ** heldToken.exp}`
    : "Holding: none";
  statusPanelDiv.innerHTML = `${holding}`;
  // Also update the on-map inventory badge
  if (inventoryBadge) inventoryBadge.innerText = holding;
  // Show win banner when player is holding a token of value 8 (2^3)
  const hasWinToken = heldToken && 2 ** heldToken.exp === WIN_VALUE;
  if (hasWinToken) {
    hasWon = true;
    winBanner.classList.add("show-win");
  } else {
    hasWon = false;
    winBanner.classList.remove("show-win");
  }
}

// Initialize status panel
updateStatusPanel();

// Spawn tokens for the currently visible world-tile cells.
function spawnTokensForViewport() {
  const baseZoom = GAMEPLAY_ZOOM_LEVEL;
  const bounds = map.getBounds();

  const nw = bounds.getNorthWest();
  const se = bounds.getSouthEast();

  const nwPt = map.project(nw, baseZoom);
  const sePt = map.project(se, baseZoom);

  const minX = Math.floor(Math.min(nwPt.x, sePt.x) / GRID_SIZE);
  const maxX = Math.floor((Math.max(nwPt.x, sePt.x) - 1) / GRID_SIZE);
  const minY = Math.floor(Math.min(nwPt.y, sePt.y) / GRID_SIZE);
  const maxY = Math.floor((Math.max(nwPt.y, sePt.y) - 1) / GRID_SIZE);

  for (let tx = minX; tx <= maxX; tx++) {
    for (let ty = minY; ty <= maxY; ty++) {
      const key = `${tx}:${ty}`;

      // Don't spawn if already collected
      if (collectedSet.has(key)) continue;

      // If token already exists for this cell, ensure it's in the layer and continue
      if (tokensMap.has(key)) {
        const existing = tokensMap.get(key)!;
        if (!tokensLayer.hasLayer(existing.layer)) {
          tokensLayer.addLayer(existing.layer);
        }
        continue;
      }

      // Determine deterministic token value for this cell using a rarity distribution
      const vRand = luck(key + ":value");
      // choose exponent deterministically using distribution
      let exp = 0;
      for (let e = 0; e <= TOKEN_MAX_EXP; e++) {
        if (vRand < EXP_DISTRIBUTION[e]) {
          exp = e;
          break;
        }
      }

      // Use a separate luck call for spawn so rarity influences spawn chance
      const spawnRand = luck(key + ":spawn");
      const spawnThreshold = TOKEN_SPAWN_PROBABILITY *
        EXP_SPAWN_MULTIPLIER[exp];
      if (spawnRand < spawnThreshold) {
        // Compute lat/lng bounds for this tile at base zoom
        const nwTile = leaflet.point(tx * GRID_SIZE, ty * GRID_SIZE);
        const seTile = leaflet.point(
          (tx + 1) * GRID_SIZE,
          (ty + 1) * GRID_SIZE,
        );
        const nwLatLng = map.unproject(nwTile, baseZoom);
        const seLatLng = map.unproject(seTile, baseZoom);
        const tileBounds = leaflet.latLngBounds([[nwLatLng.lat, nwLatLng.lng], [
          seLatLng.lat,
          seLatLng.lng,
        ]]);

        // Token
        const rect = leaflet.rectangle(tileBounds, {
          weight: 1,
          color: "#cc6600",
          fillColor: "#ff7f0e",
          fillOpacity: 0.2,
        });

        const value = 2 ** exp;
        rect.bindTooltip(String(value), {
          permanent: true,
          direction: "center",
          className: "token-label",
        });

        rect.on("click", (e: LeafletMouseEvent) => {
          if (hasWon) {
            const popup = leaflet.popup({ closeButton: false, autoClose: true })
              .setLatLng(e.latlng)
              .setContent("Game complete — press Play again to continue");
            popup.openOn(map);
            setTimeout(() => map.closePopup(popup), 900);
            return;
          }
          // Determine player's tile at the base zoom so collection is stable across zooms
          const playerLatLng = playerMarker.getLatLng();
          const playerPt = map.project(playerLatLng, GAMEPLAY_ZOOM_LEVEL);
          const playerTx = Math.floor(playerPt.x / GRID_SIZE);
          const playerTy = Math.floor(playerPt.y / GRID_SIZE);

          const dx = Math.abs(tx - playerTx);
          const dy = Math.abs(ty - playerTy);
          const gridDist = Math.max(dx, dy); // Chebyshev distance (gridspaces)

          if (gridDist <= PROXI_DETECT_RANGE) {
            // If already holding a token
            if (heldToken) {
              // If held exponent matches map exponent, attempt to deposit/merge
              if (heldToken.exp === exp) {
                if (exp < TOKEN_MAX_EXP) {
                  // merge: increment exponent on the map token
                  exp = exp + 1;
                  const newValue = 2 ** exp;
                  // update tooltip
                  rect.unbindTooltip();
                  rect.bindTooltip(String(newValue), {
                    permanent: true,
                    direction: "center",
                    className: "token-label",
                  });
                  // update stored exponent for this tile
                  tokensMap.set(key, { layer: rect, exp });
                  // consume held token
                  heldToken = null;
                  updateStatusPanel();
                } else {
                  const popup = leaflet.popup({
                    closeButton: false,
                    autoClose: true,
                  })
                    .setLatLng(e.latlng)
                    .setContent(`Token already at max value`);
                  popup.openOn(map);
                  setTimeout(() => map.closePopup(popup), 900);
                }
              } else {
                const popup = leaflet.popup({
                  closeButton: false,
                  autoClose: true,
                })
                  .setLatLng(e.latlng)
                  .setContent(
                    `You are already carrying a different token (value ${
                      2 ** heldToken.exp
                    })`,
                  );
                popup.openOn(map);
                setTimeout(() => map.closePopup(popup), 900);
              }
            } else {
              // Pick up token into the single-slot inventory (do not award points now)
              tokensLayer.removeLayer(rect);
              tokensMap.delete(key);
              collectedSet.add(key);
              heldToken = { key, exp };
              updateStatusPanel();
            }
          } else {
            // Show a temporary popup indicating token is too far
            const popup = leaflet.popup({ closeButton: false, autoClose: true })
              .setLatLng(e.latlng)
              .setContent(`Too far — ${gridDist} gridspaces away`);
            popup.openOn(map);
            // Auto-close after a short delay
            setTimeout(() => map.closePopup(popup), 900);
          }
        });

        tokensMap.set(key, { layer: rect, exp });
        tokensLayer.addLayer(rect);
      }
    }
  }
}

// Refresh tokens when the view changes or the map is resized
map.on("moveend", spawnTokensForViewport);
map.on("zoomend", spawnTokensForViewport);
map.on("resize", spawnTokensForViewport);

// Initial spawn
spawnTokensForViewport();

// //// //// //// //// //// ////
// GRID OVERLAY
// //// //// //// //// //// ////
leaflet.GridLayer = leaflet.GridLayer.extend({
  createTile: function () {
    const tile = document.createElement("div");
    tile.style.outline = "1px solid orange";
    return tile;
  },
});

leaflet.gridLayer = function (opts) {
  return new leaflet.GridLayer(opts);
};

map.addLayer(leaflet.gridLayer({
  tileSize: GRID_SIZE,
}));
