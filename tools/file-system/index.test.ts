import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectFileSystem } from "./index.js";
import { runFileSystem } from "./runtime.js";
import type { FileEntry, TreeEntry } from "./types.js";

const root = await mkdtemp(join(tmpdir(), "nexuss-file-system-"));
await mkdir(join(root, "src"));
await writeFile(join(root, "README.md"), "Nexuss-Agent\n", "utf8");
await writeFile(join(root, "src", "router.ts"), "export const route = true;\n", "utf8");
await writeFile(join(root, "src", "service.ts"), "export function helper() { return true; }\nexport class Service {}\nexport interface Config {}\n", "utf8");
await writeFile(join(root, "src", "consumer.ts"), "import { helper } from './service';\nconst result = helper();\n", "utf8");
execFileSync("git", ["init", "--quiet"], { cwd: root, stdio: "ignore" });

const list = await inspectFileSystem(root, { action: "list" });
if (!list.ok || !((list.data as { entries: FileEntry[] }).entries).some((item) => item.name === "src" && item.type === "directory")) throw new Error("list did not return the source directory");

const tree = await inspectFileSystem(root, { action: "tree", maxDepth: 3 });
if (!tree.ok || !((tree.data as { entries: TreeEntry[] }).entries).some((item) => item.path === "src" && item.children?.some((child) => child.path === "src/router.ts"))) throw new Error("tree did not include nested files");

const found = await inspectFileSystem(root, { action: "find", pattern: "*.ts" });
if (!found.ok || !(found.data as { entries: FileEntry[] }).entries.some((entry) => entry.path === "src/router.ts")) throw new Error("find did not match the TypeScript file");

const stat = await inspectFileSystem(root, { action: "stat", path: "README.md" });
if (!stat.ok || (stat.data as FileEntry).type !== "file" || (stat.data as FileEntry).size !== 13) throw new Error("stat returned incorrect file metadata");

const exists = await inspectFileSystem(root, { action: "exists", path: "missing.txt" });
if (exists.ok || exists.code !== "PATH_NOT_FOUND") throw new Error("missing path did not return PATH_NOT_FOUND");

const outside = await inspectFileSystem(root, { action: "list", path: "../" });
if (outside.ok || outside.code !== "PATH_OUTSIDE_PROJECT") throw new Error("path escape was not rejected");

const invalidLimit = await inspectFileSystem(root, { action: "list", maxEntries: 0 });
if (invalidLimit.ok || invalidLimit.code !== "LIMIT_INVALID") throw new Error("invalid limit was not rejected");

const read = await inspectFileSystem(root, { action: "read", path: "src/router.ts", startLine: 1, endLine: 1 });
if (!read.ok || !(read.data as { content: string }).content.includes("export const route")) throw new Error("read did not return text content");

const tail = await inspectFileSystem(root, { action: "tail", path: "README.md", lineCount: 1 });
if (!tail.ok || !(tail.data as { content: string }).content.includes("Nexuss-Agent")) throw new Error("tail did not return the last text lines");

const many = await inspectFileSystem(root, { action: "read_many", paths: ["README.md", "src/router.ts"] });
if (!many.ok || (many.data as { files: Array<{ data?: unknown }> }).files.filter((file) => file.data).length !== 2) throw new Error("read_many did not return both files");

const grep = await inspectFileSystem(root, { action: "grep", query: "route", path: "src" });
if (!grep.ok || (grep.data as { matches: Array<{ path: string; line: number }> }).matches[0]?.path !== "src/router.ts") throw new Error("grep did not return the matching source line");

const grepBatch = await inspectFileSystem(root, { action: "grep_batch", queries: ["Nexuss-Agent", "export const"] });
if (!grepBatch.ok || (grepBatch.data as { matches: unknown[] }).matches.length < 2) throw new Error("grep_batch did not return both query results");

const glob = await inspectFileSystem(root, { action: "glob", pattern: "*.md" });
if (!glob.ok || (glob.data as { entries: FileEntry[] }).entries[0]?.path !== "README.md") throw new Error("glob did not match the Markdown file");

const binaryPath = join(root, "image.bin");
await writeFile(binaryPath, Buffer.from([0, 1, 2, 3, 255]));
const binary = await inspectFileSystem(root, { action: "read", path: "image.bin" });
if (binary.ok || binary.code !== "BINARY_FILE") throw new Error("binary text read was not rejected");
const binaryInfo = await inspectFileSystem(root, { action: "binary_metadata", path: "image.bin" });
if (!binaryInfo.ok || !(binaryInfo.data as { isBinary: boolean }).isBinary) throw new Error("binary metadata did not identify binary content");

const outsideTarget = await mkdtemp(join(tmpdir(), "nexuss-file-system-outside-"));
await symlink(outsideTarget, join(root, "outside-link"));
const symlinkResult = await inspectFileSystem(root, { action: "list", path: "outside-link" });
if (symlinkResult.ok || symlinkResult.code !== "NOT_A_DIRECTORY") throw new Error("symlink target was not treated as a non-directory path");

const created = await inspectFileSystem(root, { action: "create", path: "notes.txt", content: "one\ntwo\nthree\n" });
if (!created.ok || !(created.data as { created: boolean }).created) throw new Error("create did not create a new file");

const missingChecksum = await inspectFileSystem(root, { action: "write", path: "notes.txt", content: "changed\n" });
if (missingChecksum.ok || missingChecksum.code !== "CHECKSUM_REQUIRED") throw new Error("write did not require an expected checksum");

const written = await inspectFileSystem(root, { action: "write", path: "notes.txt", content: "one\ntwo\nthree\n", expectedSha256: (created.data as { sha256: string }).sha256 });
if (!written.ok || !(written.data as { sha256: string }).sha256) throw new Error("checksum-guarded write failed");

const appended = await inspectFileSystem(root, { action: "append", path: "notes.txt", content: "four\n", expectedSha256: (written.data as { sha256: string }).sha256 });
if (!appended.ok || !(appended.data as { changed: boolean }).changed) throw new Error("append did not change the file");

const patched = await inspectFileSystem(root, { action: "patch", path: "notes.txt", edits: [{ find: "two", replace: "TWO" }], expectedSha256: (appended.data as { sha256: string }).sha256 });
if (!patched.ok) throw new Error("exact patch failed");

const conflicted = await inspectFileSystem(root, { action: "patch", path: "notes.txt", edits: [{ find: "missing", replace: "value" }], expectedSha256: (patched.data as { sha256: string }).sha256 });
if (conflicted.ok || conflicted.code !== "EDIT_CONFLICT") throw new Error("invalid patch was not rejected");

const replaced = await inspectFileSystem(root, { action: "replace", path: "notes.txt", startLine: 1, endLine: 1, content: "ONE", expectedSha256: (patched.data as { sha256: string }).sha256 });
if (!replaced.ok) throw new Error("line replacement failed");

const mutationEscape = await inspectFileSystem(root, { action: "create", path: "../escape.txt", content: "blocked" });
if (mutationEscape.ok || mutationEscape.code !== "PATH_OUTSIDE_PROJECT") throw new Error("mutation path escape was not rejected");

const copySource = await inspectFileSystem(root, { action: "create", path: "copy-source.txt", content: "copy me" });
if (!copySource.ok) throw new Error("copy source creation failed");
const copied = await inspectFileSystem(root, { action: "copy", path: "copy-source.txt", destinationPath: "copy-target.txt" });
if (!copied.ok || (copied.data as { destinationPath: string }).destinationPath !== "copy-target.txt") throw new Error("copy did not create the destination");
const duplicateCopy = await inspectFileSystem(root, { action: "copy", path: "copy-source.txt", destinationPath: "copy-target.txt" });
if (duplicateCopy.ok || duplicateCopy.code !== "TARGET_EXISTS") throw new Error("copy did not reject an existing destination");

await mkdir(join(root, "linked-folder"));
await symlink(join(root, "README.md"), join(root, "linked-folder", "readme-link"));
const symlinkCopy = await inspectFileSystem(root, { action: "copy", path: "linked-folder", destinationPath: "linked-copy" });
if (symlinkCopy.ok || symlinkCopy.code !== "SYMLINK_BLOCKED") throw new Error("directory copy did not reject a nested symlink");

const moved = await inspectFileSystem(root, { action: "move", path: "copy-target.txt", destinationPath: "moved-target.txt" });
if (!moved.ok) throw new Error("move failed");
const renamed = await inspectFileSystem(root, { action: "rename", path: "moved-target.txt", destinationPath: "renamed-target.txt" });
if (!renamed.ok) throw new Error("rename failed");

const deleteConfirmation = await inspectFileSystem(root, { action: "delete", path: "renamed-target.txt", confirmed: false });
if (deleteConfirmation.ok || deleteConfirmation.code !== "CONFIRMATION_REQUIRED") throw new Error("delete did not require confirmation");
const deleteChecksum = await inspectFileSystem(root, { action: "delete", path: "renamed-target.txt", confirmed: true });
if (deleteChecksum.ok || deleteChecksum.code !== "CHECKSUM_REQUIRED") throw new Error("file delete did not require a checksum");
const deleted = await inspectFileSystem(root, { action: "delete", path: "renamed-target.txt", confirmed: true, expectedSha256: (copySource.data as { sha256: string }).sha256 });
if (!deleted.ok || !(deleted.data as { deleted: boolean }).deleted) throw new Error("checksum-guarded file deletion failed");

await mkdir(join(root, "remove-me"));
await writeFile(join(root, "remove-me", "child.txt"), "remove");
const directoryConfirmation = await inspectFileSystem(root, { action: "delete", path: "remove-me", confirmed: true });
if (directoryConfirmation.ok || directoryConfirmation.code !== "RECURSIVE_REQUIRED") throw new Error("directory delete did not require recursive confirmation");
const removedDirectory = await inspectFileSystem(root, { action: "delete", path: "remove-me", confirmed: true, recursive: true, maxEntries: 10 });
if (!removedDirectory.ok || !(removedDirectory.data as { deleted: boolean }).deleted) throw new Error("recursive directory deletion failed");

await mkdir(join(root, "generated"));
await writeFile(join(root, "generated", "cache.tmp"), "cache");
await writeFile(join(root, "generated", "keep.txt"), "keep");
const cleanConfirmation = await inspectFileSystem(root, { action: "clean_generated", path: "generated", patterns: ["*.tmp"], maxEntries: 10, confirmed: false });
if (cleanConfirmation.ok || cleanConfirmation.code !== "CONFIRMATION_REQUIRED") throw new Error("generated cleanup did not require confirmation");
const cleaned = await inspectFileSystem(root, { action: "clean_generated", path: "generated", patterns: ["*.tmp"], maxEntries: 10, confirmed: true });
if (!cleaned.ok || (cleaned.data as { entries: number }).entries !== 1) throw new Error("generated cleanup did not remove the matching file");

const symbols = await inspectFileSystem(root, { action: "symbols", path: "src", include: ["**/*.ts"], language: "typescript" });
if (!symbols.ok || !(symbols.data as { symbols: Array<{ name: string; kind: string }> }).symbols.some((symbol) => symbol.name === "helper" && symbol.kind === "function") || !(symbols.data as { symbols: Array<{ name: string; kind: string }> }).symbols.some((symbol) => symbol.name === "Service" && symbol.kind === "class")) throw new Error("symbols did not discover TypeScript declarations");

const references = await inspectFileSystem(root, { action: "references", path: "src", query: "helper", include: ["**/*.ts"] });
if (!references.ok || (references.data as { matches: Array<{ path: string; line: number }> }).matches.length < 2 || !(references.data as { matches: Array<{ path: string; line: number }> }).matches.some((match) => match.path === "src/consumer.ts" && match.line === 2)) throw new Error("references did not return all helper usages");

const changes = await inspectFileSystem(root, { action: "recent_changes" });
if (!changes.ok || !(changes.data as { changes: Array<{ path: string; status: string }> }).changes.some((change) => change.path === "src/service.ts" && change.status === "added")) throw new Error("recent_changes did not report the new file");

const invalidQuery = await inspectFileSystem(root, { action: "references", query: "[", regex: true });
if (invalidQuery.ok || invalidQuery.code !== "QUERY_INVALID") throw new Error("invalid reference query was not rejected");

execFileSync("git", ["add", "src/router.ts"], { cwd: root, stdio: "ignore" });
await writeFile(join(root, "src", "router.ts"), "export const route = false;\n", "utf8");

const fileDiff = await inspectFileSystem(root, { action: "diff_file", path: "src/router.ts" });
if (!fileDiff.ok || !(fileDiff.data as { files: string[]; additions: number; deletions: number }).files.includes("src/router.ts") || (fileDiff.data as { additions: number }).additions !== 1 || (fileDiff.data as { deletions: number }).deletions !== 1) throw new Error("diff_file did not report the changed source file");

const workspaceDiff = await inspectFileSystem(root, { action: "diff_workspace" });
if (!workspaceDiff.ok || !(workspaceDiff.data as { files: string[] }).files.includes("src/router.ts")) throw new Error("diff_workspace did not report the working-tree change");

const selectedDiff = await inspectFileSystem(root, { action: "diff_paths", paths: ["src/router.ts"] });
if (!selectedDiff.ok || !(selectedDiff.data as { files: string[] }).files.includes("src/router.ts")) throw new Error("diff_paths did not report the selected file");

const patchText = "diff --git a/src/router.ts b/src/router.ts\n--- a/src/router.ts\n+++ b/src/router.ts\n@@ -1 +1 @@\n-export const route = false;\n+export const route = true;\n";
const patchPreview = await inspectFileSystem(root, { action: "preview_patch", patchText });
if (!patchPreview.ok || !(patchPreview.data as { valid: boolean }).valid) throw new Error("preview_patch did not validate a clean patch");

const appliedPatch = await inspectFileSystem(root, { action: "apply_patch", patchText });
if (!appliedPatch.ok || !(appliedPatch.data as { applied: boolean; rollbackOperationId: string }).applied) throw new Error("apply_patch did not apply the patch");

const rolledBack = await inspectFileSystem(root, { action: "rollback", rollbackOperationId: (appliedPatch.data as { rollbackOperationId: string }).rollbackOperationId });
if (!rolledBack.ok || !(rolledBack.data as { rolledBack: boolean }).rolledBack) throw new Error("rollback did not restore the pre-patch file");

const protectedPatch = await inspectFileSystem(root, { action: "preview_patch", patchText: "diff --git a/.git/config b/.git/config\n--- a/.git/config\n+++ b/.git/config\n@@ -1 +1 @@\n-old\n+new\n" });
if (protectedPatch.ok || protectedPatch.code !== "PATCH_INVALID") throw new Error("protected patch path was not rejected");

const manifestResult = await inspectFileSystem(root, { action: "manifest", maxEntries: 100, maxBytes: 1_000_000 });
if (!manifestResult.ok || (manifestResult.data as { fileCount: number; manifestId: string }).fileCount < 1) throw new Error("manifest did not enumerate workspace files");
const manifestId = (manifestResult.data as { manifestId: string }).manifestId;
const manifestVerification = await inspectFileSystem(root, { action: "verify_workspace", manifestId, maxEntries: 100, maxBytes: 1_000_000 });
if (!manifestVerification.ok || !(manifestVerification.data as { verified: boolean }).verified) throw new Error("manifest did not verify an unchanged workspace");

const snapshotResult = await inspectFileSystem(root, { action: "snapshot", maxEntries: 100, maxBytes: 1_000_000 });
if (!snapshotResult.ok || !(snapshotResult.data as { snapshotId: string; manifestId: string; archiveBytes: number }).snapshotId || (snapshotResult.data as { archiveBytes: number }).archiveBytes < 1) throw new Error("snapshot was not created");
const snapshotId = (snapshotResult.data as { snapshotId: string }).snapshotId;
const readmeEntry = (manifestResult.data as { files: Array<{ path: string; sha256: string }> }).files.find((entry) => entry.path === "README.md");
if (!readmeEntry) throw new Error("manifest did not contain README.md");
const changedReadme = await inspectFileSystem(root, { action: "write", path: "README.md", content: "changed after snapshot\n", expectedSha256: readmeEntry.sha256 });
if (!changedReadme.ok) throw new Error("snapshot fixture mutation failed");
const changedVerification = await inspectFileSystem(root, { action: "verify_workspace", manifestId, maxEntries: 100, maxBytes: 1_000_000 });
if (!changedVerification.ok || (changedVerification.data as { changed: string[] }).changed.indexOf("README.md") === -1) throw new Error("manifest did not detect changed content");
const restoreConfirmation = await inspectFileSystem(root, { action: "restore_snapshot", snapshotId, confirmed: false });
if (restoreConfirmation.ok || restoreConfirmation.code !== "CONFIRMATION_REQUIRED") throw new Error("snapshot restore did not require confirmation");
const restoredSnapshot = await inspectFileSystem(root, { action: "restore_snapshot", snapshotId, confirmed: true });
if (!restoredSnapshot.ok || !(restoredSnapshot.data as { restored: boolean }).restored) throw new Error("snapshot restore failed");
const restoredVerification = await inspectFileSystem(root, { action: "verify_workspace", manifestId, maxEntries: 100, maxBytes: 1_000_000 });
if (!restoredVerification.ok || !(restoredVerification.data as { verified: boolean }).verified) throw new Error("restored snapshot did not verify");

await writeFile(join(root, "src", "router.ts"), "export const route = false;\n", "utf8");
const exportedPatch = await inspectFileSystem(root, { action: "export_patch", paths: ["src/router.ts"] });
if (!exportedPatch.ok || !(exportedPatch.data as { exported: boolean; patch: string }).exported || !(exportedPatch.data as { patch: string }).patch.includes("export const route = false")) throw new Error("export_patch did not return the working-tree patch");
execFileSync("git", ["checkout", "--", "src/router.ts"], { cwd: root, stdio: "ignore" });
const importedPatch = await inspectFileSystem(root, { action: "import_patch", patchText: (exportedPatch.data as { patch: string }).patch });
if (!importedPatch.ok || !(importedPatch.data as { applied: boolean }).applied) throw new Error("import_patch did not apply the exported patch");

const auditEvents: Array<{ action: string; result: string; projectId: string; errorCode?: string }> = [];
const runtime = { projectId: "project-test", workspaceRoot: root, audit: async (event: { action: string; result: string; projectId: string; errorCode?: string }) => { auditEvents.push(event); } };
const runtimeRead = await runFileSystem(runtime, { action: "read", path: "README.md" });
if (!runtimeRead.ok) throw new Error("runtime adapter did not dispatch a permitted read");
const runtimeDenied = await runFileSystem({ ...runtime, allowMutations: false }, { action: "write", path: "README.md", content: "blocked" });
if (runtimeDenied.ok || runtimeDenied.code !== "OPERATION_FAILED") throw new Error("runtime adapter did not deny disabled mutation");
await writeFile(join(root, ".env"), "SECRET=value\n", "utf8");
const protectedRead = await runFileSystem(runtime, { action: "read", path: ".env" });
if (protectedRead.ok || protectedRead.code !== "OPERATION_FAILED") throw new Error("runtime policy did not protect secret content");
if (auditEvents.length !== 3 || auditEvents[0]?.result !== "completed" || auditEvents[1]?.result !== "rejected" || auditEvents[2]?.result !== "rejected") throw new Error("runtime audit events did not classify outcomes correctly");

console.log("filesystem phase 9 tests passed");
