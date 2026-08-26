---
name: nexuss-filesystem
description: Operate on Nexuss-Agent project workspaces through the filesystem runtime. Use for inspecting, reading, searching, creating, editing, reviewing, recovering, and organizing project files.
---

# Nexuss Filesystem

Use the project filesystem as the agent’s working computer. Work through the Nexuss-Agent runtime with the current `projectId`; the runtime selects the project workspace and records the operation automatically.

## Core loop

```text
inspect → understand → change → review → verify → continue
```

Start with a focused view of the project, find the relevant files, read the needed sections, make the smallest useful change, inspect the diff, and verify the result.

## Request shape

```ts
{
  action: "read",
  path: "server/routers.ts",
  startLine: 1,
  endLine: 160
}
```

Paths are project-relative. Keep requests focused and provide useful bounds such as `maxEntries`, `maxDepth`, `maxBytes`, `maxMatches`, and line ranges when working with large projects.

## Workspace discovery

| Action | Use it to |
|---|---|
| `list` | View the direct contents of a directory. |
| `tree` | Understand the project structure recursively. |
| `stat` | Inspect one path’s type, size, and time. |
| `exists` | Check whether a path is present. |
| `find` | Locate files or directories by pattern. |
| `du` | Understand workspace size. |

```json
{"action":"tree","path":".","maxDepth":3,"maxEntries":300}
```

## Reading and search

| Action | Use it to |
|---|---|
| `read` | Read a selected text range. |
| `read_many` | Read several related files together. |
| `tail` | Read the latest lines of a file or log. |
| `binary_metadata` | Identify a binary, size, extension, and SHA-256. |
| `grep` | Search one query across files. |
| `grep_batch` | Search several queries in one pass. |
| `glob` | Locate paths by glob pattern. |

```json
{"action":"grep","path":".","query":"createProject","include":["server/**/*.ts"],"contextLines":2,"maxMatches":100}
```

Use `symbols` to orient yourself in TypeScript, JavaScript, Python, Go, Rust, or Java code. Use `references` to locate usages of a name or expression. Use `recent_changes` to see the current Git working-tree changes.

## Creating and editing

| Action | Use it to |
|---|---|
| `create` | Add a new file. |
| `write` | Replace an existing file deliberately. |
| `append` | Add content to an existing file. |
| `patch` | Replace uniquely identified text. |
| `replace` | Replace a selected line range. |
| `format` | Run Prettier, Biome, gofmt, or rustfmt. |

For existing files, read first and carry the returned SHA-256 into `expectedSha256`:

```json
{
  "action":"patch",
  "path":"server/config.ts",
  "expectedSha256":"sha256:HASH_FROM_READ_OR_METADATA",
  "edits":[
    {"find":"const timeout = 30000;","replace":"const timeout = 60000;"}
  ]
}
```

A unique patch is preferred for a focused change. Use `write` when intentionally replacing the complete file. If the checksum no longer matches, read the current file again and prepare the change from the new content.

## File organization

| Action | Use it to |
|---|---|
| `copy` | Duplicate a file or directory. |
| `move` | Move a file or directory. |
| `rename` | Rename a path. |
| `delete` | Remove a selected file or directory. |
| `clean_generated` | Remove generated output by pattern. |

For removal work, identify the exact paths and use the operation’s confirmation fields. For directory cleanup, provide patterns and an entry budget.

## Review and recovery

| Action | Use it to |
|---|---|
| `diff_file` | Review one file’s Git diff. |
| `diff_workspace` | Review all local changes. |
| `diff_paths` | Review selected paths. |
| `preview_patch` | Check a patch before applying it. |
| `apply_patch` | Apply a reviewed patch. |
| `rollback` | Undo a patch using its returned rollback ID. |
| `manifest` | Capture file checksums and metadata. |
| `snapshot` | Capture a short-lived gzip workspace image. |
| `verify_workspace` | Compare the workspace with a manifest. |
| `restore_snapshot` | Restore a selected snapshot. |
| `export_patch` | Export current Git changes. |
| `import_patch` | Apply an exported patch. |

Use this sequence for larger changes:

```text
manifest or snapshot
→ edit
→ diff_workspace
→ verify
→ commit through Nexuss-Git
```

Git remains the durable source of project history. The filesystem skill handles the active working tree; Nexuss-Git handles branches, commits, pushes, and recloning.

## Agent working style

Move confidently from observation to action. Prefer direct evidence from the workspace over assumptions. Keep related reads and searches together, preserve useful operation IDs and checksums, and let verification decide whether the work is complete. When a result asks for a new current state, inspect that state and continue from it.

The runtime returns structured results with `ok`, `operationId`, `action`, `path`, `data`, `durationMs`, or a clear `code` and `message`. Use returned evidence as the basis for the next step and include important IDs in mission progress.
