/**
 * test/setup.ts fails a run on warnings and console errors (R3-12, R4-5). This runs vitest
 * on the fixtures in test/gate/ and checks that each problem fails what it should,
 * including output that comes after a file's last test.
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { tempDir } from "./helpers.ts";

const ROOT = join(import.meta.dirname, "..");

interface JsonReport {
  testResults: {
    name: string;
    status: string;
    message: string;
    assertionResults: { title: string; status: string }[];
  }[];
}

// A separate vitest process: Node's start-up and vitest's own take most of its ~1 s, but with
// four suites running at once it took over 14 s (a Node process and a worker per fixture
// file, all starting on a busy machine), so it gets a minute.
const RUN_MS = 60_000;

/** How the fixtures' vitest run ended, when it failed (as it should: exit code 1). */
type Run = { killed?: boolean; stdout?: string; stderr?: string };

it("fails tests and files that warn or log errors, however late", {
  timeout: RUN_MS + 5000,
}, async () => {
  const output = join(await tempDir(), "report.json");
  const run: Run = await promisify(execFile)(
    process.execPath,
    [
      join(ROOT, "node_modules", "vitest", "vitest.mjs"),
      "run",
      "--config",
      join(ROOT, "test", "gate", "vitest.config.ts"),
      "--reporter=json",
      `--outputFile=${output}`,
    ],
    { cwd: ROOT, timeout: RUN_MS },
  ).catch((error: Run) => error); // it exits 1: that's the point
  const text = await readFile(output, "utf8").catch(() => {
    const stopped = run.killed ? ` (stopped after ${RUN_MS / 1000} s)` : "";
    throw new Error(
      `the fixtures' vitest run wrote no report${stopped}:\n${run.stdout ?? ""}${run.stderr ?? ""}`,
    );
  });
  const report = JSON.parse(text) as JsonReport;
  const files = Object.fromEntries(
    report.testResults.map((file) => [
      file.name.split("/").at(-1),
      {
        status: file.status,
        late: file.message.includes("after the tests"),
        tests: Object.fromEntries(file.assertionResults.map((t) => [t.title, t.status])),
      },
    ]),
  );
  expect(files).toEqual({
    "late-timer.fixture.ts": {
      status: "failed",
      late: true,
      tests: { "starts a timer that warns after the test is over": "passed" },
    },
    "after-all.fixture.ts": { status: "failed", late: true, tests: { passes: "passed" } },
    "console.fixture.ts": {
      status: "failed",
      late: false,
      tests: {
        "logs a React warning": "failed",
        "logs a console.warn": "failed",
        "expects the error it logs": "passed",
        "expects an error that never comes": "failed",
        "expects one error but logs another": "failed",
        "stays quiet": "passed",
      },
    },
  });
});
