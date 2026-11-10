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

// A separate vitest process: Node's start-up and vitest's own take most of its ~1 s.
it("fails tests and files that warn or log errors, however late", { timeout: 15_000 }, async () => {
  const output = join(await tempDir(), "report.json");
  await promisify(execFile)(
    process.execPath,
    [
      join(ROOT, "node_modules", "vitest", "vitest.mjs"),
      "run",
      "--config",
      join(ROOT, "test", "gate", "vitest.config.ts"),
      "--reporter=json",
      `--outputFile=${output}`,
    ],
    { cwd: ROOT, timeout: 14_000 },
  ).catch(() => {}); // it exits 1: that's the point
  const report = JSON.parse(await readFile(output, "utf8")) as JsonReport;
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
