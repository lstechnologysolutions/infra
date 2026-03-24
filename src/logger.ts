/**
 * @lsts_tech/infra — Logger
 *
 * A lightweight structured logger with built-in secret redaction.
 * Redaction is enabled by default and applies to both structured context
 * objects and freeform message strings, so sensitive values never reach
 * CI logs or build output.
 *
 * @example
 * ```ts
 * import { logger } from "@lsts_tech/infra/logger";
 *
 * // Structured context — sensitive keys are automatically redacted
 * logger.info("Deploying", { stage: "production", token: "abc123" });
 * // → [INFO] Deploying {"stage":"production","token":"[REDACTED]"}
 *
 * // Freeform message — credentialed URLs and inline secrets are redacted
 * logger.warn("Retrying https://admin:s3cr3t@neo4j.internal/db");
 * // → [WARN] Retrying https://[REDACTED]@neo4j.internal/db
 * ```
 */

import { redactObject, redactString } from "./redact.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LoggerOptions {
  /**
   * Minimum log level to emit. Messages below this level are silenced.
   * Defaults to `"info"`.
   */
  level?: LogLevel;
  /**
   * When `false`, disables secret redaction. Should only be used in
   * trusted local-only contexts where raw values are needed for debugging.
   * Defaults to `true`.
   */
  redact?: boolean;
}

/** Structured logger interface exposed to consumers. */
export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Creates a logger instance with built-in secret redaction.
 *
 * @example
 * ```ts
 * // Custom log level, redaction still on
 * const log = createLogger({ level: "debug" });
 *
 * // Opt-out of redaction for a trusted local debug session
 * const rawLog = createLogger({ redact: false });
 * ```
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  const minLevel = options.level ?? "info";
  const shouldRedact = options.redact !== false;
  const minOrder = LOG_LEVEL_ORDER[minLevel];

  function shouldEmit(level: LogLevel): boolean {
    return LOG_LEVEL_ORDER[level] >= minOrder;
  }

  function sanitizeMessage(message: string): string {
    return shouldRedact ? redactString(message) : message;
  }

  function sanitizeContext(
    context?: Record<string, unknown>,
  ): Record<string, unknown> | undefined {
    if (!context) return undefined;
    return shouldRedact ? redactObject(context) : context;
  }

  function emit(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
  ): void {
    if (!shouldEmit(level)) return;

    const safeMessage = sanitizeMessage(message);
    const safeContext = sanitizeContext(context);
    const prefix = `[${level.toUpperCase()}]`;
    const output = safeContext
      ? `${prefix} ${safeMessage} ${JSON.stringify(safeContext)}`
      : `${prefix} ${safeMessage}`;

    if (level === "error") {
      console.error(output);
    } else if (level === "warn") {
      console.warn(output);
    } else {
      console.log(output);
    }
  }

  return {
    debug: (message, context) => emit("debug", message, context),
    info: (message, context) => emit("info", message, context),
    warn: (message, context) => emit("warn", message, context),
    error: (message, context) => emit("error", message, context),
  };
}

/** Default logger instance. Redaction is enabled by default. */
export const logger: Logger = createLogger();
