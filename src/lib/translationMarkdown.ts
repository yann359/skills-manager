import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Root, RootContent } from "mdast";

export interface TextSpan { field: "content" | "description"; start: number; end: number; kind?: "format-open" | "format-close" }
export interface TranslationInput { skill_name: string; content: string; description: string; spans: TextSpan[]; protected: TextSpan[]; legacy?: TranslationInput }
const parser = unified().use(remarkParse).use(remarkGfm);
// Trees are read-only here. Reuse original/translated trees across preparation,
// validation and bilingual rendering; bound retention to four documents.
const trees = new Map<string, Root>();
function parseMarkdown(source: string): Root {
  const cached = trees.get(source);
  if (cached) return cached;
  const tree = parser.parse(source) as Root;
  if (trees.size >= 4) trees.delete(trees.keys().next().value!);
  trees.set(source, tree);
  return tree;
}

export function markdownBody(content: string) {
  const match = /^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/.exec(content);
  return { body: match ? content.slice(match[0].length) : content, offset: match?.[0].length ?? 0 };
}

function byteOffsets(text: string) {
  const offsets = new Array<number>(text.length + 1).fill(0);
  let bytes = 0;
  for (let i = 0; i < text.length;) {
    const point = text.codePointAt(i)!;
    const length = point > 0xffff ? 2 : 1;
    offsets[i] = bytes;
    if (length === 2) offsets[i + 1] = bytes;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    i += length;
    offsets[i] = bytes;
  }
  return offsets;
}

function textSpans(source: string, field: TextSpan["field"], stable = true) {
  const { body, offset } = markdownBody(source);
  const offsets = byteOffsets(source);
  const result: TextSpan[] = [];
  const protectedRanges: TextSpan[] = [];
  function protect(start: number, end: number, kind?: TextSpan["kind"]) { if (end > start) protectedRanges.push({ field, start: offsets[start + offset], end: offsets[end + offset], ...(kind ? { kind } : {}) }); }
  function inline(node: RootContent) {
    if (!node.position) return;
    const start = node.position.start.offset ?? 0, end = node.position.end.offset ?? 0;
    if (stable && (node.type === "linkReference" || (node.type === "link" && !body.slice(start, end).startsWith("[")))) { protect(start, end); return; }
    if (stable && node.type === "text") {
      // Soft breaks include blockquote/list continuation syntax in source offsets.
      for (const match of body.slice(start, end).matchAll(/\r?\n(?:[ \t]*>[ \t]?)*[ \t]*/g)) protect(start + match.index, start + match.index + match[0].length);
      // Configuration keys may also appear in prose without backticks.
      for (const match of body.slice(start, end).matchAll(/\b(?:[a-z][a-z0-9]*(?:[A-Z][A-Za-z0-9]*)+|[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+)\b/g)) protect(start + match.index, start + match.index + match[0].length);
    }
    if (["inlineCode", "html", "image", "imageReference", "footnoteReference", ...(stable ? ["break"] : [])].includes(node.type)) { protect(start, end); return; }
    if ("children" in node && node.children.length) {
      const children = node.children as RootContent[];
      const format = ["emphasis", "strong", "delete"].includes(node.type);
      protect(start, children[0].position?.start.offset ?? start, format ? "format-open" : undefined);
      protect(children[children.length - 1].position?.end.offset ?? end, end, format ? "format-close" : undefined);
      children.forEach(inline);
    }
  }
  function walk(node: Root | RootContent) {
    if (["code", "inlineCode", "html", "definition", "image", "imageReference"].includes(node.type)) return;
    if (node.type === "paragraph" && node.position) {
      const raw = body.slice(node.position.start.offset ?? 0, node.position.end.offset ?? 0);
      // Conservatively keep unfenced JSON/YAML/.env examples intact as well.
      if (/^\s*(?:\{\s*|\[\s*["'{\d]|["'][^"']+["']\s*:|[a-z_][a-z0-9_.-]*\s*:\s*\S|[A-Z_][A-Z0-9_]*\s*=)/m.test(raw)) return;
      // Keep standalone unfenced command examples local, without mistaking a
      // product mention inside ordinary prose for an entire shell command.
      if (/^\s*(?:\$\s+)?(?:npm|npx|uvx|node|python3?|bash|ffmpeg|cargo|git|powershell)\s+\S/.test(raw)) return;
    }
    if (["paragraph", "heading", "tableCell"].includes(node.type) && node.position) {
      const start = (node.position.start.offset ?? 0) + offset;
      const end = (node.position.end.offset ?? 0) + offset;
      const raw = source.slice(start, end);
      inline(node as RootContent);
      // Translate whole paragraphs with inline syntax and code kept as local gaps.
      let consumed = 0;
      while (consumed < raw.length) {
            let size = Math.min(1100, raw.length - consumed);
            if (consumed + size < raw.length) {
              const candidate = raw.slice(consumed, consumed + size);
              const boundary = Math.max(candidate.lastIndexOf(". "), candidate.lastIndexOf("; "), candidate.lastIndexOf(" "));
              if (boundary > 550) size = boundary + 1;
              // Never split a UTF-16 surrogate pair.
              if (/[\uD800-\uDBFF]/.test(raw[consumed + size - 1] ?? "")) size--;
            }
            const piece = raw.slice(consumed, consumed + size);
            if (/[A-Za-z]/.test(piece)) result.push({ field, start: offsets[start + consumed], end: offsets[start + consumed + size] });
            consumed += size;
      }
      return;
    }
    if ("children" in node) node.children.forEach(child => walk(child as RootContent));
  }
  walk(parseMarkdown(body));
  return { spans: result, protected: protectedRanges };
}

export function prepareTranslationInput(skillName: string, content: string, description = ""): TranslationInput {
  const detail = textSpans(content, "content"), summary = textSpans(description, "description");
  const input: TranslationInput = { skill_name: skillName, content, description, spans: [...summary.spans, ...detail.spans], protected: [...summary.protected, ...detail.protected] };
  const oldDetail = textSpans(content, "content", false), oldSummary = textSpans(description, "description", false);
  const legacy: TranslationInput = { skill_name: skillName, content, description, spans: [...oldSummary.spans, ...oldDetail.spans], protected: [...oldSummary.protected, ...oldDetail.protected] };
  if (JSON.stringify(input.protected) !== JSON.stringify(legacy.protected)) input.legacy = legacy;
  return input;
}

export function markdownBlocks(content: string) {
  const body = markdownBody(content).body;
  const nodes = (parseMarkdown(body)).children;
  const raw = (node: RootContent) => body.slice(node.position?.start.offset ?? 0, node.position?.end.offset ?? 0);
  const definitions = nodes.filter(node => node.type === "definition" || node.type === "footnoteDefinition").map(raw).join("\n\n");
  return nodes.filter(node => node.type !== "definition" && node.type !== "footnoteDefinition").map(node => `${raw(node)}${definitions ? `\n\n${definitions}` : ""}`);
}

export function plainSummary(content: string) {
  function text(node: Root | RootContent): string {
    if (node.type === "text" || node.type === "inlineCode" || node.type === "code") return node.value;
    if ("children" in node) return node.children.map(child => text(child as RootContent)).join(node.type === "root" ? " " : "");
    return "";
  }
  return text(parseMarkdown(content));
}

function signature(content: string) {
  function shape(node: Root | RootContent): unknown {
    const value: Record<string, unknown> = { type: node.type };
    for (const key of ["depth", "ordered", "start", "checked", "url", "title", "identifier", "referenceType", "lang", "meta", "align"] as const) {
      if (key in node) value[key] = (node as unknown as Record<string, unknown>)[key];
    }
    if (["code", "inlineCode", "html", "definition"].includes(node.type) && "value" in node) value.value = node.value;
    if ("children" in node) value.children = node.children.filter(child => child.type !== "text").map(child => shape(child as RootContent));
    return value;
  }
  return JSON.stringify(shape(parseMarkdown(markdownBody(content).body)));
}

const sourceSignatures = new WeakMap<TranslationInput, [string, string]>();
export function validateTranslatedMarkdown(input: TranslationInput, result: { content: string; description: string }) {
  let expected = sourceSignatures.get(input);
  if (!expected) { expected = [signature(input.content), signature(input.description)]; sourceSignatures.set(input, expected); }
  if (expected[0] !== signature(result.content) || expected[1] !== signature(result.description)) {
    throw new Error("译文的 Markdown 结构、代码或链接校验失败，已保留英文原文。请重新翻译。");
  }
  const frontmatter = input.content.slice(0, markdownBody(input.content).offset);
  if (!result.content.startsWith(frontmatter)) throw new Error("原始配置校验失败，已保留英文原文。");
}

// Local AST validation isolates a bad paragraph while retaining all safe ones.
export function retainValidFragments<T extends { content: string; description: string; complete: boolean; completed: number; total: number; pending: TextSpan[]; fragments: { span: TextSpan; text: string | null }[] }>(input: TranslationInput, result: T): { value: T; rejected: TextSpan[] } {
  try { validateTranslatedMarkdown(input, result); return { value: result, rejected: [] }; }
  catch { /* Validate replacements separately before publishing them. */ }
  const encoder = new TextEncoder(), decoder = new TextDecoder("utf-8", { fatal: true });
  const fragments = result.fragments.map(fragment => ({ ...fragment }));
  function assemble() {
    const values = { content: encoder.encode(input.content), description: encoder.encode(input.description) };
    for (const { span, text } of [...fragments].reverse()) {
      if (text === null) continue;
      const source = values[span.field], replacement = encoder.encode(text);
      const target = new Uint8Array(span.start + replacement.length + source.length - span.end);
      target.set(source.subarray(0, span.start)); target.set(replacement, span.start);
      target.set(source.subarray(span.end), span.start + replacement.length);
      values[span.field] = target;
    }
    return { content: decoder.decode(values.content), description: decoder.decode(values.description) };
  }
  const rejected: TextSpan[] = [];
  const proposed = fragments.map(fragment => fragment.text);
  fragments.forEach(fragment => { fragment.text = null; });
  for (let index = 0; index < fragments.length; index++) {
    if (proposed[index] === null) continue;
    fragments[index].text = proposed[index];
    try { validateTranslatedMarkdown(input, assemble()); }
    catch { rejected.push(fragments[index].span); fragments[index].text = null; }
  }
  const completed = fragments.filter(fragment => fragment.text !== null).length;
  return { value: { ...result, ...assemble(), fragments, completed, complete: completed === fragments.length, pending: fragments.filter(fragment => fragment.text === null).map(fragment => fragment.span) }, rejected };
}

export function markdownBlockEntries(content: string) {
  const { body, offset } = markdownBody(content);
  const offsets = byteOffsets(content);
  const nodes = (parseMarkdown(body)).children;
  const blocks = markdownBlocks(content);
  return nodes.filter(node => node.type !== "definition" && node.type !== "footnoteDefinition").map((node, index) => ({ content: blocks[index], start: offsets[offset + (node.position?.start.offset ?? 0)], end: offsets[offset + (node.position?.end.offset ?? 0)] }));
}
