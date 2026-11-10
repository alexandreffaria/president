import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    include: ["test/**/*.test.{ts,tsx}"],
    // UI tests opt into a DOM with `// @vitest-environment happy-dom`.
    environment: "node",
    // Fails a test that makes the process print a warning.
    setupFiles: ["test/setup.ts"],
  },
});
