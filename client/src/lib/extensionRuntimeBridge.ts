import {
  createRuntimeEnvelope,
  isRuntimeHelloPayload,
  isRuntimeRequestPayload,
  isRuntimeResponsePayload,
  parseRuntimeMessage,
  type RuntimeEnvelope,
  type RuntimeHelloPayload,
  type RuntimeRequestPayload,
} from "@shared/extensionRuntimeProtocol";

export type RuntimeBridgeTransport = {
  postMessage(message: RuntimeEnvelope, targetOrigin?: string): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
};
export type RuntimeMethod = (args: unknown, signal: AbortSignal) => unknown | Promise<unknown>;
export type RuntimeMethodPolicy = { permission?: string; capability?: string };
export type RuntimeBridgeOptions = {
  appId: string;
  expectedOrigin: string;
  transport: RuntimeBridgeTransport;
  source?: unknown;
  postTargetOrigin?: string;
  timeoutMs?: number;
  permissions?: Iterable<string>;
  capabilities?: Iterable<string>;
  onEvent?: (name: string, data: unknown) => void;
  onAudit?: (event: { operation: string; outcome: "denied" | "failed"; detail: string }) => void;
};
export type RuntimeFrameOptions = Omit<RuntimeBridgeOptions, "transport" | "source"> & { document?: Document; container: HTMLElement; url: string };

export class RuntimeBridgeError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = "RuntimeBridgeError"; this.code = code; }
}

type PendingRequest = { resolve: (value: unknown) => void; reject: (reason: unknown) => void; timer: ReturnType<typeof setTimeout>; controller: AbortController };

type RegisteredMethod = { handler: RuntimeMethod; policy?: RuntimeMethodPolicy };

export class ExtensionRuntimeBridge {
  private readonly options: RuntimeBridgeOptions;
  private readonly permissions: ReadonlySet<string>;
  private readonly capabilities: ReadonlySet<string>;
  private readonly methods = new Map<string, RegisteredMethod>();
  private readonly pending = new Map<string, PendingRequest>();
  private readonly listener: (event: MessageEvent) => void;
  private disposed = false;
  private handshake?: Promise<void>;
  private handshakeResolve?: () => void;
  private handshakeReject?: (error: unknown) => void;

  constructor(options: RuntimeBridgeOptions) {
    if (!options.appId || !options.expectedOrigin) throw new RuntimeBridgeError("BRIDGE_CONFIG_INVALID", "App ID and expected origin are required.");
    if (!options.transport) throw new RuntimeBridgeError("BRIDGE_CONFIG_INVALID", "A runtime transport is required.");
    this.options = options;
    this.permissions = new Set(options.permissions ?? []);
    this.capabilities = new Set(options.capabilities ?? []);
    this.listener = (event) => { void this.receive(event); };
    options.transport.addEventListener("message", this.listener);
  }

  registerMethod(name: string, handler: RuntimeMethod, policy?: RuntimeMethodPolicy) {
    if (!/^[A-Za-z][A-Za-z0-9._-]{0,119}$/.test(name)) throw new RuntimeBridgeError("METHOD_INVALID", "Runtime method name is invalid.");
    if (this.methods.has(name)) throw new RuntimeBridgeError("METHOD_DUPLICATE", `Runtime method already registered: ${name}`);
    this.methods.set(name, { handler, policy });
    return () => this.methods.delete(name);
  }

  start() {
    if (this.disposed) return Promise.reject(new RuntimeBridgeError("BRIDGE_DISPOSED", "Runtime bridge is disposed."));
    if (this.handshake) return this.handshake;
    this.handshake = new Promise<void>((resolve, reject) => { this.handshakeResolve = resolve; this.handshakeReject = reject; });
    this.send("hello", { role: "host", origin: this.options.expectedOrigin, permissions: Array.from(this.permissions), capabilities: Array.from(this.capabilities) });
    const timer = setTimeout(() => this.handshakeReject?.(new RuntimeBridgeError("HANDSHAKE_TIMEOUT", "Extension runtime handshake timed out.")), this.options.timeoutMs ?? 10_000);
    this.handshake.finally(() => clearTimeout(timer)).catch(() => undefined);
    return this.handshake;
  }

  async request(method: string, args?: unknown) {
    await this.start();
    if (this.disposed) throw new RuntimeBridgeError("BRIDGE_DISPOSED", "Runtime bridge is disposed.");
    const id = crypto.randomUUID();
    const payload: RuntimeRequestPayload = { method, ...(args === undefined ? {} : { args }) };
    const envelope = createRuntimeEnvelope("request", this.options.appId, payload, id);
    return new Promise<unknown>((resolve, reject) => {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        this.pending.delete(id);
        controller.abort(new RuntimeBridgeError("REQUEST_TIMEOUT", `Runtime request timed out: ${method}`));
        reject(new RuntimeBridgeError("REQUEST_TIMEOUT", `Runtime request timed out: ${method}`));
      }, this.options.timeoutMs ?? 10_000);
      this.pending.set(id, { resolve, reject, timer, controller });
      this.options.transport.postMessage(envelope, this.options.postTargetOrigin ?? (this.options.expectedOrigin === "null" ? "*" : this.options.expectedOrigin));
    });
  }

  dispose(reason = "Host disposed the extension runtime.") {
    if (this.disposed) return;
    this.disposed = true;
    if (this.handshakeReject) this.handshakeReject(new RuntimeBridgeError("BRIDGE_DISPOSED", reason));
    if (!this.handshake) this.handshake = Promise.reject(new RuntimeBridgeError("BRIDGE_DISPOSED", reason));
    this.options.transport.postMessage(createRuntimeEnvelope("shutdown", this.options.appId, { reason }, crypto.randomUUID()), this.options.postTargetOrigin ?? (this.options.expectedOrigin === "null" ? "*" : this.options.expectedOrigin));
    for (const [id, pending] of Array.from(this.pending.entries())) { clearTimeout(pending.timer); pending.controller.abort(new RuntimeBridgeError("BRIDGE_DISPOSED", reason)); pending.reject(new RuntimeBridgeError("BRIDGE_DISPOSED", reason)); this.pending.delete(id); }
    this.options.transport.removeEventListener("message", this.listener);
  }

  private send(type: RuntimeEnvelope["type"], payload: unknown) {
    this.options.transport.postMessage(createRuntimeEnvelope(type, this.options.appId, payload, crypto.randomUUID()), this.options.postTargetOrigin ?? (this.options.expectedOrigin === "null" ? "*" : this.options.expectedOrigin));
  }

  private isTrusted(event: MessageEvent) {
    const sourceMatches = this.options.source === undefined || event.source === this.options.source;
    return sourceMatches && event.origin === this.options.expectedOrigin;
  }

  private async receive(event: MessageEvent) {
    if (this.disposed || !this.isTrusted(event)) return;
    const message = parseRuntimeMessage(event.data);
    if (!message || message.appId !== this.options.appId) return;
    if (message.type === "hello") return this.receiveHello(message);
    if (message.type === "hello-ack") {
      if (!isRuntimeHelloPayload(message.payload) || message.payload.role !== "host") return;
      this.handshakeResolve?.(); this.handshakeResolve = undefined; this.handshakeReject = undefined; return;
    }
    if (message.type === "response") return this.receiveResponse(message);
    if (message.type === "request") return this.receiveRequest(message);
    if (message.type === "event") {
      const payload = message.payload as { name?: unknown; data?: unknown };
      if (typeof payload.name === "string") this.options.onEvent?.(payload.name, payload.data);
    }
  }

  private receiveHello(message: RuntimeEnvelope) {
    if (!isRuntimeHelloPayload(message.payload) || message.payload.role !== "extension") return;
    this.send("hello-ack", { role: "host", origin: this.options.expectedOrigin, permissions: Array.from(this.permissions), capabilities: Array.from(this.capabilities) });
    this.handshakeResolve?.(); this.handshakeResolve = undefined; this.handshakeReject = undefined;
  }

  private receiveResponse(message: RuntimeEnvelope) {
    if (!isRuntimeResponsePayload(message.payload)) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id); clearTimeout(pending.timer);
    if (message.payload.status === "ok") pending.resolve(message.payload.result);
    else pending.reject(new RuntimeBridgeError(message.payload.error?.code ?? "REMOTE_ERROR", message.payload.error?.message ?? "Extension request failed."));
  }

  private async receiveRequest(message: RuntimeEnvelope) {
    if (!isRuntimeRequestPayload(message.payload)) return;
    const registered = this.methods.get(message.payload.method);
    if (!registered) return this.respond(message, "error", undefined, { code: "METHOD_NOT_ALLOWED", message: "Runtime method is not available." });
    const { policy } = registered;
    if ((policy?.permission && !this.permissions.has(policy.permission)) || (policy?.capability && !this.capabilities.has(policy.capability))) {
      const detail = `Runtime method denied: ${message.payload.method}`;
      this.options.onAudit?.({ operation: message.payload.method, outcome: "denied", detail });
      return this.respond(message, "error", undefined, { code: "PERMISSION_DENIED", message: detail });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new RuntimeBridgeError("REQUEST_TIMEOUT", "Host method timed out.")), this.options.timeoutMs ?? 10_000);
    try {
      const value = await registered.handler(message.payload.args, controller.signal);
      await this.respond(message, "ok", value);
    } catch (error) {
      const code = controller.signal.aborted ? "REQUEST_TIMEOUT" : "HOST_METHOD_FAILED";
      const detail = error instanceof Error ? error.message : "Host method failed.";
      this.options.onAudit?.({ operation: message.payload.method, outcome: "failed", detail });
      await this.respond(message, "error", undefined, { code, message: detail });
    } finally { clearTimeout(timer); }
  }

  private respond(message: RuntimeEnvelope, status: "ok" | "error", result?: unknown, error?: { code: string; message: string }) {
    return Promise.resolve(this.options.transport.postMessage(createRuntimeEnvelope("response", this.options.appId, { status, ...(result === undefined ? {} : { result }), ...(error ? { error } : {}) }, message.id), this.options.postTargetOrigin ?? (this.options.expectedOrigin === "null" ? "*" : this.options.expectedOrigin)));
  }
}

export function loadSandboxedExtension(options: RuntimeFrameOptions) {
  const documentRef = options.document ?? document;
  const frame = documentRef.createElement("iframe");
  frame.src = options.url;
  frame.title = `${options.appId} extension`;
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.setAttribute("aria-hidden", "true");
  frame.style.display = "none";
  options.container.appendChild(frame);
  if (!frame.contentWindow) throw new RuntimeBridgeError("FRAME_UNAVAILABLE", "Extension frame did not create a content window.");
  const bridge = new ExtensionRuntimeBridge({ ...options, transport: frame.contentWindow, source: frame.contentWindow });
  const dispose = () => { bridge.dispose("Extension frame unloaded."); frame.remove(); };
  return { frame, bridge, dispose };
}


export type ExtensionRuntimeClientOptions = {
  appId: string;
  expectedOrigin: string;
  transport: RuntimeBridgeTransport;
  source?: unknown;
  postTargetOrigin?: string;
  timeoutMs?: number;
  onShutdown?: (reason: string | undefined) => void;
};

export class ExtensionRuntimeClient {
  private readonly options: ExtensionRuntimeClientOptions;
  private readonly methods = new Map<string, RegisteredMethod>();
  private readonly pending = new Map<string, PendingRequest>();
  private readonly listener: (event: MessageEvent) => void;
  private handshake?: Promise<void>;
  private handshakeResolve?: () => void;
  private handshakeReject?: (error: unknown) => void;
  private disposed = false;

  constructor(options: ExtensionRuntimeClientOptions) {
    if (!options.appId || !options.expectedOrigin || !options.transport) throw new RuntimeBridgeError("CLIENT_CONFIG_INVALID", "Extension client requires app ID, expected origin, and transport.");
    this.options = options;
    this.listener = (event) => { void this.receive(event); };
    options.transport.addEventListener("message", this.listener);
  }

  registerMethod(name: string, handler: RuntimeMethod) {
    if (!/^[A-Za-z][A-Za-z0-9._-]{0,119}$/.test(name)) throw new RuntimeBridgeError("METHOD_INVALID", "Runtime method name is invalid.");
    if (this.methods.has(name)) throw new RuntimeBridgeError("METHOD_DUPLICATE", `Runtime method already registered: ${name}`);
    this.methods.set(name, { handler });
    return () => this.methods.delete(name);
  }

  connect() {
    if (this.disposed) return Promise.reject(new RuntimeBridgeError("CLIENT_DISPOSED", "Extension runtime client is disposed."));
    if (this.handshake) return this.handshake;
    this.handshake = new Promise<void>((resolve, reject) => { this.handshakeResolve = resolve; this.handshakeReject = reject; });
    this.send("hello", { role: "extension", origin: this.options.expectedOrigin, permissions: [], capabilities: [] });
    const timer = setTimeout(() => this.handshakeReject?.(new RuntimeBridgeError("HANDSHAKE_TIMEOUT", "Host runtime handshake timed out.")), this.options.timeoutMs ?? 10_000);
    this.handshake.finally(() => clearTimeout(timer)).catch(() => undefined);
    return this.handshake;
  }

  async requestHost(method: string, args?: unknown) {
    await this.connect();
    if (this.disposed) throw new RuntimeBridgeError("CLIENT_DISPOSED", "Extension runtime client is disposed.");
    const id = crypto.randomUUID();
    const envelope = createRuntimeEnvelope("request", this.options.appId, { method, ...(args === undefined ? {} : { args }) }, id);
    return new Promise<unknown>((resolve, reject) => {
      const controller = new AbortController();
      const timer = setTimeout(() => { this.pending.delete(id); controller.abort(); reject(new RuntimeBridgeError("REQUEST_TIMEOUT", `Host request timed out: ${method}`)); }, this.options.timeoutMs ?? 10_000);
      this.pending.set(id, { resolve, reject, timer, controller });
      this.post(envelope);
    });
  }

  dispose(reason = "Extension runtime client disposed.") {
    if (this.disposed) return;
    this.disposed = true;
    if (this.handshakeReject) this.handshakeReject(new RuntimeBridgeError("CLIENT_DISPOSED", reason));
    this.post(createRuntimeEnvelope("shutdown", this.options.appId, { reason }, crypto.randomUUID()));
    for (const [id, pending] of Array.from(this.pending.entries())) { clearTimeout(pending.timer); pending.reject(new RuntimeBridgeError("CLIENT_DISPOSED", reason)); this.pending.delete(id); }
    this.options.transport.removeEventListener("message", this.listener);
  }

  private post(message: RuntimeEnvelope) { this.options.transport.postMessage(message, this.options.postTargetOrigin ?? (this.options.expectedOrigin === "null" ? "*" : this.options.expectedOrigin)); }
  private send(type: RuntimeEnvelope["type"], payload: unknown) { this.post(createRuntimeEnvelope(type, this.options.appId, payload, crypto.randomUUID())); }
  private trusted(event: MessageEvent) { return (this.options.source === undefined || event.source === this.options.source) && event.origin === this.options.expectedOrigin; }

  private async receive(event: MessageEvent) {
    if (this.disposed || !this.trusted(event)) return;
    const message = parseRuntimeMessage(event.data);
    if (!message || message.appId !== this.options.appId) return;
    if (message.type === "hello-ack") {
      if (isRuntimeHelloPayload(message.payload) && message.payload.role === "host") { this.handshakeResolve?.(); this.handshakeResolve = undefined; this.handshakeReject = undefined; }
      return;
    }
    if (message.type === "response") { this.receiveResponse(message); return; }
    if (message.type === "request") { await this.receiveRequest(message); return; }
    if (message.type === "shutdown") { const payload = message.payload as { reason?: unknown }; this.options.onShutdown?.(typeof payload.reason === "string" ? payload.reason : undefined); this.dispose("Host requested shutdown."); }
  }

  private receiveResponse(message: RuntimeEnvelope) {
    if (!isRuntimeResponsePayload(message.payload)) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id); clearTimeout(pending.timer);
    if (message.payload.status === "ok") pending.resolve(message.payload.result);
    else pending.reject(new RuntimeBridgeError(message.payload.error?.code ?? "HOST_ERROR", message.payload.error?.message ?? "Host request failed."));
  }

  private async receiveRequest(message: RuntimeEnvelope) {
    if (!isRuntimeRequestPayload(message.payload)) return;
    const registered = this.methods.get(message.payload.method);
    if (!registered) return this.respond(message, "error", undefined, { code: "METHOD_NOT_ALLOWED", message: "Extension method is not available." });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 10_000);
    try { await this.respond(message, "ok", await registered.handler(message.payload.args, controller.signal)); }
    catch (error) { await this.respond(message, "error", undefined, { code: controller.signal.aborted ? "REQUEST_TIMEOUT" : "EXTENSION_METHOD_FAILED", message: error instanceof Error ? error.message : "Extension method failed." }); }
    finally { clearTimeout(timer); }
  }

  private respond(message: RuntimeEnvelope, status: "ok" | "error", result?: unknown, error?: { code: string; message: string }) { return Promise.resolve(this.post(createRuntimeEnvelope("response", this.options.appId, { status, ...(result === undefined ? {} : { result }), ...(error ? { error } : {}) }, message.id))); }
}
