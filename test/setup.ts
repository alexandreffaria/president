/**
 * Runs before every test file. Output that means something went wrong fails the run, so
 * code that should keep stderr quiet can't start writing to it unnoticed:
 *
 * - a process warning (such as the `yaml` library's "Keys with collection values will be
 *   stringified");
 * - console.error and console.warn, where React reports its warnings (a missing `key`, an
 *   update outside act) and the server logs its errors.
 *
 * Each test is checked when it ends. What comes later (a timer that outlives its test, an
 * afterAll hook) is checked once the file's tests are done, after a short grace period.
 * A test that expects such output says so with `expectConsole`, and then only matching
 * messages are allowed, and at least one must come.
 */
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { format } from "node:util";
import { afterAll, afterEach, expect } from "vitest";

// On Windows the temp folder can come as a short 8.3 name (C:\Users\RUNNER~1\...), and
// president resolves the paths it is given to their real, long names: tests compare those
// with the temp folders they made, so the temp folder is the long name from the start.
if (process.platform === "win32") {
  process.env.TEMP = process.env.TMP = realpathSync.native(tmpdir());
}

// president's state folder (card conversations, chat/store.ts) is a temp folder in every
// test, so no test can read or clean up the real ~/.local/state/president, whatever hub it
// starts. Claude Code's folder too: no test looks at the real ~/.claude.
const stateHome = mkdtempSync(join(tmpdir(), "president-state-"));
process.env.XDG_STATE_HOME = stateHome;
process.env.CLAUDE_CONFIG_DIR = join(stateHome, "claude");
// And `claude` on PATH is the stand-in (test/fake-claude.mjs), so even a hub a test starts
// without one can never run the real Claude Code.
mkdirSync(join(stateHome, "bin"));
mkdirSync(join(stateHome, "fake"));
try {
  symlinkSync(join(import.meta.dirname, "fake-claude.mjs"), join(stateHome, "bin", "claude"));
} catch (error) {
  // Windows without Developer Mode can't make links. A copy still comes first on PATH (Windows
  // tries the exact name before adding .com or .exe), so the real Claude Code never runs.
  if (process.platform !== "win32") throw error;
  copyFileSync(join(import.meta.dirname, "fake-claude.mjs"), join(stateHome, "bin", "claude"));
}
process.env.PATH = `${join(stateHome, "bin")}${delimiter}${process.env.PATH ?? ""}`;
process.env.FAKE_CLAUDE_DIR = join(stateHome, "fake");
afterAll(() => rmSync(stateHome, { recursive: true, force: true }));

/** How long after a file's last test late output is still caught. */
const LATE_MS = 100;

type Level = "error" | "warn";

const problems: string[] = [];
let expected: { level: Level; pattern: RegExp; seen: boolean }[] = [];

const emitWarning = process.emitWarning.bind(process);
process.emitWarning = ((warning: string | Error, ...rest: never[]) => {
  problems.push(`process warning: ${typeof warning === "string" ? warning : warning.message}`);
  return emitWarning(warning, ...rest);
}) as typeof process.emitWarning;

for (const level of ["error", "warn"] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    const message = format(...args);
    const allowed = expected.filter((e) => e.level === level && e.pattern.test(message));
    for (const e of allowed) e.seen = true;
    if (allowed.length > 0) return;
    problems.push(`console.${level}: ${message.split("\n")[0]}`);
    original(...args);
  };
}

/**
 * Allows console[level] messages that match `pattern` in the current test, and fails the
 * test if none comes. Other messages still fail it.
 */
export function expectConsole(level: Level, pattern: RegExp): void {
  expected.push({ level, pattern, seen: false });
}

afterEach(() => {
  const missing = expected.filter((e) => !e.seen).map((e) => `console.${e.level} ${e.pattern}`);
  expected = [];
  expect(problems.splice(0), "warnings and console errors during the test").toEqual([]);
  expect(missing, "expected console output that never came").toEqual([]);
});

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, LATE_MS));
  expect(problems.splice(0), "warnings and console errors after the tests").toEqual([]);
});
