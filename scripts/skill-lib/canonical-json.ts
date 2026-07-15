/**
 * Legacy v1 / JCS-compatible v2 canonical JSON (skill-portable copy).
 * Must stay bit-identical to packages/protocol-core/src/canonical-json.ts.
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
