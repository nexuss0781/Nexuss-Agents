export type FileSystemAction =
  | "list"
  | "tree"
  | "stat"
  | "exists"
  | "find"
  | "du"
  | "read"
  | "read_many"
  | "tail"
  | "binary_metadata"
  | "grep"
  | "grep_batch"
  | "glob"
  | "create"
  | "write"
  | "append"
  | "patch"
  | "replace"
  | "format"
  | "copy"
  | "move"
  | "rename"
  | "delete"
  | "clean_generated"
  | "symbols"
  | "references"
  | "recent_changes"
  | "diff_file"
  | "diff_workspace"
  | "diff_paths"
  | "preview_patch"
  | "apply_patch"
  | "rollback"
  | "snapshot"
  | "restore_snapshot"
  | "manifest"
  | "export_patch"
  | "import_patch"
  | "verify_workspace";

export type FileSystemRequest = {
  action: FileSystemAction;
  path?: string;
  paths?: string[];
  pattern?: string;
  query?: string;
  queries?: string[];
  regex?: boolean;
  caseSensitive?: boolean;
  include?: string[];
  exclude?: string[];
  maxEntries?: number;
  maxDepth?: number;
  maxBytes?: number;
  maxMatches?: number;
  contextLines?: number;
  startLine?: number;
  endLine?: number;
  lineCount?: number;
  content?: string;
  expectedSha256?: string;
  edits?: Array<{ find: string; replace: string }>;
  formatter?: "prettier" | "biome" | "gofmt" | "rustfmt";
  sourcePath?: string;
  destinationPath?: string;
  confirmed?: boolean;
  recursive?: boolean;
  patterns?: string[];
  language?: "typescript" | "javascript" | "python" | "go" | "rust" | "java" | "generic";
  since?: string;
  until?: string;
  patchText?: string;
  rollbackOperationId?: string;
  unified?: boolean;
  snapshotId?: string;
  manifestId?: string;
  expectedCommit?: string;
};

export type FileSystemErrorCode =
  | "PATH_INVALID"
  | "PATH_OUTSIDE_PROJECT"
  | "PATH_NOT_FOUND"
  | "LIMIT_INVALID"
  | "FILE_NOT_FOUND"
  | "NOT_A_FILE"
  | "NOT_A_DIRECTORY"
  | "BINARY_FILE"
  | "INVALID_ENCODING"
  | "PATTERN_INVALID"
  | "QUERY_INVALID"
  | "FILE_TOO_LARGE"
  | "TARGET_EXISTS"
  | "CHECKSUM_REQUIRED"
  | "CHECKSUM_MISMATCH"
  | "CONTENT_REQUIRED"
  | "EDIT_CONFLICT"
  | "FORMATTER_INVALID"
  | "FORMATTER_FAILED"
  | "SOURCE_NOT_FOUND"
  | "DESTINATION_INVALID"
  | "CONFIRMATION_REQUIRED"
  | "DIRECTORY_NOT_EMPTY"
  | "RECURSIVE_REQUIRED"
  | "DELETE_LIMIT_REQUIRED"
  | "SYMLINK_BLOCKED"
  | "PATTERN_REQUIRED"
  | "GIT_UNAVAILABLE"
  | "PATCH_REQUIRED"
  | "PATCH_INVALID"
  | "PATCH_CONFLICT"
  | "ROLLBACK_NOT_FOUND"
  | "SNAPSHOT_REQUIRED"
  | "SNAPSHOT_NOT_FOUND"
  | "MANIFEST_REQUIRED"
  | "MANIFEST_NOT_FOUND"
  | "WORKSPACE_MISMATCH"
  | "ARCHIVE_FAILED"
  | "OPERATION_FAILED";

export type FileSystemError = {
  ok: false;
  operationId: string;
  code: FileSystemErrorCode;
  message: string;
  retryable: boolean;
};

export type FileEntry = {
  name: string;
  path: string;
  type: "file" | "directory" | "symlink" | "other";
  size?: number;
  modifiedAt?: string;
};

export type TreeEntry = FileEntry & { children?: TreeEntry[] };

export type TextFileData = {
  content: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  truncated: boolean;
};

export type BinaryMetadata = {
  path: string;
  size: number;
  extension: string;
  isBinary: boolean;
  sha256: string;
  sampleBytes: number;
};

export type TextMatch = {
  path: string;
  line: number;
  column: number;
  text: string;
  query?: string;
  contextBefore?: string[];
  contextAfter?: string[];
};

export type SearchData = {
  matches: TextMatch[];
  filesScanned: number;
  skippedFiles: string[];
  truncated: boolean;
};

export type CodeSymbol = {
  name: string;
  kind: "function" | "class" | "interface" | "type" | "variable" | "method" | "struct" | "enum" | "trait" | "unknown";
  path: string;
  line: number;
  text: string;
};

export type CodeNavigationData = {
  symbols?: CodeSymbol[];
  matches?: TextMatch[];
  filesScanned: number;
  truncated: boolean;
};

export type RecentChange = {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed" | "unknown";
  source: "working-tree" | "git";
  modifiedAt?: string;
};

export type DiffData = {
  patch: string;
  files: string[];
  additions: number;
  deletions: number;
  truncated: boolean;
};

export type PatchData = {
  valid: boolean;
  patch: string;
  files: string[];
  additions: number;
  deletions: number;
  applied?: boolean;
  rollbackOperationId?: string;
};

export type RollbackData = {
  rolledBack: boolean;
  restoredPaths: string[];
  operationId: string;
};

export type WorkspaceManifestEntry = {
  path: string;
  size: number;
  sha256: string;
  modifiedAt: string;
};

export type WorkspaceManifest = {
  manifestId: string;
  files: WorkspaceManifestEntry[];
  fileCount: number;
  totalBytes: number;
  truncated: boolean;
};

export type SnapshotData = {
  snapshotId: string;
  manifestId: string;
  archiveBytes: number;
  fileCount: number;
  totalBytes: number;
};

export type PatchExportData = PatchData & {
  exported: boolean;
};

export type WorkspaceVerificationData = {
  verified: boolean;
  manifestId: string;
  missing: string[];
  changed: string[];
  added: string[];
  fileCount: number;
};

export type FileSystemSuccess<T = unknown> = {
  ok: true;
  operationId: string;
  action: FileSystemAction;
  path: string;
  data: T;
  durationMs: number;
};

export type FileSystemResult<T = unknown> = FileSystemSuccess<T> | FileSystemError;
