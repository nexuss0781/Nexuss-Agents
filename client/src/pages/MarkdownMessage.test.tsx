// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownMessage } from "./Home";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const renderDiagram = vi.fn().mockResolvedValue({ svg: '<svg role="img"><text>Evidence flow</text></svg>' });

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: renderDiagram,
  },
}));

const mounted: Array<{ root: Root; host: HTMLDivElement }> = [];

async function renderMarkdown(content: string) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  await act(async () => {
    root.render(<MarkdownMessage content={content} />);
    await new Promise((resolveTick) => setTimeout(resolveTick, 0));
  });
  return host;
}

afterEach(async () => {
  for (const { root, host } of mounted.splice(0)) {
    await act(async () => root.unmount());
    host.remove();
  }
  renderDiagram.mockClear();
});

describe("research Markdown renderer", () => {
  it("renders research-rich Markdown with restrained structural affordances", async () => {
    const host = await renderMarkdown([
      "## Evidence summary",
      "",
      "The relationship is $E = mc^2$ with a source [reference](https://example.com/source).",
      "Unsafe [script](javascript:alert(1)) stays inactive.",
      "",
      "- [x] Validate sample",
      "- [ ] Recheck source",
      "",
      "| Measure | Result |",
      "| --- | ---: |",
      "| Confidence | 94% |",
      "",
      "```ts",
      "const finding = 'supported';",
      "```",
      "",
      "```mermaid",
      "flowchart LR",
      "  Evidence --> Finding",
      "```",
    ].join("\n"));

    expect(host.querySelector("h2")?.textContent).toBe("Evidence summary");
    expect(host.querySelector(".katex")).not.toBeNull();
    expect(host.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
    expect(host.querySelector('input[aria-label="Complete"]')?.hasAttribute("disabled")).toBe(true);
    expect(host.querySelector(".markdown-table-scroll table")).not.toBeNull();
    expect(host.querySelector('a[href="https://example.com/source"]')?.getAttribute("target")).toBe("_blank");
    expect(host.querySelector('a[href="https://example.com/source"]')?.getAttribute("rel")).toContain("noopener");
    expect(host.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(host.querySelector('button[aria-label="Copy ts code"]')).not.toBeNull();
    expect(host.querySelector(".research-diagram svg text")?.textContent).toBe("Evidence flow");
  });

  it("falls back quietly when a Mermaid definition cannot render", async () => {
    renderDiagram.mockRejectedValueOnce(new Error("invalid diagram"));
    const host = await renderMarkdown("```mermaid\nnot a valid diagram\n```");
    await act(async () => { await new Promise((resolveTick) => setTimeout(resolveTick, 0)); });
    expect(host.textContent).toContain("could not be rendered");
  });
});
