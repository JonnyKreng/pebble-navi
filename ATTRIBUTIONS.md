# Attributions

## Map Data

This app uses map tiles from [OpenStreetMap](https://www.openstreetmap.org).

© OpenStreetMap contributors

The map data is made available under the Open Database License (ODbL).
See [https://www.openstreetmap.org/copyright](https://www.openstreetmap.org/copyright) for details.

## Tile Usage

Tile usage complies with the
[OpenStreetMap Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/).

- **App:** Navi App (`pebble-map-renderer/1.0`)
- **Purpose:** Turn-by-turn navigation on Pebble smartwatch
- Tiles are fetched on-demand for the current viewport only
- Tiles are cached per HTTP caching headers (minimum 7 days)
- No bulk downloading, prefetching, or offline export

## Routing

Turn-by-turn routing is provided by [OSRM](http://project-osrm.org/)
via `routing.openstreetmap.de`, using OpenStreetMap data.

## Geocoding

Address autocomplete uses [OpenRouteService](https://openrouteservice.org/)
(when an API key is configured). Direct coordinate entry always works.

## Source Code

Source code is available at the project repository.
