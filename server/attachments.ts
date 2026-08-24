import { createHash, randomUUID } from "node:crypto";
import type { Express, Request, Response } from "express";
import Busboy from "busboy";
import { getNexussSession } from "./nexussAuth";
import { storagePut } from "./storage";
import { WorkspaceAccessError, withWorkspaceDb } from "./paradoxWorkspace";

export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
export const MAX_ATTACHMENT_NAME_LENGTH = 240;

type AttachmentSourceKind = "raw_prompt" | "plan_text" | "specification";

export type StoredAttachment = {
  id: string;
  ownerId: string;
  projectId?: string;
  name: string;
  mimeType: string;
  size: number;
  contentHash: string;
  storageKey: string;
  storageUrl: string;
  sourceKind: AttachmentSourceKind;
  createdAt: string;
};

type AttachmentRow = {
  id: string;
  owner_id: string;
  project_id: string | null;
  name: string;
  mime_type: string;
  size: number;
  content_hash: string;
  storage_key: string;
  storage_url: string;
  source_kind: AttachmentSourceKind;
  created_at: string;
};

function rows<T>(result: { rows: unknown[] }) { return result.rows as T[]; }
function now() { return new Date().toISOString(); }
function safeName(value: string) {
  const normalized = value.replace(/[\\/\u0000-\u001f]/g, "_").trim();
  return (normalized || "attachment").slice(0, MAX_ATTACHMENT_NAME_LENGTH);
}
function safeMimeType(value: string | undefined) {
  const normalized = (value || "application/octet-stream").trim().slice(0, 120);
  return /^[\w.+-]+\/[\w.+-]+(?:\s*;.*)?$/i.test(normalized) ? normalized : "application/octet-stream";
}
function sourceKind(value: unknown): AttachmentSourceKind {
  return value === "raw_prompt" || value === "plan_text" || value === "specification" ? value : "specification";
}
function readAttachment(row: AttachmentRow): StoredAttachment {
  return {
    id: row.id,
    ownerId: row.owner_id,
    ...(row.project_id ? { projectId: row.project_id } : {}),
    name: row.name,
    mimeType: row.mime_type,
    size: row.size,
    contentHash: row.content_hash,
    storageKey: row.storage_key,
    storageUrl: row.storage_url,
    sourceKind: row.source_kind,
    createdAt: row.created_at,
  };
}

export async function createAttachmentRecord(ownerId: string, input: { projectId?: string | null; name: string; mimeType?: string; data: Buffer; sourceKind?: AttachmentSourceKind }): Promise<StoredAttachment> {
  if (input.data.length > MAX_ATTACHMENT_BYTES) throw new Error("Attachment exceeds the 50 MB upload limit");
  const id = randomUUID();
  const name = safeName(input.name);
  const mimeType = safeMimeType(input.mimeType);
  const contentHash = createHash("sha256").update(input.data).digest("hex");
  const stored = await storagePut(`nexuss/${ownerId}/attachments/${id}`, input.data, mimeType);
  const createdAt = now();
  return withWorkspaceDb(true, (db) => {
    if (input.projectId) {
      const project = rows<{ id: string }>(db.execute("SELECT id FROM workspace_projects WHERE id = ? AND owner_id = ? LIMIT 1", [input.projectId, ownerId]))[0];
      if (!project) throw new WorkspaceAccessError("Project not found");
    }
    db.execute("INSERT INTO workspace_attachments (id, owner_id, project_id, name, mime_type, size, content_hash, storage_key, storage_url, source_kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [id, ownerId, input.projectId || null, name, mimeType, input.data.length, contentHash, stored.key, stored.url, sourceKind(input.sourceKind), createdAt]);
    return readAttachment(rows<AttachmentRow>(db.execute("SELECT id, owner_id, project_id, name, mime_type, size, content_hash, storage_key, storage_url, source_kind, created_at FROM workspace_attachments WHERE id = ? AND owner_id = ?", [id, ownerId]))[0]);
  });
}

export async function getAttachment(ownerId: string, attachmentId: string): Promise<StoredAttachment> {
  return withWorkspaceDb(false, (db) => {
    const row = rows<AttachmentRow>(db.execute("SELECT id, owner_id, project_id, name, mime_type, size, content_hash, storage_key, storage_url, source_kind, created_at FROM workspace_attachments WHERE id = ? AND owner_id = ? LIMIT 1", [attachmentId, ownerId]))[0];
    if (!row) throw new WorkspaceAccessError("Attachment not found");
    return readAttachment(row);
  });
}

export function registerAttachmentUploadRoute(app: Express) {
  app.post("/api/workspace/attachments/upload", async (req: Request, res: Response) => {
    const user = await getNexussSession(req);
    if (!user?.id) { res.status(401).json({ error: "Sign in to upload attachments." }); return; }
    const contentType = req.headers["content-type"];
    if (typeof contentType !== "string" || !/^multipart\/form-data\s*;/i.test(contentType)) { res.status(415).json({ error: "Use multipart form data for attachments." }); return; }

    const fields: Record<string, string> = {};
    let fileName = "attachment";
    let fileMimeType = "application/octet-stream";
    let fileBytes = 0;
    const chunks: Buffer[] = [];
    let fileSeen = false;
    let tooLarge = false;
    let parseError: Error | undefined;

    await new Promise<void>((resolve) => {
      const parser = Busboy({ headers: req.headers, limits: { files: 1, fileSize: MAX_ATTACHMENT_BYTES, fields: 4, parts: 5 } });
      parser.on("field", (name, value) => { fields[name] = value.slice(0, 240); });
      parser.on("file", (_name, file, info) => {
        fileSeen = true;
        fileName = info.filename || "attachment";
        fileMimeType = info.mimeType || "application/octet-stream";
        file.on("data", (chunk: Buffer) => { fileBytes += chunk.length; chunks.push(chunk); });
        file.on("limit", () => { tooLarge = true; });
        file.on("error", (error) => { parseError = error; });
      });
      parser.on("filesLimit", () => { parseError = new Error("Only one attachment can be uploaded per request"); });
      parser.on("partsLimit", () => { parseError = new Error("Attachment form contains too many parts"); });
      parser.on("error", (error) => { parseError = error instanceof Error ? error : new Error("Attachment multipart parsing failed"); resolve(); });
      parser.on("finish", () => resolve());
      req.pipe(parser);
    });

    if (parseError) { res.status(400).json({ error: "Attachment upload could not be read." }); return; }
    if (tooLarge || fileBytes > MAX_ATTACHMENT_BYTES) { res.status(413).json({ error: "Attachment exceeds the 50 MB upload limit." }); return; }
    if (!fileSeen || fileBytes === 0) { res.status(400).json({ error: "Choose a non-empty attachment." }); return; }

    try {
      const attachment = await createAttachmentRecord(user.id, { projectId: fields.projectId || null, sourceKind: sourceKind(fields.sourceKind), name: fileName, mimeType: fileMimeType, data: Buffer.concat(chunks) });
      res.status(201).json({ attachment });
    } catch (error) {
      if (error instanceof WorkspaceAccessError) { res.status(404).json({ error: error.message }); return; }
      console.error("[AttachmentUpload] upload failed", { error: error instanceof Error ? error.message : String(error) });
      res.status(500).json({ error: "Attachment could not be stored." });
    }
  });
}
