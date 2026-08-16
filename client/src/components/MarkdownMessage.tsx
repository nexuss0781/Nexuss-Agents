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

export type MarkdownRenderConfig = Readonly<{
  version: string;
  gfm: boolean;
  math: boolean;
  highlight: boolean;
}>;

export const DEFAULT_MARKDOWN_CONFIG: MarkdownRenderConfig = {
  version: "nexuss-markdown-v1",
  gfm: true,
  math: true,
  highlight: true,
};

const compiledMarkdownCache = new Map<string, string>();

function getCacheKey(content: string, config: MarkdownRenderConfig) {
  return JSON.stringify([config.version, config.gfm, config.math, config.highlight, content]);
}

function createCompiler(config: MarkdownRenderConfig) {
  const compiler = unified().use(remarkParse);
  if (config.gfm) compiler.use(remarkGfm);
  if (config.math) compiler.use(remarkMath);
  compiler.use(remarkRehype).use(rehypeSanitize);
  if (config.math) compiler.use(rehypeKatex);
  if (config.highlight) compiler.use(rehypeHighlight);
  return compiler.use(rehypeStringify);
}

/**
 * Compiles immutable message content once per rendering configuration. The Map
 * behaves as an LRU cache, keeping long-lived sessions bounded while repeated
 * message renders avoid reparsing Markdown, math, and code blocks.
 */
export function compileMarkdown(content: string, config: MarkdownRenderConfig = DEFAULT_MARKDOWN_CONFIG) {
  const key = getCacheKey(content, config);
  const cached = compiledMarkdownCache.get(key);
  if (cached !== undefined) {
    compiledMarkdownCache.delete(key);
    compiledMarkdownCache.set(key, cached);
    return cached;
  }

  const html = String(createCompiler(config).processSync(content));
  compiledMarkdownCache.set(key, html);
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

export function isMarkdownCached(content: string, config: MarkdownRenderConfig = DEFAULT_MARKDOWN_CONFIG) {
  return compiledMarkdownCache.has(getCacheKey(content, config));
}

export const MarkdownMessage = memo(function MarkdownMessage({ content }: { content: string }) {
  const html = useMemo(() => compileMarkdown(content), [content]);
  return <div className="markdown-message" dangerouslySetInnerHTML={{ __html: html }} />;
});
