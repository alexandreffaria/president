/**
 * president's tray icon on Linux: a StatusNotifierItem (the D-Bus tray that waybar's `tray`
 * module, KDE Plasma and GNOME's AppIndicator extension show), the Linux side of
 * 20261112vzn8 (option `count`).
 *
 * `preside tray install` runs this as the systemd user unit president-tray.service, next to
 * the hub's president.service (src/cli/tray-linux.ts); systemd starts, restarts and stops
 * both, so unlike the Windows helper this doesn't run the hub, and it keeps running (grey)
 * while the hub restarts. It:
 * - shows how many cards are in the Queue (GET /api/queue-count, polled every few seconds),
 *   drawn as the Windows helper draws it, or that the hub isn't running;
 * - says in its tooltip which build is served (branch @ short sha, PRESIDENT_BUILD), so a
 *   pull request's build can't be taken for main's;
 * - opens the hub with xdg-open on a click, and has Open president and Quit in its menu
 *   (com.canonical.dbusmenu); Quit stops president.service and this icon's unit.
 *
 * It talks to the session bus with dbus-native (pure JavaScript, no compiled addon). Without
 * a tray host (no StatusNotifierWatcher on the bus) it waits for one quietly: the hub is a
 * separate unit and runs either way.
 */
import { execFile, spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient, defineInterface, type MessageBus, Variant } from "dbus-native";

export const HUB_UNIT = "president.service";
const ICON_UNIT = "president-tray.service";
/** How often the icon asks the hub for the count, as the Windows helper does. */
const POLL_MS = 3000;
const ITEM_PATH = "/StatusNotifierItem";
const MENU_PATH = "/MenuBar";
const WATCHER = "org.kde.StatusNotifierWatcher";

/** What the icon shows: the number of cards waiting, or why there is none. */
export type HubView = number | "down" | "foreign";

/** Everything the icon touches besides the bus, so tests can run it without a desktop. */
export interface IconDeps {
  port: number;
  /** The build served, "main @ 1a2b3c4" (PRESIDENT_BUILD, written by `preside tray install`). */
  build: string;
  /** /api/health and /api/queue-count's JSON, or undefined when the hub doesn't answer. */
  getJson(path: string): Promise<unknown>;
  /** The pid systemd gives president.service (0: not running), undefined if it can't tell. */
  hubPid(): Promise<number | undefined>;
  /** Opens a URL in the browser. */
  open(url: string): void;
  /** Stops president.service and this icon's unit. */
  quit(): void;
  log(line: string): void;
}

export function systemIconDeps(env: NodeJS.ProcessEnv = process.env): IconDeps {
  const port = Number(env.PRESIDENT_PORT ?? 4747);
  return {
    port,
    build: env.PRESIDENT_BUILD || "unknown build",
    getJson: async (path) => {
      try {
        const response = await fetch(`http://127.0.0.1:${port}${path}`, {
          signal: AbortSignal.timeout(2000),
        });
        return response.ok ? await response.json() : undefined;
      } catch {
        return undefined;
      }
    },
    hubPid: () =>
      new Promise((resolve) => {
        execFile(
          "systemctl",
          ["--user", "show", "--property=MainPID", "--value", HUB_UNIT],
          { env, timeout: 10_000 },
          (error, stdout) => {
            const pid = Number(stdout.trim());
            resolve(error || !Number.isInteger(pid) ? undefined : pid);
          },
        );
      }),
    open: (url) => {
      const options = { detached: true, stdio: "ignore", env: withDisplay(env) } as const;
      const direct = () => {
        const child = spawn("xdg-open", [url], options);
        child.on("error", (error) => console.error(`preside-tray: xdg-open: ${error.message}`));
        child.unref();
      };
      // In a scope of its own: a browser xdg-open starts would otherwise be in this unit's
      // cgroup, and stopping the icon (Quit, a new install) would close it. Without
      // systemd-run, or if it fails, xdg-open directly.
      const scoped = spawn(
        "systemd-run",
        ["--user", "--scope", "--collect", "--quiet", "xdg-open", url],
        options,
      );
      let fellBack = false;
      const fallBack = () => {
        if (fellBack) return;
        fellBack = true;
        direct();
      };
      scoped.on("error", fallBack);
      scoped.on("exit", (code) => {
        if (code !== 0) fallBack();
      });
      scoped.unref();
    },
    quit: () => {
      // Both units (the icon isn't tied to the hub's). --no-block: stopping the icon stops
      // this process too, systemctl included.
      execFile(
        "systemctl",
        ["--user", "stop", "--no-block", HUB_UNIT, ICON_UNIT],
        { env },
        (error) => {
          if (error) console.error(`preside-tray: stopping ${HUB_UNIT}: ${error.message}`);
        },
      );
    },
    log: (line) => console.log(`preside-tray: ${line}`),
  };
}

/**
 * The environment xdg-open needs to reach the browser. A systemd user service only has
 * WAYLAND_DISPLAY or DISPLAY when the session exported them to systemd (KDE, GNOME and
 * uwsm do; a Hyprland started by hand may not), so when neither is set this finds the
 * session's socket the way a terminal would have it.
 */
export function withDisplay(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (env.WAYLAND_DISPLAY || env.DISPLAY) return env;
  const filled = { ...env };
  const runtime = env.XDG_RUNTIME_DIR;
  const wayland = runtime
    ? readdirSafe(runtime)
        .filter((name) => /^wayland-\d+$/.test(name))
        .sort()[0]
    : undefined;
  if (wayland) filled.WAYLAND_DISPLAY = wayland;
  const x11 = readdirSafe("/tmp/.X11-unix")
    .filter((name) => /^X\d+$/.test(name))
    .sort()[0];
  if (x11) filled.DISPLAY = `:${x11.slice(1)}`;
  return filled;
}

function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** The session bus's address: the environment's, or systemd's user bus. */
export function sessionBusAddress(env: NodeJS.ProcessEnv): string | undefined {
  if (env.DBUS_SESSION_BUS_ADDRESS) return env.DBUS_SESSION_BUS_ADDRESS;
  const bus = env.XDG_RUNTIME_DIR ? join(env.XDG_RUNTIME_DIR, "bus") : undefined;
  return bus && existsSync(bus) ? `unix:path=${bus}` : undefined;
}

/** What the tooltip's first line says: the Windows helper's words. */
export function tooltipTitle(view: HubView, port: number): string {
  if (view === "foreign") return `president: port ${port} in use by another program`;
  if (view === "down") return "president: hub not running";
  if (view === 0) return "president: nothing waiting";
  return `president: ${view} ${view === 1 ? "card" : "cards"} waiting`;
}

/** The tooltip's second line, the build served (StatusNotifierItem descriptions are markup). */
export function tooltipBody(build: string): string {
  return `Serving ${build}`.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Asks the hub what to show. `known.pid` is the hub already checked to be systemd's. */
export async function lookAtHub(deps: IconDeps, known: { pid?: number }): Promise<HubView> {
  const health = (await deps.getJson("/api/health")) as { pid?: unknown } | undefined;
  if (typeof health?.pid !== "number") return "down";
  if (health.pid !== known.pid) {
    // Another program on the port (`npm start` left running) would show its count, and the
    // tooltip would name a build it isn't: as on Windows, the pid tells them apart.
    const ours = await deps.hubPid();
    if (ours !== undefined && ours !== health.pid) return "foreign";
    known.pid = health.pid;
  }
  const answer = (await deps.getJson("/api/queue-count")) as { count?: unknown } | undefined;
  return typeof answer?.count === "number" ? answer.count : "down";
}

// The icon, drawn as tray/windows/PresideTray.cs draws it: the favicon's rounded square with
// its check mark when nothing is waiting, the number on an orange badge when cards are (9+
// above nine), grey with a bar when the hub isn't running. Shapes are in a 32-unit square,
// rasterized here with 4x4 samples a pixel; StatusNotifierItem takes ARGB32 pixmaps.

type Rgb = readonly [number, number, number];
const ACCENT: Rgb = [0x3d, 0x5a, 0x80];
const DOWN: Rgb = [0x8a, 0x8f, 0x98];
const BADGE: Rgb = [0xd9, 0x48, 0x0f];
const WHITE: Rgb = [0xff, 0xff, 0xff];
/** The sizes offered; the tray host picks and scales. */
export const ICON_SIZES = [16, 22, 32, 48];

type Inside = (x: number, y: number) => boolean;
/** A line through points given as x0, y0, x1, y1... */
type Polyline = number[];

function segmentDistance(x: number, y: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

/** Round-capped `lines`, `width` wide. */
function stroke(width: number, ...lines: Polyline[]): Inside {
  return (x, y) =>
    lines.some((p) => {
      for (let i = 0; i + 3 < p.length; i += 2) {
        const [ax, ay, bx, by] = p.slice(i, i + 4) as [number, number, number, number];
        if (segmentDistance(x, y, ax, ay, bx, by) <= width / 2) return true;
      }
      return false;
    });
}

function rounded(left: number, top: number, w: number, h: number, radius: number): Inside {
  const r = Math.min(radius, w / 2, h / 2);
  return (x, y) => {
    const dx = Math.max(left + r - x, 0, x - (left + w - r));
    const dy = Math.max(top + r - y, 0, y - (top + h - r));
    return x >= left && x <= left + w && y >= top && y <= top + h && dx * dx + dy * dy <= r * r;
  };
}

// Seven-segment digits: segments a (top), b, c (right), d (bottom), e, f (left), g (middle).
const SEGMENTS: Record<string, string> = {
  "0": "abcdef",
  "2": "abged",
  "3": "abgcd",
  "4": "fgbc",
  "5": "afgcd",
  "6": "afgedc",
  "7": "abc",
  "8": "abcdefg",
  "9": "abcdfg",
};

/** A character of the badge, centred on (cx, cy), `h` tall. */
function glyph(char: string, cx: number, cy: number, h: number): Polyline[] {
  const w = h * 0.55;
  const [l, r, t, m, b] = [cx - w / 2, cx + w / 2, cy - h / 2, cy, cy + h / 2];
  if (char === "1") return [[cx, t, cx, b]];
  if (char === "+")
    return [
      [l, m, r, m],
      [cx, m - w / 2, cx, m + w / 2],
    ];
  const ends: Record<string, Polyline> = {
    a: [l, t, r, t],
    b: [r, t, r, m],
    c: [r, m, r, b],
    d: [l, b, r, b],
    e: [l, m, l, b],
    f: [l, t, l, m],
    g: [l, m, r, m],
  };
  return [...(SEGMENTS[char] ?? "")].map((segment) => ends[segment] as Polyline);
}

/** The badge's text, as on Windows: nothing for 0, 9+ above nine. */
export function badgeText(count: number): string | undefined {
  if (count <= 0) return undefined;
  return count > 9 ? "9+" : String(count);
}

function layers(view: HubView): [Inside, Rgb][] {
  const down = view === "down" || view === "foreign";
  const shown: [Inside, Rgb][] = [[rounded(0, 0, 32, 32, 7), down ? DOWN : ACCENT]];
  const badge = typeof view === "number" ? badgeText(view) : undefined;
  if (down) shown.push([stroke(3, [9, 16, 23, 16]), WHITE]);
  else if (badge === undefined) shown.push([stroke(3, [9, 17, 14, 22, 23, 10]), WHITE]);
  if (badge !== undefined) {
    // Most of the icon's height, wider for "9+", with a white edge.
    const h = 32 * 0.72;
    const w = badge.length > 1 ? 32 : h;
    const [left, top] = [32 - w, 32 - h];
    shown.push([rounded(left - 1, top - 1, w + 2, h + 2, h / 2 + 1), WHITE]);
    shown.push([rounded(left + 1, top + 1, w - 2, h - 2, h / 2 - 1), BADGE]);
    const cy = top + h / 2;
    const textHeight = h * 0.56;
    const lines =
      badge.length > 1
        ? [
            ...glyph(badge[0] as string, left + w * 0.36, cy, textHeight),
            ...glyph("+", left + w * 0.68, cy, textHeight * 0.85),
          ]
        : glyph(badge, left + w / 2, cy, textHeight);
    shown.push([stroke(2.8, ...lines), WHITE]);
  }
  return shown;
}

/** The icon at `size` pixels: ARGB32, big-endian, as StatusNotifierItem's IconPixmap wants. */
export function drawIcon(view: HubView, size: number): Buffer {
  const shown = layers(view);
  const pixels = Buffer.alloc(size * size * 4);
  const samples = 4;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let [a, r, g, b] = [0, 0, 0, 0];
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const x = ((px + (sx + 0.5) / samples) * 32) / size;
          const y = ((py + (sy + 0.5) / samples) * 32) / size;
          let colour: Rgb | undefined;
          for (const [inside, fill] of shown) if (inside(x, y)) colour = fill;
          if (colour) {
            a += 1;
            r += colour[0];
            g += colour[1];
            b += colour[2];
          }
        }
      }
      const at = (py * size + px) * 4;
      if (a > 0) {
        pixels[at] = Math.round((255 * a) / (samples * samples));
        pixels[at + 1] = Math.round(r / a);
        pixels[at + 2] = Math.round(g / a);
        pixels[at + 3] = Math.round(b / a);
      }
    }
  }
  return pixels;
}

function pixmaps(view: HubView): [number, number, Buffer][] {
  return ICON_SIZES.map((size) => [size, size, drawIcon(view, size)]);
}

// The menu's items (com.canonical.dbusmenu ids; 0 is the root).
const MENU_BUILD = 1;
const MENU_OPEN = 3;
const MENU_QUIT = 4;

/** The menu: the build served (greyed out), Open president, Quit. */
export function menuLayout(build: string): [number, Record<string, unknown>, Variant[]] {
  const item = (id: number, properties: Record<string, unknown>) =>
    new Variant("(ia{sv}av)", [id, properties, []]);
  return [
    0,
    { "children-display": "submenu" },
    [
      // dbusmenu takes `_` as a mnemonic mark (feat_x would show as featx): `__` is one `_`.
      item(MENU_BUILD, { label: `Serving ${build}`.replace(/_/g, "__"), enabled: false }),
      item(2, { type: "separator" }),
      item(MENU_OPEN, { label: "Open president" }),
      item(MENU_QUIT, { label: "Quit" }),
    ],
  ];
}

export interface RunningIcon {
  /** Looks at the hub now (otherwise every few seconds) and updates the icon. */
  refresh(): Promise<void>;
  /** What it shows. */
  readonly view: HubView;
  /** The bus name the item is exported under. */
  readonly busName: string;
  /** Resolves if the bus connection ends other than by close() (the bus went away). */
  readonly lost: Promise<void>;
  close(): Promise<void>;
}

/**
 * Puts the icon on the bus at `busAddress` and keeps it current. Registers with the tray host
 * now if there is one, and again whenever one appears (waybar started, or restarted, later).
 */
export async function startIcon(
  busAddress: string,
  deps: IconDeps,
  pollMs = POLL_MS,
): Promise<RunningIcon> {
  const bus: MessageBus = createClient({ busAddress });
  await new Promise<void>((resolve, reject) => {
    bus.connection.once("connect", () => resolve());
    bus.connection.once("error", reject);
  });
  const busName = `org.kde.StatusNotifierItem-${process.pid}-1`;
  await bus.ownName(busName, 4);

  let view: HubView = "down";
  let images = pixmaps(view);
  let title = tooltipTitle(view, deps.port);
  const url = `http://127.0.0.1:${deps.port}`;
  const body = tooltipBody(deps.build);

  const item = defineInterface({
    name: "org.kde.StatusNotifierItem",
    properties: {
      Category: { type: "s", access: "read", value: "ApplicationStatus" },
      Id: { type: "s", access: "read", value: "president" },
      Title: { type: "s", access: "read", value: "president" },
      Status: { type: "s", access: "read", value: "Active" },
      WindowId: { type: "i", access: "read", value: 0 },
      IconName: { type: "s", access: "read", value: "" },
      IconPixmap: { type: "a(iiay)", access: "read", get: () => images },
      OverlayIconName: { type: "s", access: "read", value: "" },
      AttentionIconName: { type: "s", access: "read", value: "" },
      ToolTip: { type: "(sa(iiay)ss)", access: "read", get: () => ["", [], title, body] },
      ItemIsMenu: { type: "b", access: "read", value: false },
      Menu: { type: "o", access: "read", value: MENU_PATH },
    },
    methods: {
      Activate: { in: { x: "i", y: "i" }, handler: () => deps.open(url) },
      SecondaryActivate: { in: { x: "i", y: "i" }, handler: () => deps.open(url) },
      ContextMenu: { in: { x: "i", y: "i" }, handler: () => undefined },
      Scroll: { in: { delta: "i", orientation: "s" }, handler: () => undefined },
    },
    signals: {
      NewTitle: {},
      NewIcon: {},
      NewToolTip: {},
      NewStatus: { args: { status: "s" } },
    },
  });

  const layout = menuLayout(deps.build);
  const menuItems = new Map<number, Record<string, unknown>>(
    (layout[2] as Variant[]).map((child) => {
      const [id, properties] = (child as unknown as { value: [number, Record<string, unknown>] })
        .value;
      return [id, properties];
    }),
  );
  menuItems.set(0, layout[1]);
  const clicked = (id: number) => {
    if (id === MENU_OPEN) deps.open(url);
    else if (id === MENU_QUIT) deps.quit();
  };
  const menu = defineInterface({
    name: "com.canonical.dbusmenu",
    properties: {
      Version: { type: "u", access: "read", value: 3 },
      TextDirection: { type: "s", access: "read", value: "ltr" },
      Status: { type: "s", access: "read", value: "normal" },
      IconThemePath: { type: "as", access: "read", value: [] },
    },
    methods: {
      GetLayout: {
        in: { parentId: "i", recursionDepth: "i", propertyNames: "as" },
        out: { revision: "u", layout: "(ia{sv}av)" },
        // The menu never changes, so every parent is answered with the whole tree from the
        // root (all a parent other than 0 has is no children).
        handler: ({ parentId }: { parentId: number }) => ({
          revision: 1,
          layout: parentId === 0 ? layout : [parentId, menuItems.get(parentId) ?? {}, []],
        }),
      },
      GetGroupProperties: {
        in: { ids: "ai", propertyNames: "as" },
        out: { properties: "a(ia{sv})" },
        handler: ({ ids }: { ids: number[] }) =>
          (ids.length > 0 ? ids : [...menuItems.keys()])
            .filter((id) => menuItems.has(id))
            .map((id) => [id, menuItems.get(id)]),
      },
      GetProperty: {
        in: { id: "i", name: "s" },
        out: { value: "v" },
        handler: ({ id, name }: { id: number; name: string }) => {
          const value = menuItems.get(id)?.[name];
          return new Variant(typeof value === "boolean" ? "b" : "s", value ?? "");
        },
      },
      Event: {
        in: { id: "i", eventId: "s", data: "v", timestamp: "u" },
        handler: ({ id, eventId }: { id: number; eventId: string }) => {
          if (eventId === "clicked") clicked(id);
        },
      },
      EventGroup: {
        in: { events: "a(isvu)" },
        out: { idErrors: "ai" },
        handler: ({ events }: { events: [number, string, unknown, number][] }) => {
          for (const [id, eventId] of events) if (eventId === "clicked") clicked(id);
          return [];
        },
      },
      AboutToShow: { in: { id: "i" }, out: { needUpdate: "b" }, handler: () => false },
      AboutToShowGroup: {
        in: { ids: "ai" },
        out: { updatesNeeded: "ai", idErrors: "ai" },
        handler: () => ({ updatesNeeded: [], idErrors: [] }),
      },
    },
    signals: {
      ItemsPropertiesUpdated: { args: { updatedProps: "a(ia{sv})", removedProps: "a(ias)" } },
      LayoutUpdated: { args: { revision: "u", parent: "i" } },
      ItemActivationRequested: { args: { id: "i", timestamp: "u" } },
    },
  });
  await bus.export(ITEM_PATH, item);
  await bus.export(MENU_PATH, menu);

  const register = async () => {
    try {
      await bus.invoke({
        destination: WATCHER,
        path: "/StatusNotifierWatcher",
        interface: WATCHER,
        member: "RegisterStatusNotifierItem",
        signature: "s",
        body: [busName],
      });
      deps.log("registered with the tray");
    } catch {
      // No tray host yet: it is registered when one comes (NameOwnerChanged below).
    }
  };
  const dbus = await bus.getInterface(
    "org.freedesktop.DBus",
    "/org/freedesktop/DBus",
    "org.freedesktop.DBus",
  );
  await dbus.$subscribe("NameOwnerChanged", (name: string, _old: string, owner: string) => {
    if (name === WATCHER && owner) void register();
  });
  await register();

  const known: { pid?: number } = {};
  let busy: Promise<void> | undefined;
  const refresh = () => {
    busy ??= (async () => {
      try {
        const next = await lookAtHub(deps, known);
        if (next === view) return;
        view = next;
        images = pixmaps(view);
        item.emit.NewIcon?.();
        const nextTitle = tooltipTitle(view, deps.port);
        if (nextTitle !== title) {
          title = nextTitle;
          item.emit.NewToolTip?.();
        }
      } finally {
        busy = undefined;
      }
    })();
    return busy;
  };
  const timer = setInterval(() => void refresh(), pollMs);
  await refresh();

  let closing = false;
  const lost = new Promise<void>((resolve) => {
    const gone = () => {
      if (!closing) resolve();
    };
    bus.connection.on("close", gone);
    bus.connection.on("error", gone);
  });
  return {
    refresh,
    get view() {
      return view;
    },
    busName,
    lost,
    close: async () => {
      closing = true;
      clearInterval(timer);
      await busy;
      await bus.close();
    },
  };
}

async function main(): Promise<void> {
  const deps = systemIconDeps();
  const address = sessionBusAddress(process.env);
  if (!address) {
    // Exits with an error, so systemd tries again later (the bus may not be up yet).
    console.error("preside-tray: no session bus (DBUS_SESSION_BUS_ADDRESS isn't set)");
    process.exit(1);
  }
  const icon = await startIcon(address, deps);
  deps.log(`showing ${tooltipTitle(icon.view, deps.port)} (${deps.build})`);
  const stop = () => void icon.close().then(() => process.exit(0));
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  // Lost the bus: exits with an error, and systemd starts the icon again.
  await icon.lost;
  console.error("preside-tray: lost the session bus");
  process.exit(1);
}

if (import.meta.main) await main();
