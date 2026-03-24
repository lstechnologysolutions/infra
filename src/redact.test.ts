import { describe, expect, it } from "vitest";
import {
  REDACTED,
  isSensitiveKey,
  redactObject,
  redactString,
} from "./redact.js";

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
    // Case-insensitive variants
    "PASSWORD",
    "ApiKey",
    "DATABASE_URL",
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
  it("redacts credentials in http URLs", () => {
    expect(redactString("http://user:hunter2@example.com/path")).toBe(
      `http://${REDACTED}@example.com/path`,
    );
  });

  it("redacts credentials in https URLs", () => {
    expect(redactString("https://admin:s3cr3t@neo4j.internal/db")).toBe(
      `https://${REDACTED}@neo4j.internal/db`,
    );
  });

  it("preserves non-credentialed https URLs", () => {
    const url = "https://example.com/path";
    expect(redactString(url)).toBe(url);
  });

  it("redacts credentials embedded in a longer message", () => {
    const input =
      "Connecting to https://root:password123@db.internal:5432/app now";
    expect(redactString(input)).toBe(
      `Connecting to https://${REDACTED}@db.internal:5432/app now`,
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
});
