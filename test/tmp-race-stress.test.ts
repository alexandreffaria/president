// TEMP: stress for the Windows registry race; removed before merge.
import { join } from "node:path";
import { expect, it } from "vitest";
import { Registry } from "../src/server/registry.ts";
import { copyDemoProject, tempDir } from "./helpers.ts";

it("survives many racing adds of one folder", { timeout: 600_000 }, async () => {
  const demo = await copyDemoProject();
  const errors: string[] = [];
  for (let round = 0; round < 300; round++) {
    const config = join(await tempDir(), "config");
    const again = () => new Registry(config);
    const names = ["c", "a", "b", "d", "e", "f"];
    const results = await Promise.allSettled(
      names.map((name) => again().add({ path: demo, name })),
    );
    for (const r of results) if (r.status === "rejected") errors.push(String(r.reason));
  }
  console.log(`STRESS: ${errors.length} failed adds`, errors.slice(0, 5));
  expect(errors).toEqual([]);
});
