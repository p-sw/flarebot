// SPDX-License-Identifier: MIT

export type MarkdownInline =
  | { type: "text"; text: string }
  | { type: "strong"; children: MarkdownInline[] }
  | { type: "em"; children: MarkdownInline[] }
  | { type: "code"; text: string }
  | { type: "link"; text: string; href: string };

export type MarkdownBlock =
  | { type: "p"; lines: MarkdownInline[][] }
  | { type: "ul"; items: MarkdownInline[][] }
  | { type: "ol"; items: MarkdownInline[][] };

function sanitizeHref(raw: string): string | null {
  const href = raw.trim();
  if (!/^https?:\/\//i.test(href)) return null;
  if (/[\s<>"']/.test(href)) return null;
  try {
    const url = new URL(href);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.href;
  } catch {
    return null;
  }
}

function parseInline(input: string): MarkdownInline[] {
  const nodes: MarkdownInline[] = [];
  let text = "";
  let index = 0;
  const flush = () => {
    if (!text) return;
    nodes.push({ type: "text", text });
    text = "";
  };
  while (index < input.length) {
    if (input.startsWith("`", index)) {
      const end = input.indexOf("`", index + 1);
      if (end > index + 1) {
        flush();
        nodes.push({ type: "code", text: input.slice(index + 1, end) });
        index = end + 1;
        continue;
      }
    }
    if (input.startsWith("**", index) || input.startsWith("__", index)) {
      const marker = input.slice(index, index + 2);
      const end = input.indexOf(marker, index + 2);
      if (end > index + 2) {
        flush();
        nodes.push({
          type: "strong",
          children: parseInline(input.slice(index + 2, end)),
        });
        index = end + 2;
        continue;
      }
    }
    const marker = input[index];
    if ((marker === "*" || marker === "_") && input[index + 1] !== marker) {
      const end = input.indexOf(marker, index + 1);
      if (end > index + 1 && input[end + 1] !== marker) {
        flush();
        nodes.push({
          type: "em",
          children: parseInline(input.slice(index + 1, end)),
        });
        index = end + 1;
        continue;
      }
    }
    if (input[index] === "[") {
      const close = input.indexOf("]", index + 1);
      if (close > index && input[close + 1] === "(") {
        let end = close + 2;
        let depth = 1;
        while (end < input.length && depth > 0) {
          if (input[end] === "(") depth += 1;
          else if (input[end] === ")") depth -= 1;
          if (depth > 0) end += 1;
        }
        if (depth === 0 && end > close + 2) {
          const label = input.slice(index + 1, close);
          const href = sanitizeHref(input.slice(close + 2, end));
          if (label.trim()) {
            flush();
            nodes.push(
              href
                ? { type: "link", text: label, href }
                : { type: "text", text: label },
            );
            index = end + 1;
            continue;
          }
        }
      }
    }
    text += input[index];
    index += 1;
  }
  flush();
  return nodes;
}

export function parseMarkdown(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push({
      type: "p",
      lines: paragraph.map((line) => parseInline(line)),
    });
    paragraph = [];
  };
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line.trim() === "") {
      flushParagraph();
      index += 1;
      continue;
    }
    const unordered = /^[-*] /.test(line);
    const ordered = /^\d+\. /.test(line);
    if (unordered || ordered) {
      flushParagraph();
      const items: MarkdownInline[][] = [];
      while (index < lines.length) {
        const current = lines[index] ?? "";
        const match = (ordered ? /^\d+\. (.*)$/ : /^[-*] (.*)$/).exec(current);
        if (!match) break;
        items.push(parseInline(match[1] ?? ""));
        index += 1;
      }
      blocks.push({ type: ordered ? "ol" : "ul", items });
      continue;
    }
    paragraph.push(line);
    index += 1;
  }
  flushParagraph();
  return blocks;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    if (char === "&") return "&amp;";
    if (char === "<") return "&lt;";
    if (char === ">") return "&gt;";
    if (char === '"') return "&quot;";
    return "&#39;";
  });
}

function renderInline(nodes: MarkdownInline[]): string {
  return nodes
    .map((node) => {
      if (node.type === "text") return escapeHtml(node.text);
      if (node.type === "code") return `<code>${escapeHtml(node.text)}</code>`;
      if (node.type === "strong")
        return `<strong>${renderInline(node.children)}</strong>`;
      if (node.type === "em") return `<em>${renderInline(node.children)}</em>`;
      return `<a href="${escapeHtml(node.href)}" rel="nofollow noopener noreferrer" target="_blank">${escapeHtml(node.text)}</a>`;
    })
    .join("");
}

/** Safe HTML. Text is escaped. The only tags are p, br, strong, em, code, ul, ol, li, and a. */
export function renderMarkdown(source: string): string {
  return parseMarkdown(source)
    .map((block) => {
      if (block.type === "p") {
        return `<p>${block.lines.map((line) => renderInline(line)).join("<br>")}</p>`;
      }
      const tag = block.type === "ol" ? "ol" : "ul";
      const items = block.items
        .map((item) => `<li>${renderInline(item)}</li>`)
        .join("");
      return `<${tag}>${items}</${tag}>`;
    })
    .join("");
}
