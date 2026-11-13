/**
 * The Linux tray icon (tray/linux/preside-tray.ts) on a private bus: dbus-native's in-process
 * broker on a socket in a temp folder, never the session bus, with a stand-in tray host (the
 * StatusNotifierWatcher waybar or KDE would be) and a stand-in hub. systemctl and xdg-open
 * are fakes too.
 */
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createBroker, createClient, defineInterface, type MessageBus } from "dbus-native";
import { describe, expect, it } from "vitest";
import {
  badgeText,
  drawIcon,
  type IconDeps,
  lookAtHub,
  menuLayout,
  sessionBusAddress,
  startIcon,
  systemIconDeps,
  tooltipBody,
  tooltipTitle,
  withDisplay,
} from "../tray/linux/preside-tray.ts";
import { tempDir } from "./helpers.ts";

const ACCENT = [0x3d, 0x5a, 0x80];
const DOWN = [0x8a, 0x8f, 0x98];
const BADGE = [0xd9, 0x48, 0x0f];

/** [a, r, g, b] of the pixel at (x, y). */
function pixel(icon: Buffer, size: number, x: number, y: number): number[] {
  const at = (y * size + x) * 4;
  return [...icon.subarray(at, at + 4)];
}

function fakeHub(options: { count?: number; pid?: number; systemdPid?: number } = {}) {
  const state = { count: options.count ?? 3, pid: options.pid ?? 42, up: true, pidAsks: 0 };
  const opened: string[] = [];
  let quits = 0;
  const deps: IconDeps = {
    port: 4747,
    build: "feat/x @ 9f8e7d6",
    getJson: async (path) => {
      if (!state.up) return undefined;
      return path === "/api/health" ? { ok: true, pid: state.pid } : { count: state.count };
    },
    hubPid: async () => {
      state.pidAsks++;
      return options.systemdPid ?? 42;
    },
    open: (url) => opened.push(url),
    quit: () => {
      quits++;
    },
    log: () => {},
  };
  return {
    deps,
    state,
    opened,
    get quits() {
      return quits;
    },
  };
}

describe("the Linux tray icon's parts", () => {
  it("words the tooltip as the Windows helper does, and names the build", () => {
    expect(tooltipTitle(0, 4747)).toBe("president: nothing waiting");
    expect(tooltipTitle(1, 4747)).toBe("president: 1 card waiting");
    expect(tooltipTitle(12, 4747)).toBe("president: 12 cards waiting");
    expect(tooltipTitle("down", 4747)).toBe("president: hub not running");
    expect(tooltipTitle("foreign", 4800)).toBe("president: port 4800 in use by another program");
    expect(tooltipBody("fix/<a&b> @ 1a2b3c4")).toBe("Serving fix/&lt;a&amp;b&gt; @ 1a2b3c4");
    expect([badgeText(0), badgeText(3), badgeText(9), badgeText(10)]).toEqual([
      undefined,
      "3",
      "9",
      "9+",
    ]);
  });

  it("draws the favicon's square, an orange badge for cards, grey when the hub is down", () => {
    for (const size of [16, 22, 32, 48]) {
      const icon = drawIcon(0, size);
      expect(icon).toHaveLength(size * size * 4);
      // Rounded corners: transparent at the very corner, opaque in the middle of an edge.
      expect(pixel(icon, size, 0, 0)[0]).toBe(0);
      expect(pixel(icon, size, Math.floor(size / 2), 1)).toEqual([255, ...ACCENT]);
    }
    const three = drawIcon(3, 32);
    expect(pixel(three, 32, 2, 2)).toEqual([255, ...ACCENT]);
    // The badge sits bottom right; its fill shows beside the digit.
    expect(pixel(three, 32, 14, 20)).toEqual([255, ...BADGE]);
    expect(pixel(drawIcon("down", 32), 32, 2, 2)).toEqual([255, ...DOWN]);
    expect(drawIcon("foreign", 32)).toEqual(drawIcon("down", 32));
    expect(drawIcon(12, 32)).toEqual(drawIcon(10, 32));
    expect(drawIcon(10, 32)).not.toEqual(drawIcon(9, 32));
  });

  it("asks systemd for the hub's pid once per hub, and calls another program's hub foreign", async () => {
    const hub = fakeHub();
    const known: { pid?: number } = {};
    expect(await lookAtHub(hub.deps, known)).toBe(3);
    expect(await lookAtHub(hub.deps, known)).toBe(3);
    expect(hub.state.pidAsks).toBe(1);
    hub.state.up = false;
    expect(await lookAtHub(hub.deps, known)).toBe("down");
    hub.state.up = true;
    hub.state.pid = 7;
    expect(await lookAtHub(hub.deps, known)).toBe("foreign");
    expect(await lookAtHub(fakeHub({ systemdPid: 0 }).deps, {})).toBe("foreign");
  });

  it("finds the session bus and the display a systemd service may not be given", async () => {
    const runtime = await tempDir();
    expect(sessionBusAddress({ DBUS_SESSION_BUS_ADDRESS: "unix:path=/x" })).toBe("unix:path=/x");
    expect(sessionBusAddress({ XDG_RUNTIME_DIR: runtime })).toBeUndefined();
    await writeFile(join(runtime, "bus"), "");
    expect(sessionBusAddress({ XDG_RUNTIME_DIR: runtime })).toBe(
      `unix:path=${join(runtime, "bus")}`,
    );

    const set = { WAYLAND_DISPLAY: "wayland-0", XDG_RUNTIME_DIR: runtime };
    expect(withDisplay(set)).toBe(set);
    await writeFile(join(runtime, "wayland-1"), "");
    await writeFile(join(runtime, "wayland-1.lock"), "");
    expect(withDisplay({ XDG_RUNTIME_DIR: runtime }).WAYLAND_DISPLAY).toBe("wayland-1");
  });

  it("has a menu with the build, Open president and Quit", () => {
    const [id, properties, children] = menuLayout("main @ 1a2b3c4");
    expect([id, properties]).toEqual([0, { "children-display": "submenu" }]);
    expect(children.map((child) => (child as unknown as { value: unknown[] }).value)).toEqual([
      [1, { label: "Serving main @ 1a2b3c4", enabled: false }, []],
      [2, { type: "separator" }, []],
      [3, { label: "Open president" }, []],
      [4, { label: "Quit" }, []],
    ]);
    // `_` marks a mnemonic in dbusmenu, so a branch's underscores are doubled.
    const [, , underscored] = menuLayout("fix_tray @ 1a2b3c4");
    expect((underscored[0] as unknown as { value: unknown[] }).value[1]).toEqual({
      label: "Serving fix__tray @ 1a2b3c4",
      enabled: false,
    });
  });

  it.skipIf(process.platform === "win32")(
    "runs systemctl from PATH, and opens the browser in a scope of its own, the display filled in",
    async () => {
      const fake = await fakeBin({ systemdRun: 0 });
      expect([fake.deps.port, fake.deps.build]).toEqual([4800, "main @ 1a2b3c4"]);
      expect(await fake.deps.hubPid()).toBe(4242);
      fake.deps.open("http://127.0.0.1:4800");
      fake.deps.quit();
      expect(await fake.lines(3)).toEqual([
        "systemctl --user show --property=MainPID --value president.service WAYLAND_DISPLAY=",
        "systemctl --user stop --no-block president.service president-tray.service WAYLAND_DISPLAY=",
        "systemd-run --user --scope --collect --quiet xdg-open http://127.0.0.1:4800 WAYLAND_DISPLAY=wayland-1",
      ]);
    },
  );

  it.skipIf(process.platform === "win32")(
    "opens the browser with xdg-open directly when systemd-run fails or isn't there",
    async () => {
      for (const systemdRun of [1, undefined]) {
        const fake = await fakeBin({ systemdRun });
        fake.deps.open("http://127.0.0.1:4800");
        const lines = await fake.lines(systemdRun === undefined ? 1 : 2);
        expect(lines).toContain("xdg-open http://127.0.0.1:4800 WAYLAND_DISPLAY=wayland-1");
        expect(lines).toHaveLength(systemdRun === undefined ? 1 : 2);
      }
    },
  );
});

/**
 * systemIconDeps with fake systemctl, xdg-open and (exiting with `systemdRun`, or absent)
 * systemd-run on a PATH of their own, each writing its arguments to a log.
 */
async function fakeBin(options: { systemdRun?: number }) {
  const bin = await tempDir();
  const log = join(bin, "calls.log");
  const names = ["systemctl", "xdg-open"];
  if (options.systemdRun !== undefined) names.push("systemd-run");
  for (const name of names) {
    const code = name === "systemd-run" ? options.systemdRun : 0;
    await writeFile(
      join(bin, name),
      `#!/bin/sh\necho "${name} $* WAYLAND_DISPLAY=$WAYLAND_DISPLAY" >> "${log}"\n[ "$2" = show ] && echo 4242\nexit ${code}\n`,
    );
    await chmod(join(bin, name), 0o755);
  }
  const runtime = join(bin, "runtime");
  await mkdir(runtime);
  await writeFile(join(runtime, "wayland-1"), "");
  const deps = systemIconDeps({
    PATH: bin,
    XDG_RUNTIME_DIR: runtime,
    PRESIDENT_PORT: "4800",
    PRESIDENT_BUILD: "main @ 1a2b3c4",
  });
  return {
    deps,
    /** The log's lines, sorted, once there are `count` of them (and a moment for more). */
    async lines(count: number): Promise<string[]> {
      let text = "";
      for (let i = 0; i < 100 && text.trim().split("\n").length < count; i++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        text = await readFile(log, "utf8").catch(() => "");
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
      return (await readFile(log, "utf8")).trim().split("\n").sort();
    },
  };
}

/** A private bus and a client on it standing in for the tray host. */
async function privateBus() {
  const dir = await tempDir();
  const broker = createBroker();
  const address = await new Promise<string>((resolve, reject) =>
    broker.listen({ socket: join(dir, "bus") }, (error, at) =>
      error ? reject(error) : resolve(at),
    ),
  );
  const host: MessageBus = createClient({ busAddress: address });
  const registered: string[] = [];
  const watcher = defineInterface({
    name: "org.kde.StatusNotifierWatcher",
    methods: {
      RegisterStatusNotifierItem: {
        in: { service: "s" },
        handler: ({ service }: { service: string }) => {
          registered.push(service);
        },
      },
    },
  });
  return {
    address,
    host,
    registered,
    /** Becomes the tray host, as waybar does when it starts. */
    async startWatcher() {
      await host.export("/StatusNotifierWatcher", watcher);
      await host.ownName("org.kde.StatusNotifierWatcher", 4);
    },
    async close() {
      await host.close();
      await new Promise<void>((resolve) => broker.close(() => resolve()));
    },
  };
}

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 20));
  expect(check()).toBe(true);
}

// Unix sockets in a temp folder: where the icon runs.
describe.skipIf(process.platform === "win32")("the Linux tray icon on a bus", () => {
  it("registers with the tray host, shows the count and the build, opens and quits", {
    timeout: 20_000,
  }, async () => {
    const bus = await privateBus();
    await bus.startWatcher();
    const hub = fakeHub();
    const icon = await startIcon(bus.address, hub.deps, 60_000);
    try {
      await until(() => bus.registered.length === 1);
      expect(bus.registered).toEqual([icon.busName]);

      const props = await bus.host.getInterface(
        icon.busName,
        "/StatusNotifierItem",
        "org.freedesktop.DBus.Properties",
      );
      const all = await props.GetAll("org.kde.StatusNotifierItem");
      expect(all).toMatchObject({
        Id: "president",
        Title: "president",
        Status: "Active",
        ItemIsMenu: false,
        Menu: "/MenuBar",
        ToolTip: ["", [], "president: 3 cards waiting", "Serving feat/x @ 9f8e7d6"],
      });
      const sizes = (all.IconPixmap as [number, number, Buffer][]).map(([w, h, data]) => [
        w,
        h,
        data.length,
      ]);
      expect(sizes).toEqual([
        [16, 16, 1024],
        [22, 22, 1936],
        [32, 32, 4096],
        [48, 48, 9216],
      ]);

      const item = await bus.host.getInterface(
        icon.busName,
        "/StatusNotifierItem",
        "org.kde.StatusNotifierItem",
      );
      const signals: string[] = [];
      await item.$subscribe("NewIcon", () => signals.push("NewIcon"));
      await item.$subscribe("NewToolTip", () => signals.push("NewToolTip"));
      hub.state.count = 0;
      await icon.refresh();
      await until(() => signals.length === 2);
      expect(signals.sort()).toEqual(["NewIcon", "NewToolTip"]);
      expect((await props.Get("org.kde.StatusNotifierItem", "ToolTip"))[2]).toBe(
        "president: nothing waiting",
      );
      hub.state.up = false;
      await icon.refresh();
      expect(icon.view).toBe("down");

      await item.Activate(0, 0);
      expect(hub.opened).toEqual(["http://127.0.0.1:4747"]);

      const menu = await bus.host.getInterface(icon.busName, "/MenuBar", "com.canonical.dbusmenu");
      const [revision, layout] = await menu.GetLayout(0, -1, []);
      expect(revision).toBe(1);
      expect(layout[2].map((child: [number, Record<string, unknown>]) => child[1].label)).toEqual([
        "Serving feat/x @ 9f8e7d6",
        undefined,
        "Open president",
        "Quit",
      ]);
      await menu.Event(3, "clicked", ["s", ""], 0);
      expect(hub.opened).toHaveLength(2);
      expect(hub.quits).toBe(0);
      await menu.Event(4, "clicked", ["s", ""], 0);
      expect(hub.quits).toBe(1);
    } finally {
      await icon.close();
      await bus.close();
    }
  });

  it("waits for a tray host, and registers when one starts", { timeout: 20_000 }, async () => {
    const bus = await privateBus();
    const hub = fakeHub({ count: 1 });
    const icon = await startIcon(bus.address, hub.deps, 60_000);
    try {
      expect(icon.view).toBe(1);
      expect(bus.registered).toEqual([]);
      await bus.startWatcher();
      await until(() => bus.registered.length === 1);
      expect(bus.registered).toEqual([icon.busName]);
    } finally {
      await icon.close();
      await bus.close();
    }
  });
});
