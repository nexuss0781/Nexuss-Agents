import { memo, useMemo } from "react";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

const CACHE_LIMIT = 200;
const compiledMarkdownCache = new Map<string, string>();
const markdownCompiler = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkRehype)
  .use(rehypeSanitize)
  .use(rehypeKatex)
  .use(rehypeHighlight)
  .use(rehypeStringify);

/**
 * Compiles once per immutable persisted message. The Map behaves as an LRU cache
 * so a very long session remains memory bounded while repeated message renders
 * avoid parsing Markdown, math, and code blocks again.
 */
export function compileMarkdown(content: string) {
  const cached = compiledMarkdownCache.get(content);
  if (cached !== undefined) {
    compiledMarkdownCache.delete(content);
    compiledMarkdownCache.set(content, cached);
    return cached;
  }

  const html = String(markdownCompiler.processSync(content));
  compiledMarkdownCache.set(content, html);
  if (compiledMarkdownCache.size > CACHE_LIMIT) {
    const oldestKey = compiledMarkdownCache.keys().next().value;
    if (oldestKey) compiledMarkdownCache.delete(oldestKey);
  }
  return html;
}

export function clearMarkdownCache() {
  compiledMarkdownCache.clear();
}

export function getMarkdownCacheSize() {
  return compiledMarkdownCache.size;
}

export const MarkdownMessage = memo(function MarkdownMessage({ content }: { content: string }) {
  const html = useMemo(() => compileMarkdown(content), [content]);
  return <div className="markdown-message" dangerouslySetInnerHTML={{ __html: html }} />;
});
