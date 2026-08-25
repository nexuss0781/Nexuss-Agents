import { describe, expect, it } from "vitest";
import { ExtensionRuntimeBridge, ExtensionRuntimeClient, RuntimeBridgeError, type RuntimeBridgeTransport } from "./extensionRuntimeBridge";
import { createRuntimeEnvelope, parseRuntimeMessage } from "@shared/extensionRuntimeProtocol";

class FakeTransport implements RuntimeBridgeTransport {
  peer?: FakeTransport;
  private listeners = new Set<(event: MessageEvent) => void>();
  postMessage(message: ReturnType<typeof createRuntimeEnvelope>) {
    const peer = this.peer;
    if (!peer) return;
    queueMicrotask(() => peer.listeners.forEach((listener) => listener({ data: message, origin: "https://host.test", source: this } as unknown as MessageEvent)));
  }
  addEventListener(_type: "message", listener: (event: MessageEvent) => void) { this.listeners.add(listener); }
  removeEventListener(_type: "message", listener: (event: MessageEvent) => void) { this.listeners.delete(listener); }
  deliver(value: unknown, origin = "https://host.test", source: unknown = this.peer) { this.listeners.forEach((listener) => listener({ data: value, origin, source } as unknown as MessageEvent)); }
}
function pair() { const host = new FakeTransport(); const extension = new FakeTransport(); host.peer = extension; extension.peer = host; return { host, extension }; }

describe("extension runtime bridge", () => {
  it("performs a trusted handshake and correlates host requests with extension responses", async () => {
    const transports = pair();
    const host = new ExtensionRuntimeBridge({ appId: "external.example", expectedOrigin: "https://host.test", transport: transports.host, source: transports.extension, permissions: ["repository.read"], capabilities: ["repository.workspace"] });
    const extension = new ExtensionRuntimeClient({ appId: "external.example", expectedOrigin: "https://host.test", transport: transports.extension, source: transports.host });
    extension.registerMethod("echo", async (args) => args);
    await Promise.all([host.start(), extension.connect()]);
    await expect(host.request("echo", { value: "ok" })).resolves.toEqual({ value: "ok" });
    host.dispose(); extension.dispose();
  });

  it("enforces permission and capability policies for incoming host methods", async () => {
    const transports = pair();
    const host = new ExtensionRuntimeBridge({ appId: "external.example", expectedOrigin: "https://host.test", transport: transports.host, source: transports.extension, permissions: [], capabilities: [] });
    const extension = new ExtensionRuntimeClient({ appId: "external.example", expectedOrigin: "https://host.test", transport: transports.extension, source: transports.host });
    host.registerMethod("readWorkspace", () => "secret", { permission: "repository.read", capability: "repository.workspace" });
    await Promise.all([host.start(), extension.connect()]);
    await expect(extension.requestHost("readWorkspace")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    host.dispose(); extension.dispose();
  });

  it("ignores messages from an unexpected origin or source", async () => {
    const transports = pair();
    const host = new ExtensionRuntimeBridge({ appId: "external.example", expectedOrigin: "https://host.test", transport: transports.host, source: transports.extension, timeoutMs: 15 });
    const handshake = host.start();
    transports.host.deliver(createRuntimeEnvelope("hello", "external.example", { role: "extension", origin: "https://host.test", permissions: [], capabilities: [] }, "bad-origin"), "https://evil.test", transports.extension);
    await expect(handshake).rejects.toMatchObject({ code: "HANDSHAKE_TIMEOUT" });
    host.dispose();
  });

  it("rejects malformed or oversized protocol messages", () => {
    expect(parseRuntimeMessage({ protocol: "wrong", version: 1, type: "request", id: "1", appId: "external.example", payload: {} })).toBeNull();
    expect(() => createRuntimeEnvelope("event", "external.example", { value: "x".repeat(300_000) }, "event-1")).toThrow(/size limit/);
  });

  it("rejects pending requests when the bridge is disposed", async () => {
    const transports = pair();
    const host = new ExtensionRuntimeBridge({ appId: "external.example", expectedOrigin: "https://host.test", transport: transports.host, source: transports.extension, timeoutMs: 100 });
    const extension = new ExtensionRuntimeClient({ appId: "external.example", expectedOrigin: "https://host.test", transport: transports.extension, source: transports.host });
    await Promise.all([host.start(), extension.connect()]);
    const pending = host.request("never");
    host.dispose();
    await expect(pending).rejects.toBeInstanceOf(RuntimeBridgeError);
    extension.dispose();
  });
});
