import { runServer } from "./server.ts";

// `npm start`; `president serve` runs the same function.
process.exit(await runServer());
