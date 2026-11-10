---
id: "0004"
title: Where do map tiles come from?
status: resolved
kind: choice
priority: high
created: 2026-11-01T10:00:00Z
created_by: claude-code
tags: [maps, offline]
depends_on: []
recommendation:
  option: protomaps
  why: One static file is the easiest thing to download for offline use, and it has no per-request bill.
options:
  - id: maptiler
    title: MapTiler hosted tiles
    summary: Use MapTiler's OpenStreetMap vector tiles with an API key.
    pros:
      - Nothing to host
      - Good outdoor style out of the box
    cons:
      - Paid per tile request once we grow
      - Offline download terms need checking
  - id: mapbox
    title: Mapbox
    summary: Use Mapbox GL and Mapbox-hosted tiles.
    pros:
      - Polished SDK and styles
    cons:
      - Most expensive at scale
      - License restricts caching tiles for offline use
  - id: protomaps
    title: Self-hosted Protomaps (PMTiles)
    summary: Host one PMTiles file on static storage and read byte ranges from it.
    pros:
      - Very cheap to host; no per-request pricing
      - Offline areas are just cached byte ranges
    cons:
      - We maintain the extract and its updates ourselves
resolution:
  choice: protomaps
  note: Cost and offline-friendliness matter most. We can switch styles later.
  resolved_at: 2026-11-03T16:20:00Z
applied_at: 2026-11-03T16:45:00Z
---

## Context

The app shows trail maps and must let people download an area before a hike.

## Option protomaps: Self-hosted Protomaps (PMTiles)

```js
import { PMTiles, Protocol } from "pmtiles";
maplibregl.addProtocol("pmtiles", new Protocol().tile);
```
