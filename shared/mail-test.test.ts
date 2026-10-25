// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import {
  diagnoseMailInput,
  parseMailTestBody,
  parseStoredMailError,
  redactMailDetail,
} from "./mail-test";

const smtp = {
  driver: "smtp" as const,
  host: "smtp.example.com",
  port: 587 as const,
  security: "starttls" as const,
  username: "bot",
  password: "secret",
  fromName: "Flarebot",
  fromAddress: "bot@example.com",
};

describe("mail test payloads", () => {
  it("accepts the settings schema plus a recipient", () => {
    const parsed = parseMailTestBody({ ...smtp, email: "ops@example.com" });
    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.data.driver === "smtp") {
      expect(parsed.data.email).toBe("ops@example.com");
      expect(parsed.data.password).toBe("secret");
    }
  });

  it("names each configuration problem", () => {
    expect(diagnoseMailInput({})).toBe("not_configured");
    expect(diagnoseMailInput({ driver: "none" })).toBe("not_configured");
    expect(
      diagnoseMailInput({
        ...smtp,
        fromAddress: "",
      }),
    ).toBe("missing_from");
    expect(diagnoseMailInput({ driver: "smtp", port: 587 })).toBe(
      "incomplete_smtp",
    );
    expect(diagnoseMailInput({ ...smtp, port: 25 })).toBe("port_25");
    expect(diagnoseMailInput({ ...smtp, port: 2525 })).toBe("unsupported_port");
    expect(diagnoseMailInput({ ...smtp, host: "10.1.2.3" })).toBe(
      "blocked_host",
    );
    expect(diagnoseMailInput({ ...smtp, host: "mail.internal" })).toBe(
      "blocked_host",
    );
    expect(
      diagnoseMailInput({
        driver: "cf-email",
        fromName: "Flarebot",
        fromAddress: "",
      }),
    ).toBe("missing_from");
    expect(diagnoseMailInput(smtp)).toBeNull();
    expect(diagnoseMailInput({ ...smtp, security: "none" })).toBeNull();
  });

  it("redacts secrets and keeps a short server reply", () => {
    expect(redactMailDetail("config")).toBeUndefined();
    expect(redactMailDetail("535 rejected s3cret", ["s3cret"])).toBe(
      "535 rejected [redacted]",
    );
    const stored = parseStoredMailError(
      JSON.stringify({
        stage: "auth",
        reason: null,
        detail: "535 5.7.8 Authentication failed",
      }),
    );
    expect(stored).toEqual({
      stage: "auth",
      reason: undefined,
      detail: "535 5.7.8 Authentication failed",
    });
    expect(parseStoredMailError("connect: connection refused")?.stage).toBe(
      "connect",
    );
  });
});
