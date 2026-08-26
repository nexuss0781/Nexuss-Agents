import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export type FileSystemAuditEvent = {
  operationId: string;
  projectId: string;
  missionId?: string;
  agentId?: string;
  action: string;
  paths: string[];
  result: "completed" | "rejected" | "failed";
  errorCode?: string;
  durationMs: number;
  timestamp: string;
};

export type AuditSink = (event: FileSystemAuditEvent) => Promise<void>;

export function createJsonlAuditSink(filePath: string): AuditSink {
  const target = resolve(filePath);
  return async (event) => {
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await appendFile(target, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600, flag: "a" });
  };
}
