// The Node version check that every entry point (bin/preside.js, src/server/main.ts) runs
// first. Plain JavaScript, so an older Node still gets this message, not a syntax error.
// 24.9 for the HTTP server's shouldUpgradeCallback (see src/server/server.ts): before it,
// the option is ignored without a word.
const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
if (major < 24 || (major === 24 && minor < 9)) {
  console.error(`president needs Node 24.9 or newer (you have ${process.versions.node}).`);
  process.exit(1);
}
