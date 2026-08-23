const sensitiveKey = /(api[_-]?key|authorization|cookie|passphrase|password|secret|token)/i;

export function redactSensitiveData(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[redacted-depth]";
  if (typeof value === "string") return value.length > 12_000 ? `${value.slice(0, 12_000)}\n[truncated]` : value;
  if (Array.isArray(value)) return value.slice(0, 500).map((item) => redactSensitiveData(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).slice(0, 500).map(([key, nested]) => [key, sensitiveKey.test(key) ? "[redacted]" : redactSensitiveData(nested, depth + 1)]));
}
