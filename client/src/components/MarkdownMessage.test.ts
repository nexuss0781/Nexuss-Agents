import { beforeEach, describe, expect, it } from "vitest";
import { clearMarkdownCache, compileMarkdown, DEFAULT_MARKDOWN_CONFIG, getMarkdownCacheSize, isMarkdownCached } from "./MarkdownMessage";

describe("compiled Markdown cache", () => {
  beforeEach(() => clearMarkdownCache());

  it("compiles GFM tables, highlighted code, and KaTeX math into cached safe HTML", () => {
    const content = "| Item | Value |\n| --- | ---: |\n| Alpha | 1 |\n\n```ts\nconst green = '#00FF88';\n```\n\n$E = mc^2$\n\n<script>alert('blocked')</script>";
    const html = compileMarkdown(content);

    expect(html).toContain("<table>");
    expect(html).toContain("hljs");
    expect(html).toContain("katex");
    expect(html).not.toContain("<script>");
    expect(getMarkdownCacheSize()).toBe(1);
    expect(compileMarkdown(content)).toBe(html);
    expect(getMarkdownCacheSize()).toBe(1);
  });

  it("keys equivalent content separately when rendering configuration changes", () => {
    const content = "**A**\n\n```ts\nconst answer = 42;\n```\n\n$x^2$";
    const withoutOptionalFeatures = { ...DEFAULT_MARKDOWN_CONFIG, version: "nexuss-markdown-v2", gfm: false, math: false, highlight: false };
    const defaultHtml = compileMarkdown(content, DEFAULT_MARKDOWN_CONFIG);
    const plainHtml = compileMarkdown(content, withoutOptionalFeatures);

    expect(defaultHtml).not.toBe(plainHtml);
    expect(defaultHtml).toContain("katex");
    expect(defaultHtml).toContain("hljs");
    expect(plainHtml).not.toContain("katex");
    expect(plainHtml).not.toContain("hljs");
    expect(getMarkdownCacheSize()).toBe(2);
    expect(compileMarkdown(content, DEFAULT_MARKDOWN_CONFIG)).toBe(defaultHtml);
    expect(getMarkdownCacheSize()).toBe(2);
  });

  it("keeps the cache bounded and evicts the least recently used compiled message", () => {
    compileMarkdown("Message 0");
    for (let index = 1; index < 201; index++) compileMarkdown(`Message ${index}`);
    expect(getMarkdownCacheSize()).toBe(200);
    expect(isMarkdownCached("Message 0")).toBe(false);
    compileMarkdown("Message 0");
    expect(isMarkdownCached("Message 0")).toBe(true);
    expect(getMarkdownCacheSize()).toBe(200);
  });
});
