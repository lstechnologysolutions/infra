import { describe, expect, it, vi } from "vitest";
import {
  REDACTED,
  isSensitiveKey,
  redactObject,
  redactString,
} from "./redact.js";
import { Logger, LogLevel, createLogger, logger } from "./logger.js";

// ── isSensitiveKey ────────────────────────────────────────────────────────────

describe("isSensitiveKey", () => {
  it.each([
    "secret",
    "password",
    "passwd",
    "token",
    "apiKey",
    "api_key",
    "accessKey",
    "access_key",
    "secretKey",
    "secret_key",
    "privateKey",
    "private_key",
    "clientId",
    "client_id",
    "clientSecret",
    "client_secret",
    "databaseUrl",
    "database_url",
    "db_url",
    "dbUrl",
    "connectionString",
    "connection_string",
    "serviceRoleKey",
    "service_role_key",
    "authorization",
    "credential",
    "credentials",
    "jwt",
    "bearer",
    "neo4j_uri",
    "neo4j_password",
    "oidc_secret",
    "oidc_client_secret",
    "anonKey",
    "anon_key",
    // Case-insensitive variants
    "PASSWORD",
    "ApiKey",
    "DATABASE_URL",
    // Compound names containing sensitive words — caught via substring match
    "myPasswordField",
    "secretAccessKey",
    "secret_access_key",
    "authToken",
    "auth_token",
  ])("treats %s as sensitive", (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  it.each([
    "stage",
    "region",
    "domain",
    "repo",
    "branch",
    "profile",
    "appName",
    "infraPath",
    "account",
    "zoneName",
    "zoneId",
    "certArn",
  ])("treats %s as non-sensitive", (key) => {
    expect(isSensitiveKey(key)).toBe(false);
  });
});

// ── redactString ─────────────────────────────────────────────────────────────

describe("redactString", () => {
  it("redacts password in http URLs, preserving scheme and username", () => {
    expect(redactString("http://user:hunter2@example.com/path")).toBe(
      `http://user:${REDACTED}@example.com/path`,
    );
  });

  it("redacts password in https URLs, preserving scheme and username", () => {
    expect(redactString("https://neo4j:s3cr3t@neo4j.internal/db")).toBe(
      `https://neo4j:${REDACTED}@neo4j.internal/db`,
    );
  });

  it("preserves non-credentialed https URLs", () => {
    const url = "https://example.com/path";
    expect(redactString(url)).toBe(url);
  });

  it("redacts password in a URL embedded in a longer message", () => {
    const input =
      "Connecting to https://root:password123@db.internal:5432/app now";
    expect(redactString(input)).toBe(
      `Connecting to https://root:${REDACTED}@db.internal:5432/app now`,
    );
  });

  it("redacts URL query parameters with sensitive key names", () => {
    expect(
      redactString("https://api.example.com/endpoint?token=secret123&page=1"),
    ).toBe(`https://api.example.com/endpoint?token=${REDACTED}&page=1`);
  });

  it("redacts inline key=value assignments in text", () => {
    expect(redactString("databaseUrl: postgres://host/db")).toBe(
      `databaseUrl: ${REDACTED}`,
    );
  });

  it("redacts inline key=value with = separator", () => {
    expect(redactString("password=hunter2 stage=production")).toBe(
      `password=${REDACTED} stage=production`,
    );
  });

  it("redacts JWT tokens", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    expect(redactString(`Bearer ${jwt}`)).toBe(`Bearer ${REDACTED}`);
  });

  it("redacts AWS long-term access key IDs", () => {
    expect(redactString("key=AKIAIOSFODNN7EXAMPLE")).toBe(
      `key=${REDACTED}`,
    );
  });

  it("redacts AWS Secrets Manager ARNs", () => {
    const arn =
      "arn:aws:secretsmanager:us-east-1:123456789012:secret:MySecret-AbCdEf";
    expect(redactString(`Loading secret from ${arn}`)).toBe(
      `Loading secret from ${REDACTED}`,
    );
  });

  it("does not alter plain text with no secrets", () => {
    const plain = "Deploying stage production to us-east-1";
    expect(redactString(plain)).toBe(plain);
  });

  it("handles an empty string", () => {
    expect(redactString("")).toBe("");
  });

  it("redacts multiple patterns in a single string", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.abc123";
    const arn = "arn:aws:secretsmanager:us-east-1:123:secret:MyDb";
    const input = `token=${jwt} arn=${arn}`;
    expect(redactString(input)).toBe(
      `token=${REDACTED} arn=${REDACTED}`,
    );
  });
});

// ── redactObject ─────────────────────────────────────────────────────────────

describe("redactObject", () => {
  it("redacts values for sensitive keys", () => {
    const result = redactObject({
      stage: "production",
      databaseUrl: "postgres://admin:secret@host/db",
    });
    expect(result).toEqual({
      stage: "production",
      databaseUrl: REDACTED,
    });
  });

  it("redacts multiple sensitive keys at once", () => {
    const result = redactObject({
      apiKey: "key-12345",
      clientSecret: "shh",
      password: "hunter2",
      region: "us-east-1",
    });
    expect(result).toEqual({
      apiKey: REDACTED,
      clientSecret: REDACTED,
      password: REDACTED,
      region: "us-east-1",
    });
  });

  it("applies redactString to non-sensitive string values", () => {
    const arn = "arn:aws:secretsmanager:us-east-1:123:secret:DbPass";
    const result = redactObject({ message: `Loaded from ${arn}` });
    expect((result as { message: string }).message).toBe(
      `Loaded from ${REDACTED}`,
    );
  });

  it("deep-redacts nested objects", () => {
    const result = redactObject({
      db: {
        host: "localhost",
        password: "s3cr3t",
      },
    });
    expect(result).toEqual({
      db: {
        host: "localhost",
        password: REDACTED,
      },
    });
  });

  it("deep-redacts objects inside arrays", () => {
    const result = redactObject({
      connections: [
        { name: "primary", token: "tok_abc" },
        { name: "replica", token: "tok_xyz" },
      ],
    });
    expect(result).toEqual({
      connections: [
        { name: "primary", token: REDACTED },
        { name: "replica", token: REDACTED },
      ],
    });
  });

  it("preserves non-sensitive primitive values", () => {
    const input = { stage: "dev", count: 3, enabled: true, nothing: null };
    expect(redactObject(input)).toEqual(input);
  });

  it("returns primitives unchanged", () => {
    expect(redactObject(42 as unknown as object)).toBe(42);
    expect(redactObject(null as unknown as object)).toBe(null);
  });

  it("handles empty objects", () => {
    expect(redactObject({})).toEqual({});
  });

  it("handles empty arrays", () => {
    expect(redactObject([])).toEqual([]);
  });

  it("replaces circular references with [Circular]", () => {
    const obj: Record<string, unknown> = { stage: "dev" };
    obj["self"] = obj;
    const result = redactObject(obj) as Record<string, unknown>;
    expect(result["stage"]).toBe("dev");
    expect(result["self"]).toBe("[Circular]");
  });
});

// ── Logger class ─────────────────────────────────────────────────────────────

describe("Logger class", () => {
  it("new Logger() redacts sensitive keys in context", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const log = new Logger({ level: "info", timestamps: false });
    log.info("msg", { token: "abc", stage: "prod" });
    expect(spy).toHaveBeenCalledWith(
      `[INFO] msg {"token":"${REDACTED}","stage":"prod"}`,
    );
    spy.mockRestore();
  });

  it("new Logger() redacts sensitive inline text in the message", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const log = new Logger({ level: "info", timestamps: false });
    log.info("https://neo4j:s3cr3t@neo4j.internal/db");
    expect(spy).toHaveBeenCalledWith(
      `[INFO] https://neo4j:${REDACTED}@neo4j.internal/db`,
    );
    spy.mockRestore();
  });

  it("includes a timestamp prefix when timestamps: true", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const log = new Logger({ level: "info", timestamps: true });
    log.info("hello");
    const call = spy.mock.calls[0][0] as string;
    // ISO 8601 prefix followed by [INFO]
    expect(call).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z \[INFO\]/);
    spy.mockRestore();
  });

  it("does not include a timestamp when timestamps: false", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const log = new Logger({ level: "info", timestamps: false });
    log.info("hello");
    const call = spy.mock.calls[0][0] as string;
    expect(call).toBe("[INFO] hello");
    spy.mockRestore();
  });

  it("suppresses messages below the configured level", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const log = new Logger({ level: "warn", timestamps: false });
    log.debug("hidden");
    log.info("also hidden");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("LogLevel enum values are numeric and ordered correctly", () => {
    expect(LogLevel.DEBUG).toBeLessThan(LogLevel.INFO);
    expect(LogLevel.INFO).toBeLessThan(LogLevel.WARN);
    expect(LogLevel.WARN).toBeLessThan(LogLevel.ERROR);
  });

  describe("child()", () => {
    it("inherits parent context", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const parent = new Logger(
        { level: "info", timestamps: false },
        { service: "api" },
      );
      const child = parent.child({ handler: "auth" });
      child.info("login");
      expect(spy).toHaveBeenCalledWith(
        '[INFO] login {"service":"api","handler":"auth"}',
      );
      spy.mockRestore();
    });

    it("child context overrides parent context for same key", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const parent = new Logger(
        { level: "info", timestamps: false },
        { stage: "dev" },
      );
      const child = parent.child({ stage: "prod" });
      child.info("deploy");
      expect(spy).toHaveBeenCalledWith('[INFO] deploy {"stage":"prod"}');
      spy.mockRestore();
    });

    it("child redacts sensitive keys in merged context", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const parent = new Logger(
        { level: "info", timestamps: false },
        { service: "db" },
      );
      const child = parent.child({ password: "s3cr3t" });
      child.info("connecting");
      expect(spy).toHaveBeenCalledWith(
        `[INFO] connecting {"service":"db","password":"${REDACTED}"}`,
      );
      spy.mockRestore();
    });
  });
});

// ── createLogger factory ──────────────────────────────────────────────────────

describe("createLogger", () => {
  it("returns a Logger instance with redaction on by default", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const log = createLogger();
    log.info("msg", { token: "abc" });
    expect(spy).toHaveBeenCalledWith(`[INFO] msg {"token":"${REDACTED}"}`);
    spy.mockRestore();
  });

  it("respects redact: false to skip sanitisation", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const log = createLogger({ redact: false });
    log.info("msg", { token: "raw_value" });
    expect(spy).toHaveBeenCalledWith('[INFO] msg {"token":"raw_value"}');
    spy.mockRestore();
  });

  it("default logger export also redacts", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.info("deploy", { apiKey: "key-123" });
    expect(spy).toHaveBeenCalledWith(`[INFO] deploy {"apiKey":"${REDACTED}"}`);
    spy.mockRestore();
  });
});

