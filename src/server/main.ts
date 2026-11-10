import { startHub } from "./server.ts";

try {
  const hub = await startHub();
  console.log(`president is running at ${hub.url}`);
  const stop = () => {
    hub.close().finally(() => process.exit(0));
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
} catch (error) {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "EADDRINUSE") {
    console.error("president: the port is already in use. Set PRESIDENT_PORT to use another one.");
  } else {
    console.error(`president: ${(error as Error).message}`);
  }
  process.exit(1);
}
