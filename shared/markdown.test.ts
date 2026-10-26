// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown";

describe("renderMarkdown", () => {
  it("renders a small set of tags and escapes raw html", () => {
    const html = renderMarkdown(
      "See **status** and `code`.\n\n- one\n- [docs](https://example.com/docs)\n\n<script>alert(1)</script>",
    );
    expect(html).toContain("<strong>status</strong>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain("<ul><li>one</li>");
    expect(html).toContain(
      '<a href="https://example.com/docs" rel="nofollow noopener noreferrer" target="_blank">docs</a>',
    );
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("drops unsafe link targets", () => {
    const html = renderMarkdown(
      "[x](javascript:alert(1)) [y](https://ok.example) [z](data:text/html,hi)",
    );
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("data:");
    expect(html.startsWith("<p>x ")).toBe(true);
    expect(html).toContain(">y</a> z</p>");
    expect(html).toContain("https://ok.example/");
  });
});
