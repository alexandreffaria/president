---
id: "0002"
title: How should the API client report errors?
status: open
kind: ab
priority: normal
created: 2026-11-06T11:30:00Z
created_by: claude-code
tags: [api, typescript]
depends_on: []
recommendation:
  option: result
  why: >-
    Most of our calls fail in expected ways (offline, timed out, not found), and the
    UI has to handle each of them. Returning a result makes the compiler remind us.
    The cost is some extra lines at each call site.
options:
  - id: throw
    title: Throw typed errors
    summary: Functions return data on success and throw an ApiError subclass on failure.
    pros:
      - Familiar to every TypeScript developer
      - Call sites stay short when the caller doesn't care about failures
    cons:
      - Nothing forces a caller to handle "offline", so it's easy to forget
      - The thrown type isn't part of the function signature
  - id: result
    title: Return a result object
    summary: "Functions return { ok: true, data } or { ok: false, error } and never throw for expected failures."
    pros:
      - The compiler makes every caller look at the failure case
      - Failures are plain values, easy to log, test and show in the UI
    cons:
      - More code at each call site
      - Unexpected bugs still throw, so there are two error paths
---

## Context

The app talks to a small HTTP API (sync, sharing trips). On the trail most requests fail
because there is no signal, so failure is normal, not exceptional. We need one convention for
the whole client before more endpoints are written.

## Option throw: Throw typed errors

```ts
export async function getTrip(id: string): Promise<Trip> {
  const res = await fetch(`/api/trips/${id}`).catch(() => {
    throw new OfflineError();
  });
  if (res.status === 404) throw new NotFoundError(id);
  return res.json();
}

// Call site
try {
  show(await getTrip(id));
} catch (error) {
  if (error instanceof OfflineError) showCachedCopy();
  else throw error;
}
```

## Option result: Return a result object

```ts
type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: "offline" | "not_found" | "server" };

export async function getTrip(id: string): Promise<ApiResult<Trip>> {
  const res = await fetch(`/api/trips/${id}`).catch(() => null);
  if (!res) return { ok: false, error: "offline" };
  if (res.status === 404) return { ok: false, error: "not_found" };
  return { ok: true, data: await res.json() };
}

// Call site
const result = await getTrip(id);
if (!result.ok) return result.error === "offline" ? showCachedCopy() : showError(result.error);
show(result.data);
```

## Sources

- TypeScript handbook, discriminated unions: https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions
