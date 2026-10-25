// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { describeMailSource } from "./mail-source";

describe("describeMailSource", () => {
  it("prefers Worker secrets over a saved driver", () => {
    expect(
      describeMailSource(
        { SMTP_HOST: "smtp.example.com", MAIL_FROM: "bot@example.com" },
        "cf-email",
      ),
    ).toBe("secrets");
  });

  it("reports the saved driver when secrets are absent", () => {
    expect(describeMailSource({}, "smtp")).toBe("database");
    expect(describeMailSource({}, "cf-email")).toBe("cloudflare");
    expect(describeMailSource({}, "none")).toBe("none");
    expect(describeMailSource({}, null)).toBe("none");
  });
});
