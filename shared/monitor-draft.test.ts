// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import {
  draftFromMonitor,
  isSensitiveHeader,
  maskHeaderValue,
  monitorFieldErrors,
  monitorPayload,
  monitorTargetLabel,
} from "./monitor-draft";
import { monitorWriteSchema } from "./schemas";

describe("monitor draft", () => {
  it("round-trips every HTTP field the create form can set", () => {
    const draft = draftFromMonitor({
      name: "Main Web",
      type: "http",
      paused: false,
      intervalSeconds: 120,
      timeoutSeconds: 8,
      retries: 3,
      recoveryThreshold: 2,
      channelIds: [],
      config: {
        url: "https://example.com/health",
        method: "POST",
        headers: [
          { name: "Authorization", value: "Bearer secret" },
          { name: "Accept", value: "application/json" },
        ],
        body: '{"ping":true}',
        followRedirects: false,
        expectedStatuses: [200, 204],
        keyword: "ok",
        keywordMode: "absent",
        jsonPath: "$.status",
        jsonExpect: "up",
      },
    });
    const payload = monitorPayload(draft);
    expect(monitorWriteSchema.safeParse(payload).success).toBe(true);
    expect(payload).toMatchObject({
      name: "Main Web",
      type: "http",
      intervalSeconds: 120,
      timeoutSeconds: 8,
      retries: 3,
      recoveryThreshold: 2,
      config: {
        url: "https://example.com/health",
        method: "POST",
        headers: [
          { name: "Authorization", value: "Bearer secret" },
          { name: "Accept", value: "application/json" },
        ],
        body: '{"ping":true}',
        followRedirects: false,
        expectedStatuses: [200, 204],
        keyword: "ok",
        keywordMode: "absent",
        jsonPath: "$.status",
        jsonExpect: "up",
      },
    });
    expect(monitorTargetLabel("http", payload.config)).toBe(
      "https://example.com/health",
    );
  });

  it("uses the same schema as create for interval, private hosts, and port 25", () => {
    const http = draftFromMonitor({
      name: "Web",
      type: "http",
      config: { url: "https://example.com" },
      intervalSeconds: 60,
      timeoutSeconds: 10,
      retries: 2,
      recoveryThreshold: 1,
      channelIds: [],
      paused: false,
    });
    expect(
      monitorFieldErrors({ ...http, intervalSeconds: "30" }).intervalSeconds,
    ).toBe("interval");
    expect(
      monitorFieldErrors({ ...http, url: "http://127.0.0.1/health" }).url,
    ).toBe("url_blocked");
    const tcp = draftFromMonitor({
      name: "Mail",
      type: "tcp",
      config: { host: "smtp.example.com", port: 587 },
      intervalSeconds: 60,
      timeoutSeconds: 10,
      retries: 2,
      recoveryThreshold: 1,
      channelIds: [],
      paused: false,
    });
    expect(monitorFieldErrors({ ...tcp, port: "25" }).port).toBe(
      "port_blocked",
    );
    expect(monitorFieldErrors({ ...tcp, host: "10.1.1.1" }).host).toBe(
      "host_private",
    );
  });

  it("masks authorization and cookie values until they are revealed", () => {
    expect(isSensitiveHeader("Authorization")).toBe(true);
    expect(isSensitiveHeader("cookie")).toBe(true);
    expect(isSensitiveHeader("Accept")).toBe(false);
    expect(maskHeaderValue("Bearer secret")).toBe("••••••••");
  });
});
