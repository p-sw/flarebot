// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { isBlockedHost, monitorWriteSchema } from "./schemas";

describe("monitorWriteSchema", () => {
  it("rejects a short interval and a private check target", () => {
    const fast = monitorWriteSchema.safeParse({
      name: "Fast",
      type: "http",
      config: { url: "https://example.com" },
      intervalSeconds: 30,
    });
    expect(fast.success).toBe(false);
    const local = monitorWriteSchema.safeParse({
      name: "Local",
      type: "tcp",
      config: { host: "127.0.0.1", port: 443 },
      intervalSeconds: 60,
    });
    expect(local.success).toBe(false);
    const mail = monitorWriteSchema.safeParse({
      name: "Mail",
      type: "tcp",
      config: { host: "smtp.example.com", port: 25 },
      intervalSeconds: 60,
    });
    expect(mail.success).toBe(false);
  });
});

describe("isBlockedHost", () => {
  it("blocks loopback, link-local, and private ranges", () => {
    expect(isBlockedHost("127.0.0.1")).toBe(true);
    expect(isBlockedHost("10.1.2.3")).toBe(true);
    expect(isBlockedHost("192.168.1.1")).toBe(true);
    expect(isBlockedHost("169.254.1.1")).toBe(true);
    expect(isBlockedHost("metadata.google.internal")).toBe(true);
    expect(isBlockedHost("example.com")).toBe(false);
    expect(isBlockedHost("192.0.2.1")).toBe(false);
    for (const host of [
      "localhost",
      "app.localhost",
      "printer.local",
      "db.internal",
      "172.16.0.9",
      "[::1]",
      "[fd00::1]",
      "fc00:1::2",
      "[fe80::1]",
    ]) {
      expect(`${host} ${isBlockedHost(host)}`).toBe(`${host} true`);
    }
    for (const host of [
      "fcm.googleapis.com",
      "fd.io",
      "fda.gov",
      "localhost.example.com",
      "www.localytics.com",
      "api.internal-tools.com",
      "172.160.1.1",
      "10.example.com",
    ]) {
      expect(`${host} ${isBlockedHost(host)}`).toBe(`${host} false`);
    }
  });
});
