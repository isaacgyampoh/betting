import "server-only";

type Level = "debug" | "info" | "warn" | "error";

// Structured JSON logs; Vercel's log viewer indexes these fields.
function log(level: Level, msg: string, fields: Record<string, unknown> = {}) {
  if (level === "debug" && process.env.NODE_ENV === "production") return;
  const entry = { level, msg, time: new Date().toISOString(), ...fields };
  const line = JSON.stringify(entry, (_k, v) =>
    v instanceof Error ? { name: v.name, message: v.message, stack: v.stack } : v,
  );
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => log("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => log("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => log("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => log("error", msg, fields),
};
