// SPDX-License-Identifier: MIT

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
    expect(classifyMailError("550 mailbox unavailable")).toBe("permanent");
    expect(classifyMailError("invalid login")).toBe("permanent");
    expect(classifyMailError("socket hang up")).toBe("transient");
    expect(inferSmtpStage("message rejected")).toBe("send");
    expect(nextRetryDelay(0)).toBeNull();
  });

  it("reads the reply code, not later numbers in the reply", () => {
    expect(
      classifyMailError(
        "Failed to send DATA: 451 4.7.500 Server busy. Please try again later",
      ),
    ).toBe("transient");
    expect(
      classifyMailError(
        "450 4.2.0 Greylisted, please try again in 500 seconds",
      ),
    ).toBe("transient");
    expect(
      classifyMailError(
        "Invalid RCPT TO: <a@example.com> 550 5.1.1 No such user",
      ),
    ).toBe("permanent");
    expect(
      classifyMailError("Failed send email body: 554-5.7.1 Rejected"),
    ).toBe("permanent");
  });
});
