// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it } from "vitest";
import { runCheck } from "./run";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function scripted(handler: (url: string) => Response | Promise<Response>) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    return handler(url);
  }) as typeof fetch;
}

const base = {
  timeoutMs: 1_000,
  intervalMs: 60_000,
  lastPushAt: null,
  now: 1_000,
};

describe("runCheck", () => {
  it("evaluates HTTP status, keywords, and JSON", async () => {
    let calls = 0;
    scripted(() => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ status: "up" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("nope", { status: 200 });
    });
    const ok = await runCheck({
      ...base,
      type: "http",
      config: {
        url: "https://example.com/health",
        method: "GET",
        followRedirects: true,
        expectedStatuses: [200, 201],
        keyword: "up",
        jsonPath: "$.status",
        jsonExpect: "up",
      },
    });
    expect(ok.ok).toBe(true);
    expect(ok.httpStatus).toBe(201);

    const missing = await runCheck({
      ...base,
      type: "http",
      config: {
        url: "https://example.com/health",
        method: "GET",
        followRedirects: false,
        expectedStatuses: [200],
        keyword: "ready",
      },
    });
    expect(missing.errorKind).toBe("keyword");
  });

  it("compares DNS answers from the resolver JSON", async () => {
    scripted(
      () =>
        new Response(
          JSON.stringify({ Status: 0, Answer: [{ data: "1.1.1.1" }] }),
          { status: 200 },
        ),
    );
    const ok = await runCheck({
      ...base,
      type: "dns",
      config: { name: "example.com", type: "A", expected: ["1.1.1.1"] },
    });
    expect(ok.ok).toBe(true);
    const missing = await runCheck({
      ...base,
      type: "dns",
      config: { name: "example.com", type: "A", expected: ["9.9.9.9"] },
    });
    expect(missing.errorKind).toBe("dns");
  });

  it("estimates SSL expiry from the CT log and falls back on TLS errors", async () => {
    const future = new Date(Date.now() + 40 * 86_400_000)
      .toISOString()
      .slice(0, 19)
      .replace("T", " ");
    scripted((url) => {
      if (url.includes("crt.sh")) {
        return new Response(
          JSON.stringify([
            {
              name_value: "*.example.com\nexample.com",
              not_after: future,
            },
          ]),
          { status: 200 },
        );
      }
      return new Response(null, { status: 200 });
    });
    const healthy = await runCheck({
      ...base,
      type: "ssl",
      config: { host: "example.com", warnDays: 14 },
    });
    expect(healthy.ok).toBe(true);
    expect(healthy.certNotAfter).toBeGreaterThan(Date.now());

    scripted((url) => {
      if (url.includes("crt.sh")) return new Response("busy", { status: 503 });
      throw new Error("TLS handshake failed");
    });
    const tls = await runCheck({
      ...base,
      type: "ssl",
      config: { host: "example.com", warnDays: 14 },
    });
    expect(tls.ok).toBe(false);
    expect(tls.internal).toBe(false);
    expect(tls.errorKind).toBe("tls");

    scripted((url) => {
      if (url.includes("crt.sh")) return new Response("[]", { status: 200 });
      return new Response(null, { status: 200 });
    });
    const unknown = await runCheck({
      ...base,
      type: "ssl",
      config: { host: "example.com", warnDays: 14 },
    });
    expect(unknown.internal).toBe(true);
  });

  it("rejects blocked TCP targets and reports a missed heartbeat", async () => {
    const blocked = await runCheck({
      ...base,
      type: "tcp",
      config: { host: "127.0.0.1", port: 443 },
    });
    expect(blocked.errorKind).toBe("connect");
    const mail = await runCheck({
      ...base,
      type: "tcp",
      config: { host: "smtp.example.com", port: 25 },
    });
    expect(mail.errorKind).toBe("connect");
    expect(mail.error).toContain("cannot be dialed");
    const missed = await runCheck({
      ...base,
      type: "heartbeat",
      lastPushAt: 0,
      now: 120_000,
      config: { graceSeconds: 10 },
    });
    expect(missed.error).toBe("Heartbeat missed");
    const fresh = await runCheck({
      ...base,
      type: "heartbeat",
      lastPushAt: 90_000,
      now: 100_000,
      config: { graceSeconds: 10 },
    });
    expect(fresh.ok).toBe(true);
  });
});
