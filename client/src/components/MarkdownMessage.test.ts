import { beforeEach, describe, expect, it } from "vitest";
import { clearMarkdownCache, compileMarkdown, getMarkdownCacheSize } from "./MarkdownMessage";

describe("compiled Markdown cache", () => {
  beforeEach(() => clearMarkdownCache());

  it("compiles GFM tables, highlighted code, and KaTeX math into cached HTML", () => {
    const content = "| Item | Value |\n| --- | ---: |\n| Alpha | 1 |\n\n```ts\nconst green = '#00FF88';\n```\n\n$E = mc^2$";
    const html = compileMarkdown(content);

    expect(html).toContain("<table>");
    expect(html).toContain("hljs");
    expect(html).toContain("katex");
    expect(getMarkdownCacheSize()).toBe(1);
    expect(compileMarkdown(content)).toBe(html);
    expect(getMarkdownCacheSize()).toBe(1);
  });

  it("keeps the cache bounded while preserving recent compiled messages", () => {
    for (let index = 0; index < 205; index++) compileMarkdown(`Message ${index}`);
    expect(getMarkdownCacheSize()).toBe(200);
  });
});
