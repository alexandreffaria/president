// Runs the fixtures that check test/setup.ts itself (see test/setup-gate.test.ts).
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: `${import.meta.dirname}/../..`,
    include: ["test/gate/*.fixture.ts"],
    setupFiles: ["test/setup.ts"],
  },
});
