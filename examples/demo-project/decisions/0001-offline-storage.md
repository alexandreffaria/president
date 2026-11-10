---
id: "0001"
title: Where should trip data live on the device?
status: open
kind: choice
priority: high
created: 2026-11-04T09:12:00Z
created_by: claude-code
tags: [storage, offline]
depends_on: ["0004"]
recommendation:
  option: dexie
  why: >-
    Our data is a few thousand small records per user and we don't need SQL joins.
    Dexie gives us indexed queries and live queries with the least new tooling,
    and it is the most battle-tested option in Safari, where most of our users are.
options:
  - id: dexie
    title: IndexedDB through Dexie
    summary: Store trips, waypoints and notes as IndexedDB tables with a thin typed wrapper.
    pros:
      - Works in every browser we support, including iOS Safari
      - Live queries re-render the UI when data changes
      - Small (about 30 kB gzipped) and widely used
    cons:
      - No SQL; complex reports need hand-written code
      - Schema migrations are versioned upgrade functions, which are easy to get wrong
  - id: sqlite
    title: SQLite in WebAssembly on OPFS
    summary: Run real SQLite in the browser, persisted to the Origin Private File System.
    pros:
      - Full SQL, including joins and full-text search
      - The same schema could later run on a server or in a native app
    cons:
      - About 900 kB of WebAssembly to download before the app works offline
      - OPFS needs a worker and has had storage bugs in older Safari versions
  - id: plain-json
    title: One JSON document per trip
    summary: Keep each trip as a single JSON blob in IndexedDB (no tables, no indexes).
    pros:
      - Simplest possible code; easy to export and import
      - Trips are self-contained, which matches how people share them
    cons:
      - Searching across trips means loading every trip
      - Every small edit rewrites the whole trip
feedback:
  - at: 2026-11-05T18:40:00Z
    type: neither
    note: >-
      The first options were all server databases. Everything has to work with no signal,
      so I only want to compare on-device storage.
---

## Context

Trailhead must work with no signal: people plan at home, then open the app on the trail.
Everything a hiker needs (trips, waypoints, notes, and which map areas are downloaded) has to be
stored on the device and survive the browser being closed.

Sync to a server is planned but not decided. Whatever we pick here should not make sync harder.

Typical data per user: 5 to 50 trips, each with 20 to 200 waypoints and a few notes.

## Option dexie: IndexedDB through Dexie

```ts
import Dexie, { type Table } from "dexie";

class TrailheadDb extends Dexie {
  trips!: Table<Trip, string>;
  waypoints!: Table<Waypoint, string>;

  constructor() {
    super("trailhead");
    this.version(1).stores({
      trips: "id, updatedAt",
      waypoints: "id, tripId, [tripId+order]",
    });
  }
}

const db = new TrailheadDb();
const stops = await db.waypoints.where("tripId").equals(tripId).sortBy("order");
```

## Option sqlite: SQLite in WebAssembly on OPFS

```ts
// Runs inside a dedicated worker; the UI talks to it with postMessage.
const db = await openSqliteOnOpfs("trailhead.db");
db.exec(`
  CREATE TABLE IF NOT EXISTS waypoints (
    id TEXT PRIMARY KEY, trip_id TEXT NOT NULL, position INTEGER NOT NULL, name TEXT
  );
`);
const stops = db.selectObjects(
  "SELECT * FROM waypoints WHERE trip_id = ? ORDER BY position",
  [tripId],
);
```

## Option plain-json: One JSON document per trip

```ts
await idb.put("trips", { id: trip.id, json: JSON.stringify(trip) });
const trip: Trip = JSON.parse((await idb.get("trips", tripId)).json);
```

## Sources

- Dexie documentation, "Consistency and live queries": https://dexie.org/docs/liveQuery()
- SQLite WASM persistence options: https://sqlite.org/wasm/doc/trunk/persistence.md
- WebKit storage policy (eviction after 7 days of no use for non-installed sites): https://webkit.org/blog/14403/updates-to-storage-policy/
