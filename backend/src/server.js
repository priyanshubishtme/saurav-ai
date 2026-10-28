import { createApp } from "./app.js";
import { authService } from "./auth.js";
import { connectDatabase, disconnectDatabase } from "./database.js";
import { getScannerDiagnostics } from "./scanner.js";
import { pathToFileURL } from "node:url";

export function createApiServer({
  port = Number(process.env.PORT ?? 3001),
  app = createApp(),
  onListening = (address) => console.info(`AccessZ API listening on http://0.0.0.0:${address.port}`),
} = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("PORT must be an integer between 0 and 65535.");
  }
  const server = app.listen(port, "0.0.0.0", () => onListening(server.address()));
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const scannerDiagnostic = await getScannerDiagnostics();
  if (scannerDiagnostic.status === "available") {
    console.info("Playwright startup check: Chromium executable is available.");
  } else {
    console.error(`Playwright startup check failed: ${scannerDiagnostic.message}`);
    throw new Error(`Backend startup blocked: ${scannerDiagnostic.message}`);
  }

  const database = await connectDatabase();
  if (!database.connected) {
    console.warn(`AccessZ persistence status: ${database.status}. Authentication and protected API routes remain unavailable until MongoDB is configured.`);
  }
  const server = createApiServer();

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      server.close(async () => {
        await authService.close();
        await disconnectDatabase();
        process.exit(0);
      });
    });
  }
}
