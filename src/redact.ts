/**
 * @lsts_tech/infra — Secret Redaction Utilities
 *
 * Provides default redaction for sensitive values in log output and command
 * results. Applied automatically by the infra logger so every consumer gets
 * the protection without any additional configuration.
 */

export const REDACTED = "[REDACTED]";

// ── Key-name patterns ────────────────────────────────────────────────────────

/**
 * Individual key name terms that indicate an associated value is sensitive.
 * Each entry is matched case-insensitively as a whole word.
 */
const SENSITIVE_KEY_TERMS = [
  "secret",
  "password",
  "passwd",
  "pass",
  "token",
  "apikey",
  "api_key",
  "accesskey",
  "access_key",
  "secretkey",
  "secret_key",
  "secretaccesskey",
  "secret_access_key",
  "privatekey",
  "private_key",
  "clientid",
  "client_id",
  "clientsecret",
  "client_secret",
  "databaseurl",
  "database_url",
  "db_url",
  "dburl",
  "connectionstring",
  "connection_string",
  "servicerolekey",
  "service_role_key",
  "authtoken",
  "auth_token",
  "authorization",
  "credential",
  "credentials",
  "jwt",
  "bearer",
  "neo4j_uri",
  "neo4j_password",
  "oidc_secret",
  "oidc_client_secret",
] as const;

/**
 * Compiled regex built from `SENSITIVE_KEY_TERMS`.
 * Matched case-insensitively against the full key name string.
 */
const SENSITIVE_KEY_PATTERN = new RegExp(
  `\\b(${SENSITIVE_KEY_TERMS.join("|")})\\b`,
  "i",
);

// ── Inline-value patterns ────────────────────────────────────────────────────

/**
 * URLs that embed credentials in the `user:password@host` form.
 * The credentials portion is replaced; the scheme and host are preserved.
 *
 * @example `https://admin:s3cr3t@db.example.com/path` →
 *          `https://[REDACTED]@db.example.com/path`
 */
const CREDENTIALED_URL_PATTERN = /(?<=\bhttps?:\/\/)[^:\s/?#][^:\s]*:[^@\s]+(?=@)/gi;

/** JSON Web Tokens (`eyJ…` three-part dot-separated base64url string). */
const JWT_PATTERN = /\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g;

/** AWS long-term access key IDs. */
const AWS_ACCESS_KEY_PATTERN = /\bAKIA[0-9A-Z]{16}\b/g;

/**
 * AWS Secrets Manager secret ARNs.
 * These are distinct from other ARNs (e.g., IAM, CodeStar) and should never
 * appear in logs.
 */
const AWS_SECRET_ARN_PATTERN = /arn:aws:secretsmanager:[^\s'"`,]*/g;

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns `true` when a key name indicates its associated value is sensitive.
 *
 * @example
 * isSensitiveKey("databaseUrl")   // true
 * isSensitiveKey("stage")         // false
 */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

/**
 * Redacts known sensitive inline patterns from a freeform string.
 *
 * Patterns handled:
 * - Credentialed URLs (`https://user:pass@host`) — credentials portion only
 * - JWT tokens
 * - AWS long-term access key IDs (`AKIA…`)
 * - AWS Secrets Manager ARNs
 *
 * @example
 * redactString("connecting to https://admin:hunter2@db.internal/app")
 * // → "connecting to https://[REDACTED]@db.internal/app"
 */
export function redactString(value: string): string {
  return value
    .replace(CREDENTIALED_URL_PATTERN, REDACTED)
    .replace(JWT_PATTERN, REDACTED)
    .replace(AWS_ACCESS_KEY_PATTERN, REDACTED)
    .replace(AWS_SECRET_ARN_PATTERN, REDACTED);
}

/**
 * Deep-clones a plain object (or array) and replaces any value whose key name
 * matches a sensitive pattern with `"[REDACTED]"`. Non-sensitive string values
 * are also passed through `redactString` to catch inline secrets.
 *
 * Primitive values that are not inside an object are returned unchanged — use
 * `redactString` directly for bare strings.
 *
 * @example
 * redactObject({ stage: "prod", databaseUrl: "postgres://admin:secret@host/db" })
 * // → { stage: "prod", databaseUrl: "[REDACTED]" }
 */
export function redactObject<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => redactObject(item)) as unknown as T;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (isSensitiveKey(key)) {
      result[key] = REDACTED;
    } else if (value !== null && typeof value === "object") {
      result[key] = redactObject(value);
    } else if (typeof value === "string") {
      result[key] = redactString(value);
    } else {
      result[key] = value;
    }
  }
  return result as T;
}
