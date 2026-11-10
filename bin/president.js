#!/usr/bin/env node
// Entry point for the `president` command. Node 24 runs the TypeScript sources directly
// (type stripping), so the CLI works from a checkout without a build step.
const major = Number(process.versions.node.split(".")[0]);
if (major < 24) {
  console.error(`president needs Node 24 or newer (you have ${process.versions.node}).`);
  process.exit(1);
}
const { run } = await import("../src/cli/main.ts");
process.exitCode = await run(process.argv.slice(2));
