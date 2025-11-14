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

// Our classroom location
const CLASSROOM_LATLNG = leaflet.latLng(
  36.997936938057016,
  -122.05703507501151,
);

// Tunable gameplay parameters
const GAMEPLAY_ZOOM_LEVEL = 19;
//const TILE_DEGREES = 1e-4;
//const NEIGHBORHOOD_SIZE = 8;
//const CACHE_SPAWN_PROBABILITY = 0.1;
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

// Player points and status display
let playerPoints = 0;
statusPanelDiv.innerHTML = "No points yet...";

// //// //// //// //// //// ////
// TOKEN SPAWNING
// //// //// //// //// //// ////

// Token spawning parameters
const TOKEN_SPAWN_PROBABILITY = 0.12;
const COLLECTION_RANGE = 3;

// Layer to hold token markers (persist across view changes)
const tokensLayer = leaflet.layerGroup().addTo(map);
// In-memory collected tokens (session-only).
const collectedSet = new Set<string>();
// Map of tokens keyed by base world-tile (tx:ty) so tokens persist across zooms
const tokensMap = new Map<string, leaflet.Layer>();

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
        if (!tokensLayer.hasLayer(existing)) tokensLayer.addLayer(existing);
        continue;
      }

      // Determine deterministic chance for this world-tile (key is stable across zooms)
      if (luck(key) < TOKEN_SPAWN_PROBABILITY) {
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

        // Filled rectangle to represent a token occupying the whole grid space
        const rect = leaflet.rectangle(tileBounds, {
          weight: 1,
          color: "#cc6600",
          fillColor: "#ff7f0e",
          fillOpacity: 0.2,
        });

        rect.bindTooltip("Token");

        rect.on("click", (e: LeafletMouseEvent) => {
          // Determine player's tile at the base zoom so collection is stable across zooms
          const playerLatLng = playerMarker.getLatLng();
          const playerPt = map.project(playerLatLng, GAMEPLAY_ZOOM_LEVEL);
          const playerTx = Math.floor(playerPt.x / GRID_SIZE);
          const playerTy = Math.floor(playerPt.y / GRID_SIZE);

          const dx = Math.abs(tx - playerTx);
          const dy = Math.abs(ty - playerTy);
          const gridDist = Math.max(dx, dy); // Chebyshev distance (gridspaces)

          if (gridDist <= COLLECTION_RANGE) {
            // Collect token
            tokensLayer.removeLayer(rect);
            tokensMap.delete(key);
            collectedSet.add(key);
            playerPoints++;
            statusPanelDiv.innerHTML = `${playerPoints} points accumulated`;
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

        tokensMap.set(key, rect);
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
