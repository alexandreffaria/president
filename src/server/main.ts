// `npm start` and `npm run dev`; `president serve` runs the same function. The version check
// comes first: imports run in order, so it exits before the server code loads.
import "../../bin/check-node.js";
import { runServer } from "./server.ts";

process.exit(await runServer());
