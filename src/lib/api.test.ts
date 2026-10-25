// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { ApiClientError, errorText, mailFailureText } from "./api";

const stages = ["config", "connect", "tls", "auth", "send"] as const;

describe("errorText", () => {
  it("maps every mail stage and config reason to a sentence", () => {
    const reasons = [
      "not_configured",
      "missing_from",
      "incomplete_smtp",
      "port_25",
      "unsupported_port",
      "blocked_host",
      "missing_binding",
      "missing_encryption_key",
    ] as const;
    for (const reason of reasons) {
      const text = errorText(
        new ApiClientError("Email failed", "mail", 400, "config", reason),
      );
      expect(text.length).toBeGreaterThan(12);
      expect(text).not.toMatch(/^Test failed: (config|connect|tls|auth|send)$/);
      expect(text).not.toBe(reason);
      expect(text).not.toBe("config");
    }
    for (const stage of stages) {
      const text = mailFailureText({ stage });
      expect(text).not.toBe(stage);
      expect(text).not.toMatch(/Test failed:/);
    }
  });

  it("includes the server reply for delivery failures and hides secrets", () => {
    const auth = errorText(
      new ApiClientError(
        "535 5.7.8 Authentication failed",
        "mail",
        400,
        "auth",
        undefined,
        "535 5.7.8 Authentication failed",
      ),
    );
    expect(auth).toContain("535 5.7.8 Authentication failed");
    expect(auth).not.toBe("auth");

    const leaked = mailFailureText({
      stage: "auth",
      detail: "535 password=s3cret rejected",
    });
    expect(leaked).not.toContain("s3cret");
    expect(leaked).not.toContain("password=");

    const configOnly = mailFailureText({ stage: "config", detail: "config" });
    expect(configOnly).not.toBe("config");
    expect(configOnly).not.toContain("Test failed");
  });

  it("reads a legacy stored stage without showing it alone", () => {
    const text = mailFailureText({ stage: "timeout", detail: "timed out" });
    expect(text.toLowerCase()).not.toBe("timeout");
    expect(text).toContain("timed out");
  });
});
