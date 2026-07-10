/**
 * Versioned canonical JSON serializers.
 *
 * V1 preserves the historical sorted-key algorithm used by audit logs and
 * claim signatures. V2 is RFC 8785-compatible (JCS) for new envelopes.
 */

/**
 * Legacy v1 canonicalization: lexicographically sorted object keys,
 * no insignificant whitespace, arrays preserve order, primitives via
 * JSON.stringify. Must remain bit-identical forever for historical chains.
 */
export function canonicalizeV1(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalizeV1).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + canonicalizeV1(obj[k]))
      .join(",") +
    "}"
  );
}

/**
 * RFC 8785-compatible canonical JSON (JCS).
 * - Object keys sorted by UTF-16 code unit order (JS string sort)
 * - Undefined object members omitted; undefined array elements → null
 * - Numbers via JSON.stringify (ECMAScript NumberToString)
 * - No insignificant whitespace
 */
export function canonicalizeV2(value: unknown): string {
  if (value === undefined) {
    return "null";
  }
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return (
      "[" +
      value
        .map((item) =>
          item === undefined ? "null" : canonicalizeV2(item),
        )
        .join(",") +
      "]"
    );
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + canonicalizeV2(obj[k]))
      .join(",") +
    "}"
  );
}

/** @deprecated Prefer canonicalizeV1 — alias for migration call sites. */
export const canonicalize = canonicalizeV1;
