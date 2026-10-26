// SPDX-License-Identifier: MIT

import { type MarkdownInline, parseMarkdown } from "@shared/markdown";
import type { ReactNode } from "react";

function keyFor(item: unknown, seen: Map<string, number>): string {
  const fingerprint = JSON.stringify(item);
  const count = (seen.get(fingerprint) ?? 0) + 1;
  seen.set(fingerprint, count);
  return `${count}:${fingerprint}`;
}

function inlineNodes(
  nodes: MarkdownInline[],
  seen: Map<string, number>,
): ReactNode[] {
  return nodes.map((node) => {
    const id = keyFor(node, seen);
    if (node.type === "text") return <span key={id}>{node.text}</span>;
    if (node.type === "code") {
      return (
        <code key={id} className="rounded bg-muted px-1">
          {node.text}
        </code>
      );
    }
    if (node.type === "strong")
      return <strong key={id}>{inlineNodes(node.children, seen)}</strong>;
    if (node.type === "em")
      return <em key={id}>{inlineNodes(node.children, seen)}</em>;
    return (
      <a
        key={id}
        href={node.href}
        rel="nofollow noopener noreferrer"
        target="_blank"
        className="underline"
      >
        {node.text}
      </a>
    );
  });
}

export function Markdown({ source }: { source: string }) {
  const blocks = parseMarkdown(source);
  const seen = new Map<string, number>();
  return (
    <div className="grid min-w-0 gap-2 break-words text-sm">
      {blocks.map((block) => {
        const id = keyFor(block, seen);
        if (block.type === "p") {
          const lines: ReactNode[] = [];
          for (const line of block.lines) {
            if (lines.length > 0)
              lines.push(<br key={keyFor({ br: lines.length }, seen)} />);
            lines.push(
              <span key={keyFor(line, seen)}>{inlineNodes(line, seen)}</span>,
            );
          }
          return <p key={id}>{lines}</p>;
        }
        const List = block.type === "ol" ? "ol" : "ul";
        return (
          <List
            key={id}
            className={
              block.type === "ol" ? "list-decimal pl-5" : "list-disc pl-5"
            }
          >
            {block.items.map((item) => (
              <li key={keyFor(item, seen)}>{inlineNodes(item, seen)}</li>
            ))}
          </List>
        );
      })}
    </div>
  );
}
