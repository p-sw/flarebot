// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { classifyMailError, inferSmtpStage, nextRetryDelay } from "./retry";

describe("mail retry", () => {
  it("backs off and then stops", () => {
    expect(nextRetryDelay(1)).toBe(60_000);
    expect(nextRetryDelay(2)).toBe(5 * 60_000);
    expect(nextRetryDelay(3)).toBe(30 * 60_000);
    expect(nextRetryDelay(4)).toBe(2 * 60 * 60_000);
    expect(nextRetryDelay(5)).toBeNull();
  });

  it("treats SMTP 5xx and auth failures as permanent", () => {
    expect(classifyMailError("535 Authentication failed")).toBe("permanent");
    expect(classifyMailError("421 try again")).toBe("transient");
    expect(inferSmtpStage("connection timed out")).toBe("connect");
    expect(inferSmtpStage("certificate verify failed")).toBe("tls");
  });
});
