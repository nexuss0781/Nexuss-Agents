import { relative, resolve, sep } from "node:path";
import type { FileSystemRequest } from "./types.js";

export type FileSystemPolicyContext = {
  projectId: string;
  workspaceRoot: string;
  allowMutations?: boolean;
  allowDestructive?: boolean;
};

export type PolicyDecision =
  | { allowed: true; paths: string[] }
  | { allowed: false; code: "PATH_INVALID" | "PATH_OUTSIDE_PROJECT" | "CONFIRMATION_REQUIRED" | "OPERATION_FAILED"; message: string };

const MUTATIONS = new Set(["create", "write", "append", "patch", "replace", "format", "copy", "move", "rename", "delete", "clean_generated", "apply_patch", "import_patch", "restore_snapshot"]);
const DESTRUCTIVE = new Set(["delete", "clean_generated", "restore_snapshot", "import_patch", "apply_patch"]);
const CONTENT_ACCESS = new Set(["read", "read_many", "tail", "binary_metadata", "grep", "grep_batch", "glob", "symbols", "references", "diff_file", "diff_workspace", "diff_paths", "preview_patch", "export_patch"]);

function normalizedPath(path: string) {
  if (!path.trim() || path.includes("\0")) throw new Error("invalid");
  if (path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path)) throw new Error("outside");
  return path;
}

function protectedPath(path: string) {
  const value = path.replaceAll("\\", "/").replace(/^\.\//, "");
  const base = value.split("/").at(-1) ?? value;
  return value === ".git" || value.startsWith(".git/") || value === ".env" || value.startsWith(".env.") || base === ".npmrc" || base === ".pypirc" || base === ".netrc" || base === "credentials.json" || base.endsWith(".pem") || base.endsWith(".key") || base.startsWith("id_rsa");
}

export function authorizeFileSystem(context: FileSystemPolicyContext, request: FileSystemRequest): PolicyDecision {
  const candidates = [request.path, ...(request.paths ?? []), request.destinationPath].filter((path): path is string => Boolean(path));
  const root = resolve(context.workspaceRoot);
  try {
    const paths = candidates.map(normalizedPath);
    for (const path of paths) {
      const candidate = resolve(root, path);
      const relativePath = relative(root, candidate);
      if (relativePath === ".." || relativePath.startsWith(`..${sep}`)) return { allowed: false, code: "PATH_OUTSIDE_PROJECT", message: "The operation path must remain inside the project workspace." };
      if (protectedPath(path) && (MUTATIONS.has(request.action) || CONTENT_ACCESS.has(request.action))) return { allowed: false, code: "OPERATION_FAILED", message: "The requested operation targets a protected workspace path." };
    }
    if (MUTATIONS.has(request.action) && context.allowMutations === false) return { allowed: false, code: "OPERATION_FAILED", message: "Filesystem mutations are disabled for this runtime context." };
    if (DESTRUCTIVE.has(request.action) && !context.allowDestructive) return { allowed: false, code: "CONFIRMATION_REQUIRED", message: "This destructive filesystem operation is not authorized for the current runtime context." };
    return { allowed: true, paths };
  } catch (error) {
    return { allowed: false, code: error instanceof Error && error.message === "outside" ? "PATH_OUTSIDE_PROJECT" : "PATH_INVALID", message: "The operation path is invalid." };
  }
}
