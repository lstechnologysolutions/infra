/**
 * @lsts_tech/infra — Secret Redaction Utilities
 *
 * Provides default redaction for sensitive values in log output and command
 * results. Applied automatically by the infra logger so every consumer gets
 * the protection without any additional configuration.
 */

export const REDACTED = "[REDACTED]";

// ── Key-name detection ───────────────────────────────────────────────────────

/**
 * Strips non-alphanumeric characters and lowercases a key name so that
 * camelCase, snake_case, PascalCase and SCREAMING_SNAKE_CASE variants all
 * normalise to the same form.
 *
 * @example
 * normalizeKey("databaseUrl")  // "databaseurl"
 * normalizeKey("DATABASE_URL") // "databaseurl"
 */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Key name segments that, when found anywhere inside a normalised key, flag
 * the associated value as sensitive.  Using substring matching rather than
 * whole-word matching means compound names such as `myPasswordField` or
 * `neo4j_password` are caught automatically.
 */
const SENSITIVE_KEY_SEGMENTS = [
  "secret",
  "password",
  "passwd",
  "token",
  "clientsecret",
  "clientid",
  "apikey",
  "accesskey",
  "secretkey",
  "privatekey",
  "databaseurl",
  "dburl",
  "connectionstring",
  "servicerolekey",
  "anonkey",
  "authtoken",
  "authorization",
  "credential",
  "bearer",
  "neo4juri",
  "jwt",
] as const;

/**
 * Returns `true` when a key name indicates its associated value is sensitive.
 * Comparison is case-insensitive and ignores separators (`_`, `-`, `.`).
 *
 * @example
 * isSensitiveKey("databaseUrl")    // true
 * isSensitiveKey("my_Password")    // true  — substring match
 * isSensitiveKey("stage")          // false
 */
export function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return SENSITIVE_KEY_SEGMENTS.some((segment) => normalized.includes(segment));
}

// ── Inline-value patterns ────────────────────────────────────────────────────

// Build the alternation used in the inline key=value pattern from the same
// source of truth as SENSITIVE_KEY_SEGMENTS so they stay in sync.
const _inlineKeyAlt = SENSITIVE_KEY_SEGMENTS.join("|");

/**
 * Ordered list of `[pattern, replacement]` pairs applied by `redactString`.
 *
 * Patterns are applied sequentially, so earlier replacements cannot interfere
 * with later ones (e.g. the JWT pattern runs after the inline key=value
 * pattern, which may have already replaced the JWT value in `token=...`
 * context).
 */
const SENSITIVE_TEXT_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  // 1. Credentialed URLs — preserves scheme and username, redacts password only.
  //    e.g. https://neo4j:s3cr3t@host → https://neo4j:[REDACTED]@host
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^:\s/]+:)([^@\s/]+)@/gi, `$1${REDACTED}@`],

  // 2. URL query parameters with sensitive key names.
  //    e.g. ?token=abc123&page=1 → ?token=[REDACTED]&page=1
  [
    /([?&](?:token|secret|password|client_id|client_secret|api_key|access_key|private_key)=)([^&\s]+)/gi,
    `$1${REDACTED}`,
  ],

  // 3. Inline key=value / key: value assignments in freeform text.
  //    e.g. "databaseUrl: postgres://host/db" → "databaseUrl: [REDACTED]"
  //    The value group excludes & so it does not consume subsequent query params.
  [
    new RegExp(
      "([A-Za-z0-9._-]*(?:" +
        _inlineKeyAlt +
        ")[A-Za-z0-9._-]*\\s*[:=]\\s*)([^\\s,;'\"\\`&]+)",
      "gi",
    ),
    `$1${REDACTED}`,
  ],

  // 4. JSON Web Tokens (eyJ… three-part dot-separated base64url string).
  [/\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g, REDACTED],

  // 5. AWS long-term access key IDs.
  [/\bAKIA[0-9A-Z]{16}\b/g, REDACTED],

  // 6. AWS Secrets Manager ARNs.
  [/arn:aws:secretsmanager:[^\s'"`,]*/g, REDACTED],
];

/**
 * Redacts known sensitive inline patterns from a freeform string.
 *
 * Patterns handled:
 * - Credentialed URLs (`https://user:pass@host`) — password portion only
 * - URL query parameters with sensitive key names (`?token=…`)
 * - Inline key=value assignments in text
 * - JWT tokens
 * - AWS long-term access key IDs (`AKIA…`)
 * - AWS Secrets Manager ARNs
 *
 * @example
 * redactString("connecting to https://neo4j:s3cr3t@db.internal/app")
 * // → "connecting to https://neo4j:[REDACTED]@db.internal/app"
 */
export function redactString(value: string): string {
  return SENSITIVE_TEXT_PATTERNS.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    value,
  );
}

// ── Object sanitisation ──────────────────────────────────────────────────────

function redactObjectInternal<T>(obj: T, seen: WeakSet<object>): T {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }

  if (seen.has(obj as object)) {
    return "[Circular]" as unknown as T;
  }
  seen.add(obj as object);

  if (Array.isArray(obj)) {
    return obj.map((item) => redactObjectInternal(item, seen)) as unknown as T;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (isSensitiveKey(key)) {
      result[key] = REDACTED;
    } else if (value !== null && typeof value === "object") {
      result[key] = redactObjectInternal(value, seen);
    } else if (typeof value === "string") {
      result[key] = redactString(value);
    } else {
      result[key] = value;
    }
  }
  return result as T;
}

/**
 * Deep-clones a plain object (or array) and replaces any value whose key name
 * matches a sensitive pattern with `"[REDACTED]"`. Non-sensitive string values
 * are also passed through `redactString` to catch inline secrets.
 *
 * Circular references are replaced with the string `"[Circular]"`.
 *
 * Primitive values that are not inside an object are returned unchanged — use
 * `redactString` directly for bare strings.
 *
 * @example
 * redactObject({ stage: "prod", databaseUrl: "postgres://admin:secret@host/db" })
 * // → { stage: "prod", databaseUrl: "[REDACTED]" }
 */
export function redactObject<T>(obj: T): T {
  return redactObjectInternal(obj, new WeakSet<object>());
}

