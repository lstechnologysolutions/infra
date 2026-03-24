/**
 * @lsts_tech/infra — Logger
 *
 * A structured logger with built-in secret redaction, compatible with the
 * downstream `Logger` class API used in ComputeIntelligenceGraph and similar
 * consumers.  Redaction is enabled by default so every consumer gets the
 * protection without any additional configuration.
 *
 * ## Class API (primary — matches downstream consumer)
 * ```ts
 * import { Logger } from "@lsts_tech/infra/logger";
 *
 * const log = new Logger({ level: "info", timestamps: true });
 * log.info("Deploying", { stage: "prod", token: "abc123" });
 * // → 2024-01-01T00:00:00.000Z [INFO] Deploying {"stage":"prod","token":"[REDACTED]"}
 *
 * // Child loggers inherit and extend parent context
 * const child = log.child({ service: "api" });
 * child.warn("Retrying", { attempt: 2 });
 * ```
 *
 * ## Factory API (convenience — supports `redact: false` opt-out)
 * ```ts
 * import { createLogger, logger } from "@lsts_tech/infra/logger";
 *
 * logger.info("Deploying", { stage: "prod", token: "abc123" });
 * // → [INFO] Deploying {"stage":"prod","token":"[REDACTED]"}
 * ```
 */

import { redactObject, redactString } from "./redact.js";

// ── Log level ─────────────────────────────────────────────────────────────────

/**
 * Numeric log-level enum.  Matches the downstream Logger implementation so
 * consumers can compare levels with `>=` without importing a string union.
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

/** String variant of log level used in configuration objects. */
export type LogLevelString = "debug" | "info" | "warn" | "error";

// ── Configuration interfaces ──────────────────────────────────────────────────

/**
 * Configuration accepted by `new Logger(config, context?)`.
 * Mirrors the `LoggingConfig` interface used in downstream consumers.
 */
export interface LoggingConfig {
  /** Minimum level to emit. Messages below this level are suppressed. */
  level: LogLevelString;
  /** When `true`, each line is prefixed with an ISO 8601 timestamp. */
  timestamps: boolean;
}

/**
 * Options accepted by the `createLogger` factory function.
 * Extends `LoggingConfig` with an opt-out for secret redaction.
 */
export interface LoggerOptions {
  /** Minimum level to emit. Defaults to `"info"`. */
  level?: LogLevelString;
  /**
   * When `false`, disables secret redaction.  Should only be used in
   * trusted local-only contexts where raw values are needed for debugging.
   * Defaults to `true`.
   */
  redact?: boolean;
  /** When `true`, prefixes each line with an ISO 8601 timestamp. Defaults to `false`. */
  timestamps?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseLogLevel(level: LogLevelString): LogLevel {
  switch (level) {
    case "debug":
      return LogLevel.DEBUG;
    case "info":
      return LogLevel.INFO;
    case "warn":
      return LogLevel.WARN;
    case "error":
      return LogLevel.ERROR;
    default:
      return LogLevel.INFO;
  }
}

function getLevelName(level: LogLevel): LogLevelString {
  switch (level) {
    case LogLevel.DEBUG:
      return "debug";
    case LogLevel.INFO:
      return "info";
    case LogLevel.WARN:
      return "warn";
    case LogLevel.ERROR:
      return "error";
    default:
      return "info";
  }
}

// ── Logger class ──────────────────────────────────────────────────────────────

/**
 * Structured logger with built-in secret redaction.
 *
 * Compatible with the downstream `Logger` class API — construct with
 * `new Logger(config, context?)` and use `child(context)` for scoped
 * sub-loggers.
 *
 * @example
 * ```ts
 * const log = new Logger({ level: "info", timestamps: true });
 * log.info("Deploying", { stage: "prod", token: "abc" });
 * // → 2024-… [INFO] Deploying {"stage":"prod","token":"[REDACTED]"}
 *
 * const svc = log.child({ service: "auth" });
 * svc.warn("Token refresh failed", { attempt: 3 });
 * ```
 */
export class Logger {
  private readonly _level: LogLevel;
  private readonly _timestamps: boolean;
  private readonly _context: Record<string, unknown>;
  private readonly _redact: boolean;

  /**
   * @param config   Log level and timestamp settings.
   * @param context  Optional base context merged into every log call.
   * @internal The third parameter `_redact` is reserved for `createLogger`; do not pass it directly.
   */
  constructor(
    config: LoggingConfig,
    context?: Record<string, unknown>,
    /** @internal */ _redact = true,
  ) {
    this._level = parseLogLevel(config.level);
    this._timestamps = config.timestamps ?? false;
    this._context = context ?? {};
    this._redact = _redact;
  }

  /** Emit a debug-level message. */
  debug(message: string, context?: Record<string, unknown>): void {
    this._log(LogLevel.DEBUG, message, context);
  }

  /** Emit an info-level message. */
  info(message: string, context?: Record<string, unknown>): void {
    this._log(LogLevel.INFO, message, context);
  }

  /** Emit a warning-level message. */
  warn(message: string, context?: Record<string, unknown>): void {
    this._log(LogLevel.WARN, message, context);
  }

  /** Emit an error-level message. */
  error(message: string, context?: Record<string, unknown>): void {
    this._log(LogLevel.ERROR, message, context);
  }

  /**
   * Creates a child logger that inherits this instance's level, timestamps,
   * and context, then merges the provided `context` on top.
   *
   * @example
   * ```ts
   * const svc = log.child({ service: "payments" });
   * svc.info("Charge initiated", { amount: 100 });
   * // → [INFO] Charge initiated {"service":"payments","amount":100}
   * ```
   */
  child(context: Record<string, unknown>): Logger {
    return new Logger(
      { level: getLevelName(this._level), timestamps: this._timestamps },
      { ...this._context, ...context },
      this._redact,
    );
  }

  private _log(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
  ): void {
    if (level < this._level) return;

    const safeMessage = this._redact ? redactString(message) : message;
    const mergedContext = { ...this._context, ...context };
    const safeContext =
      Object.keys(mergedContext).length > 0
        ? this._redact
          ? redactObject(mergedContext)
          : mergedContext
        : undefined;

    const parts: string[] = [];
    if (this._timestamps) parts.push(new Date().toISOString());
    parts.push(`[${getLevelName(level).toUpperCase()}]`);
    parts.push(safeMessage);
    if (safeContext) parts.push(JSON.stringify(safeContext));

    const output = parts.join(" ");
    if (level >= LogLevel.ERROR) {
      console.error(output);
    } else if (level >= LogLevel.WARN) {
      console.warn(output);
    } else {
      console.log(output);
    }
  }
}

// ── Factory function ──────────────────────────────────────────────────────────

/**
 * Creates a `Logger` instance.  Accepts a `redact: false` opt-out for
 * trusted debug sessions.  Prefer `new Logger(config)` when constructing
 * loggers that will always redact.
 *
 * @example
 * ```ts
 * // Custom log level, redaction still on
 * const log = createLogger({ level: "debug" });
 *
 * // Opt-out of redaction for a local debug session only
 * const rawLog = createLogger({ redact: false });
 * ```
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  return new Logger(
    {
      level: options.level ?? "info",
      timestamps: options.timestamps ?? false,
    },
    undefined,
    options.redact !== false,
  );
}

/** Default logger instance — info level, redaction on, no timestamps. */
export const logger: Logger = createLogger();

