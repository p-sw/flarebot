// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { deliverChannel } from "./dispatch";

describe("deliverChannel", () => {
  it("posts a Discord content payload and queues email", async () => {
    const calls: { url: string; body: string }[] = [];
    const queued: string[] = [];
    const discord = await deliverChannel(
      {
        type: "discord",
        config: { webhookUrl: "https://discord.example/hook" },
      },
      { kind: "down", monitorName: "API", reason: "timeout" },
      {
        fetch: async (input, init) => {
          calls.push({ url: String(input), body: String(init?.body ?? "") });
          return new Response(null, { status: 204 });
        },
      },
    );
    const email = await deliverChannel(
      { type: "email", config: { to: "ops@example.com" } },
      { kind: "up", monitorName: "API", reason: "" },
      {
        enqueueEmail: async (input) => {
          queued.push(input.text);
        },
      },
    );
    expect(discord.ok).toBe(true);
    expect(JSON.parse(calls[0]?.body ?? "{}").content).toContain("API");
    expect(email.ok).toBe(true);
    expect(queued[0]).toContain("API");
  });

  it("posts slack, telegram, and webhook payloads and surfaces HTTP errors", async () => {
    const seen: { url: string; body: string; auth?: string }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      seen.push({
        url: String(input),
        body: String(init?.body ?? ""),
        auth: headers.get("authorization") ?? undefined,
      });
      const url = String(input);
      if (url.includes("fail")) return new Response("no", { status: 500 });
      return new Response("ok", { status: 200 });
    };
    const slack = await deliverChannel(
      {
        type: "slack",
        config: { webhookUrl: "https://hooks.slack.test/a" },
      },
      { kind: "down", monitorName: "API", reason: "status" },
      { fetch: fetchImpl },
    );
    const telegram = await deliverChannel(
      {
        type: "telegram",
        config: { botToken: "token", chatId: "42" },
      },
      { kind: "unstable", monitorName: "API", reason: "flap" },
      { fetch: fetchImpl },
    );
    const hook = await deliverChannel(
      {
        type: "webhook",
        config: {
          url: "https://ops.test/hook",
          headers: [{ name: "authorization", value: "Bearer t" }],
        },
      },
      { kind: "up", monitorName: "API", reason: "" },
      { fetch: fetchImpl },
    );
    const failed = await deliverChannel(
      {
        type: "discord",
        config: { webhookUrl: "https://fail.test/hook" },
      },
      { kind: "down", monitorName: "API", reason: "x" },
      { fetch: fetchImpl },
    );
    expect(slack.ok).toBe(true);
    expect(JSON.parse(seen[0]?.body ?? "{}").text).toContain("API");
    expect(telegram.ok).toBe(true);
    expect(seen[1]?.url).toContain("/bottoken/sendMessage");
    expect(hook.ok).toBe(true);
    expect(seen[2]?.auth).toBe("Bearer t");
    expect(JSON.parse(seen[2]?.body ?? "{}").event).toBe("up");
    expect(failed.ok).toBe(false);
  });
});
