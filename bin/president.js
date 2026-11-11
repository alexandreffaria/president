#!/usr/bin/env node
// Entry point for the `president` command. Node 24 runs the TypeScript sources directly
// (type stripping), so the CLI works from a checkout without a build step.
// 24.9 for the HTTP server's shouldUpgradeCallback (see src/server/server.ts).
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 24 || (major === 24 && minor < 9)) {
  console.error(`president needs Node 24.9 or newer (you have ${process.versions.node}).`);
  process.exit(1);
}
const { run } = await import("../src/cli/main.ts");
process.exitCode = await run(process.argv.slice(2));
