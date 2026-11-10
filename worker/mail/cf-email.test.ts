// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { displayName } from "./cf-email";

describe("From display name", () => {
  it("quotes ASCII names, encodes other names, and drops line breaks", () => {
    expect(displayName("Acme, Inc.")).toBe('"Acme, Inc."');
    expect(displayName('Ops "night" \\ shift')).toBe(
      '"Ops \\"night\\" \\\\ shift"',
    );
    expect(displayName("Status\r\nBcc: x@example.com")).toBe(
      '"Status Bcc: x@example.com"',
    );
    expect(displayName("Société")).toBe("=?UTF-8?B?U29jacOpdMOp?=");
  });
});
