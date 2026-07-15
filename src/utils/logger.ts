import fs from "node:fs";
import path from "node:path";
import pino from "pino";

let logger: pino.Logger | null = null;

/** Initialize the application logger, writing to logs/ and stdout. */
export function initLogger(logsDir: string): pino.Logger {
  fs.mkdirSync(logsDir, { recursive: true });
  const logFile = path.join(
    logsDir,
    `sync-${new Date().toISOString().slice(0, 10)}.log`
  );
  logger = pino(
    { level: "info" },
    pino.multistream([
      { stream: fs.createWriteStream(logFile, { flags: "a" }) },
      { stream: process.stdout },
    ])
  );
  return logger;
}

/** Get the initialized logger (throws if initLogger was never called). */
export function getLogger(): pino.Logger {
  if (!logger) throw new Error("Logger not initialized");
  return logger;
}
