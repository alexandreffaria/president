/**
 * Stopping a program president started (git, a Claude Code run) together with everything it
 * started in turn, whose open pipes would otherwise keep the run from ending until they exit
 * on their own. The program must have been spawned with `detached: true`: on Linux and macOS
 * that gives it its own process group.
 */
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { join } from "node:path";

/**
 * Sends `signal` to `child`'s process group. On Windows, which has no process groups,
 * taskkill /T /F stops the child's process tree at once, whatever the signal. That is only
 * started while the child is still running (`exited()` is checked when taskkill starts; a
 * small window remains in which the child exits and Windows gives its PID to another
 * process): /T can't find the tree of a process that is gone, and /T /F would kill another
 * process's tree.
 *
 * Once the child has exited, a process it started that is out of reach (on Windows any, its
 * tree gone; elsewhere one in a session of its own) may still hold the child's output open,
 * which would keep `close` from ever coming. So the child's pipes are closed too, and the run
 * ends; that process is left running.
 */
export function killTree(child: ChildProcess, signal: NodeJS.Signals, exited: () => boolean): void {
  if (process.platform === "win32") {
    if (exited()) {
      closePipes(child);
      return;
    }
    if (child.pid === undefined) return;
    // By its full path: a taskkill.exe in the hub's cwd (a project folder) would come first.
    const taskkill = spawn(
      join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe"),
      ["/pid", String(child.pid), "/t", "/f"],
      { stdio: "ignore", windowsHide: true },
    );
    const fallback = () => {
      if (!exited()) child.kill(signal);
    };
    taskkill.on("error", fallback);
    // Access denied, say: the child is still running, so at least it goes.
    taskkill.on("exit", (code) => {
      if (code !== 0) fallback();
    });
    return;
  }
  try {
    if (child.pid !== undefined) process.kill(-child.pid, signal);
  } catch {
    // Already gone: stop the child itself.
    child.kill(signal);
  }
  if (exited()) closePipes(child);
}

function closePipes(child: ChildProcess): void {
  child.stdin?.destroy();
  child.stdout?.destroy();
  child.stderr?.destroy();
}
