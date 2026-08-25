export const EXTENSION_RUNTIME_PROTOCOL = "axolotl.extension-runtime" as const;
export const EXTENSION_RUNTIME_VERSION = 1 as const;
export const MAX_RUNTIME_MESSAGE_BYTES = 256 * 1024;
export const MAX_RUNTIME_ID_LENGTH = 120;
export const MAX_RUNTIME_METHOD_LENGTH = 120;

export type RuntimeMessageType = "hello" | "hello-ack" | "request" | "response" | "event" | "shutdown" | "error";
export type RuntimeMessageStatus = "ok" | "error";

export type RuntimeEnvelope = {
  protocol: typeof EXTENSION_RUNTIME_PROTOCOL;
  version: typeof EXTENSION_RUNTIME_VERSION;
  type: RuntimeMessageType;
  id: string;
  appId: string;
  payload: unknown;
};
export type RuntimeHelloPayload = { role: "host" | "extension"; origin: string; permissions: string[]; capabilities: string[] };
export type RuntimeRequestPayload = { method: string; args?: unknown };
export type RuntimeResponsePayload = { status: RuntimeMessageStatus; result?: unknown; error?: { code: string; message: string } };
export type RuntimeEventPayload = { name: string; data?: unknown };
export type RuntimeShutdownPayload = { reason?: string };

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function boundedString(value: unknown, maxLength: number): value is string { return typeof value === "string" && value.length > 0 && value.length <= maxLength; }
function isMessageType(value: unknown): value is RuntimeMessageType { return value === "hello" || value === "hello-ack" || value === "request" || value === "response" || value === "event" || value === "shutdown" || value === "error"; }
function isJsonSafe(value: unknown, depth = 0): boolean {
  if (depth > 12) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 5_000 && value.every((item) => isJsonSafe(item, depth + 1));
  if (isRecord(value)) return Object.keys(value).length <= 5_000 && Object.entries(value).every(([key, child]) => boundedString(key, 200) && isJsonSafe(child, depth + 1));
  return false;
}

export function createRuntimeEnvelope(type: RuntimeMessageType, appId: string, payload: unknown, id: string): RuntimeEnvelope {
  if (!boundedString(appId, 160) || !boundedString(id, MAX_RUNTIME_ID_LENGTH)) throw new Error("Invalid runtime identity.");
  if (!isJsonSafe(payload)) throw new Error("Runtime payload is not JSON-safe or exceeds nesting limits.");
  const envelope: RuntimeEnvelope = { protocol: EXTENSION_RUNTIME_PROTOCOL, version: EXTENSION_RUNTIME_VERSION, type, id, appId, payload };
  if (JSON.stringify(envelope).length > MAX_RUNTIME_MESSAGE_BYTES) throw new Error("Runtime message exceeds the size limit.");
  return envelope;
}

export function parseRuntimeMessage(value: unknown): RuntimeEnvelope | null {
  if (!isRecord(value) || value.protocol !== EXTENSION_RUNTIME_PROTOCOL || value.version !== EXTENSION_RUNTIME_VERSION || !isMessageType(value.type) || !boundedString(value.id, MAX_RUNTIME_ID_LENGTH) || !boundedString(value.appId, 160) || !isJsonSafe(value.payload)) return null;
  try {
    if (JSON.stringify(value).length > MAX_RUNTIME_MESSAGE_BYTES) return null;
  } catch { return null; }
  return value as RuntimeEnvelope;
}

export function isRuntimeRequestPayload(value: unknown): value is RuntimeRequestPayload { return isRecord(value) && boundedString(value.method, MAX_RUNTIME_METHOD_LENGTH) && (value.args === undefined || isJsonSafe(value.args)); }
export function isRuntimeResponsePayload(value: unknown): value is RuntimeResponsePayload { return isRecord(value) && (value.status === "ok" || value.status === "error") && (value.error === undefined || (isRecord(value.error) && boundedString(value.error.code, 80) && boundedString(value.error.message, 1_000))) && (value.result === undefined || isJsonSafe(value.result)); }
export function isRuntimeHelloPayload(value: unknown): value is RuntimeHelloPayload { return isRecord(value) && (value.role === "host" || value.role === "extension") && boundedString(value.origin, 2_000) && Array.isArray(value.permissions) && value.permissions.every((item) => boundedString(item, 120)) && Array.isArray(value.capabilities) && value.capabilities.every((item) => boundedString(item, 120)); }
export function isRuntimeEventPayload(value: unknown): value is RuntimeEventPayload { return isRecord(value) && boundedString(value.name, MAX_RUNTIME_METHOD_LENGTH) && (value.data === undefined || isJsonSafe(value.data)); }
