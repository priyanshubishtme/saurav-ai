process.env.PLAYWRIGHT_BROWSERS_PATH = "0";

const { startApiServer } = await import("../src/server.js");
await startApiServer();
