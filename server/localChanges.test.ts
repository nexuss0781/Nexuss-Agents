import { describe, expect, it } from "vitest";
import { parseGithubBranch } from "./projectWorkspace";
import { parseLocalStatus } from "./localChanges";

describe("local Changes helpers", () => {
  it("normalizes Git porcelain statuses into reviewable files", () => {
    expect(parseLocalStatus(" M src/App.tsx\nA  src/new.ts\n D src/old.ts\n?? notes.md\nR  old.md -> docs/old.md\n")).toEqual([
      { path: "src/App.tsx", status: "modified" },
      { path: "src/new.ts", status: "added" },
      { path: "src/old.ts", status: "deleted" },
      { path: "notes.md", status: "untracked" },
      { path: "docs/old.md", status: "renamed" },
    ]);
  });

  it("accepts normal branches and rejects unsafe refs", () => {
    expect(parseGithubBranch("feature/changes-1")).toBe("feature/changes-1");
    expect(() => parseGithubBranch("../main")).toThrow();
    expect(() => parseGithubBranch("main@{1}")).toThrow();
  });
});
