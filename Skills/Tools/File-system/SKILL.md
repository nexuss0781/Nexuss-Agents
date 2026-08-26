---
name: nexuss-filesystem
description: Operate on Nexuss-Agent project workspaces through the filesystem runtime. Use for inspecting, reading, searching, creating, editing, reviewing, recovering, and organizing project files.
---

# Nexuss Filesystem

Use the project filesystem as the agent’s working computer. Call the runtime with the current `projectId` and a project-relative request. The runtime selects the active workspace and returns structured evidence.

## Operating rhythm

```text
inspect → understand → change → review → verify → continue
```

Read the current state, make the smallest useful change, review the result, and continue from the returned evidence. Preserve `operationId`, checksums, manifest IDs, snapshot IDs, and rollback IDs when they are returned.

## Request pattern

```ts
{
  action: "read",
  path: "server/routers.ts",
  startLine: 1,
  endLine: 160
}
```

Every request uses `action`. Paths are relative to the selected project. Use `maxEntries`, `maxDepth`, `maxBytes`, `maxMatches`, `contextLines`, and line ranges to keep a large project easy to work with.

Every response is either:

```ts
{ ok: true, operationId, action, path, data, durationMs }
```

or:

```ts
{ ok: false, operationId, code, message, retryable }
```

## Workspace discovery

### `list`

**Arguments:** `path?: string`, `maxEntries?: number`.

**Example:**

```json
{"action":"list","path":"server","maxEntries":100}
```

### `tree`

**Arguments:** `path?: string`, `maxEntries?: number`, `maxDepth?: number`.

**Example:**

```json
{"action":"tree","path":".","maxDepth":3,"maxEntries":300}
```

### `stat`

**Arguments:** `path?: string`.

**Example:**

```json
{"action":"stat","path":"package.json"}
```

### `exists`

**Arguments:** `path?: string`.

**Example:**

```json
{"action":"exists","path":"src/app.tsx"}
```

### `find`

**Arguments:** `path?: string`, `pattern: string`, `maxEntries?: number`.

**Example:**

```json
{"action":"find","path":"src","pattern":"*.tsx","maxEntries":200}
```

### `du`

**Arguments:** `path?: string`, `maxEntries?: number`.

**Example:**

```json
{"action":"du","path":".","maxEntries":5000}
```

## Reading and search

### `read`

**Arguments:** `path?: string`, `startLine?: number`, `endLine?: number`, `maxBytes?: number`.

**Example:**

```json
{"action":"read","path":"server/routers.ts","startLine":1,"endLine":160,"maxBytes":200000}
```

### `read_many`

**Arguments:** `paths: string[]`, `startLine?: number`, `endLine?: number`, `maxBytes?: number`.

**Example:**

```json
{"action":"read_many","paths":["package.json","tsconfig.json","server/routers.ts"],"startLine":1,"endLine":120,"maxBytes":300000}
```

### `tail`

**Arguments:** `path?: string`, `lineCount?: number`, `maxBytes?: number`.

**Example:**

```json
{"action":"tail","path":"logs/agent.log","lineCount":80,"maxBytes":100000}
```

### `binary_metadata`

**Arguments:** `path?: string`, `maxBytes?: number`.

**Example:**

```json
{"action":"binary_metadata","path":"assets/logo.png","maxBytes":5000000}
```

### `grep`

**Arguments:** `path?: string`, `query: string`, `regex?: boolean`, `caseSensitive?: boolean`, `include?: string[]`, `exclude?: string[]`, `maxEntries?: number`, `maxMatches?: number`, `maxBytes?: number`, `contextLines?: number`.

**Example:**

```json
{"action":"grep","path":".","query":"createProject","include":["server/**/*.ts"],"exclude":["node_modules/**","dist/**"],"contextLines":2,"maxEntries":500,"maxMatches":100}
```

### `grep_batch`

**Arguments:** `path?: string`, `queries: string[]`, `regex?: boolean`, `caseSensitive?: boolean`, `include?: string[]`, `exclude?: string[]`, `maxEntries?: number`, `maxMatches?: number`, `maxBytes?: number`, `contextLines?: number`.

**Example:**

```json
{"action":"grep_batch","path":"server","queries":["router(","protectedProcedure","workspaceOwner"],"include":["**/*.ts"],"maxMatches":200,"contextLines":1}
```

### `glob`

**Arguments:** `path?: string`, `pattern: string`, `maxEntries?: number`.

**Example:**

```json
{"action":"glob","path":"client","pattern":"**/*.tsx","maxEntries":300}
```

## Code navigation

### `symbols`

**Arguments:** `path?: string`, `language?: "typescript" | "javascript" | "python" | "go" | "rust" | "java" | "generic"`, `include?: string[]`, `exclude?: string[]`, `maxEntries?: number`, `maxMatches?: number`.

**Example:**

```json
{"action":"symbols","path":"server","language":"typescript","include":["**/*.ts"],"maxEntries":300,"maxMatches":500}
```

### `references`

**Arguments:** `path?: string`, `query: string`, `regex?: boolean`, `caseSensitive?: boolean`, `include?: string[]`, `exclude?: string[]`, `maxEntries?: number`, `maxMatches?: number`, `contextLines?: number`.

**Example:**

```json
{"action":"references","path":"server","query":"projectWorkspacePath","include":["**/*.ts"],"contextLines":2,"maxMatches":100}
```

### `recent_changes`

**Arguments:** `path?: string`, `maxEntries?: number`.

**Example:**

```json
{"action":"recent_changes","path":".","maxEntries":300}
```

## Create and edit files

### `create`

**Arguments:** `path: string`, `content: string`.

**Example:**

```json
{"action":"create","path":"src/constants.ts","content":"export const VERSION = \"1.0.0\";\n"}
```

### `write`

**Arguments:** `path: string`, `content: string`, `expectedSha256: string`.

**Example:**

```json
{"action":"write","path":"src/constants.ts","content":"export const VERSION = \"1.0.1\";\n","expectedSha256":"sha256:HASH_FROM_READ"}
```

### `append`

**Arguments:** `path: string`, `content: string`, `expectedSha256: string`.

**Example:**

```json
{"action":"append","path":"CHANGELOG.md","content":"\n## Next\n","expectedSha256":"sha256:HASH_FROM_READ"}
```

### `patch`

**Arguments:** `path: string`, `edits: Array<{ find: string; replace: string }>`, `expectedSha256: string`.

**Example:**

```json
{"action":"patch","path":"server/config.ts","expectedSha256":"sha256:HASH_FROM_READ","edits":[{"find":"const timeout = 30000;","replace":"const timeout = 60000;"}]}
```

### `replace`

**Arguments:** `path: string`, `startLine: number`, `endLine: number`, `content: string`, `expectedSha256: string`.

**Example:**

```json
{"action":"replace","path":"README.md","startLine":10,"endLine":12,"content":"Updated project description.\n","expectedSha256":"sha256:HASH_FROM_READ"}
```

### `format`

**Arguments:** `path: string`, `formatter: "prettier" | "biome" | "gofmt" | "rustfmt"`, `expectedSha256: string`.

**Example:**

```json
{"action":"format","path":"src/app.tsx","formatter":"prettier","expectedSha256":"sha256:HASH_FROM_READ"}
```

For an existing file, read it first and carry its returned SHA-256 into the next edit. Use a unique `patch` for a focused change and `write` for a deliberate complete replacement.

## Organize files

### `copy`

**Arguments:** `path: string`, `destinationPath: string`.

**Example:**

```json
{"action":"copy","path":"src/template.ts","destinationPath":"src/template.backup.ts"}
```

### `move`

**Arguments:** `path: string`, `destinationPath: string`.

**Example:**

```json
{"action":"move","path":"src/old-name.ts","destinationPath":"src/new-name.ts"}
```

### `rename`

**Arguments:** `path: string`, `destinationPath: string`.

**Example:**

```json
{"action":"rename","path":"docs/draft.md","destinationPath":"docs/guide.md"}
```

### `delete`

**Arguments:** `path: string`, `confirmed: true`, `expectedSha256?: string`, `recursive?: true`, `maxEntries?: number`.

**File example:**

```json
{"action":"delete","path":"tmp/output.txt","confirmed":true,"expectedSha256":"sha256:HASH_FROM_READ"}
```

**Directory example:**

```json
{"action":"delete","path":"tmp/cache","confirmed":true,"recursive":true,"maxEntries":1000}
```

### `clean_generated`

**Arguments:** `path: string`, `patterns: string[]`, `confirmed: true`, `maxEntries: number`.

**Example:**

```json
{"action":"clean_generated","path":".","patterns":["dist/**","coverage/**","*.tmp"],"confirmed":true,"maxEntries":1000}
```

## Review and patch work

### `diff_file`

**Arguments:** `path: string`, `unified?: boolean`.

**Example:**

```json
{"action":"diff_file","path":"server/routers.ts","unified":true}
```

### `diff_workspace`

**Arguments:** `path?: string`, `unified?: boolean`.

**Example:**

```json
{"action":"diff_workspace","path":".","unified":true}
```

### `diff_paths`

**Arguments:** `paths: string[]`, `unified?: boolean`.

**Example:**

```json
{"action":"diff_paths","paths":["server/routers.ts","server/projectWorkspace.ts"],"unified":true}
```

### `preview_patch`

**Arguments:** `patchText: string`.

**Example:**

```json
{"action":"preview_patch","patchText":"diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-old\n+new\n"}
```

### `apply_patch`

**Arguments:** `patchText: string`.

**Example:**

```json
{"action":"apply_patch","patchText":"diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-old\n+new\n"}
```

The result contains a `rollbackOperationId` for the applied patch.

### `rollback`

**Arguments:** `rollbackOperationId: string`.

**Example:**

```json
{"action":"rollback","rollbackOperationId":"ROLLBACK_ID_FROM_APPLY_PATCH"}
```

## Recovery and workspace state

### `manifest`

**Arguments:** `path?: string`, `maxEntries?: number`, `maxBytes?: number`, `maxDepth?: number`.

**Example:**

```json
{"action":"manifest","path":".","maxEntries":5000,"maxBytes":104857600,"maxDepth":20}
```

### `snapshot`

**Arguments:** `path?: string`, `maxEntries?: number`, `maxBytes?: number`, `maxDepth?: number`.

**Example:**

```json
{"action":"snapshot","path":".","maxEntries":5000,"maxBytes":104857600,"maxDepth":20}
```

The result contains a `snapshotId` and `manifestId`.

### `restore_snapshot`

**Arguments:** `snapshotId: string`, `confirmed: true`.

**Example:**

```json
{"action":"restore_snapshot","snapshotId":"SNAPSHOT_ID_FROM_SNAPSHOT","confirmed":true}
```

### `verify_workspace`

**Arguments:** `manifestId: string`, `maxEntries?: number`, `maxBytes?: number`, `maxDepth?: number`.

**Example:**

```json
{"action":"verify_workspace","manifestId":"MANIFEST_ID_FROM_MANIFEST","maxEntries":5000,"maxBytes":104857600,"maxDepth":20}
```

### `export_patch`

**Arguments:** `paths?: string[]`.

**Example:**

```json
{"action":"export_patch","paths":["src/app.tsx","server/routers.ts"]}
```

### `import_patch`

**Arguments:** `patchText: string`.

**Example:**

```json
{"action":"import_patch","patchText":"diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-old\n+new\n"}
```

## Recommended project workflow

For normal work:

```text
list or tree
→ find, glob, grep, symbols, references
→ read or read_many
→ create, write, patch, replace, or append
→ diff_file or diff_workspace
→ verify_workspace and project checks
→ commit and push through Nexuss-Git
```

For larger changes:

```text
manifest or snapshot
→ inspect
→ edit
→ review diff
→ run checks
→ verify
→ commit through Nexuss-Git
```

Git remains the durable source of project history. The filesystem skill operates on the active working tree; Nexuss-Git handles branches, commits, pushes, and recloning.

## Working style

Move directly from observation to action. Prefer evidence from the current workspace, keep requests focused, reuse returned IDs and checksums, and let verification determine the next step. The runtime records each operation and returns the evidence needed for the following action.
