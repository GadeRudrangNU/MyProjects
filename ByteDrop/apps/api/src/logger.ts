import pino, { type Logger } from "pino";

export function createLogger(level: string, pretty = false): Logger {
  return pino({
    level,
    redact: ["req.headers.authorization", "req.headers.cookie", "req.headers['x-api-key']"],
    ...(pretty ? { transport: { target: "pino-pretty", options: { colorize: true } } } : {}),
  });
}
