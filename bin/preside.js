#!/usr/bin/env node
// Entry point for the `preside` command.
// Node 24 runs the TypeScript sources directly (type stripping), so the CLI works from a
// checkout without a build step.
import "./check-node.js";

const { run } = await import("../src/cli/main.ts");
process.exitCode = await run(process.argv.slice(2));
