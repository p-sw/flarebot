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

  it("formats ntfy, gotify, pushover, teams, google chat, and matrix", async () => {
    const seen: {
      url: string;
      method: string;
      body: string;
      headers: Headers;
    }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      seen.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: String(init?.body ?? ""),
        headers: new Headers(init?.headers),
      });
      return new Response("ok", { status: 200 });
    };
    const down = {
      kind: "down" as const,
      monitorName: "API",
      reason: "timeout",
    };
    const up = { kind: "up" as const, monitorName: "API", reason: "" };
    const ntfy = await deliverChannel(
      {
        type: "ntfy",
        config: {
          server: "https://ntfy.example/",
          topic: "ops",
          token: "tok",
          tags: "warning, server",
        },
      },
      down,
      { fetch: fetchImpl },
    );
    const gotify = await deliverChannel(
      {
        type: "gotify",
        config: {
          server: "https://gotify.example",
          token: "app-token",
          priority: 9,
        },
      },
      up,
      { fetch: fetchImpl },
    );
    const pushover = await deliverChannel(
      {
        type: "pushover",
        config: {
          userKey: "u".repeat(30),
          appToken: "a".repeat(30),
          device: "phone, tablet",
          priority: 2,
          sound: "bike",
        },
      },
      down,
      { fetch: fetchImpl },
    );
    const teams = await deliverChannel(
      {
        type: "teams",
        config: { webhookUrl: "https://example.com/teams" },
      },
      down,
      { fetch: fetchImpl },
    );
    const chat = await deliverChannel(
      {
        type: "google_chat",
        config: { webhookUrl: "https://chat.example/hook" },
      },
      up,
      { fetch: fetchImpl },
    );
    const matrix = await deliverChannel(
      {
        type: "matrix",
        config: {
          homeserver: "https://matrix.example",
          accessToken: "syt_token",
          roomId: "!room:matrix.example",
        },
      },
      { kind: "unstable", monitorName: "API", reason: "flap" },
      { fetch: fetchImpl },
    );
    expect(ntfy.ok).toBe(true);
    expect(seen[0]?.url).toBe("https://ntfy.example");
    expect(seen[0]?.headers.get("authorization")).toBe("Bearer tok");
    const ntfyBody = JSON.parse(seen[0]?.body ?? "{}") as {
      topic: string;
      title: string;
      priority: number;
      tags: string[];
      message: string;
    };
    expect(ntfyBody.topic).toBe("ops");
    expect(ntfyBody.title).toContain("API");
    expect(ntfyBody.message).toContain("timeout");
    expect(ntfyBody.priority).toBe(5);
    expect(ntfyBody.tags).toEqual(["warning", "server"]);
    expect(gotify.ok).toBe(true);
    expect(seen[1]?.url).toBe("https://gotify.example/message");
    expect(seen[1]?.headers.get("x-gotify-key")).toBe("app-token");
    const gotifyBody = JSON.parse(seen[1]?.body ?? "{}") as {
      title: string;
      priority: number;
    };
    expect(gotifyBody.title).toContain("recovered");
    expect(gotifyBody.priority).toBe(9);
    const push = JSON.parse(seen[2]?.body ?? "{}") as {
      priority: number;
      retry?: number;
      expire?: number;
      device?: string;
      sound?: string;
      message: string;
    };
    expect(pushover.ok).toBe(true);
    expect(seen[2]?.url).toContain("api.pushover.net");
    expect(push.priority).toBe(2);
    expect(push.retry).toBe(60);
    expect(push.expire).toBe(3600);
    expect(push.device).toBe("phone,tablet");
    expect(push.sound).toBe("bike");
    expect(push.message).toContain("API");
    const card = JSON.parse(seen[3]?.body ?? "{}") as {
      attachments: {
        content: { type: string; body: { text: string; color?: string }[] };
      }[];
    };
    expect(teams.ok).toBe(true);
    expect(card.attachments[0]?.content.type).toBe("AdaptiveCard");
    expect(card.attachments[0]?.content.body[0]?.color).toBe("Attention");
    expect(card.attachments[0]?.content.body[1]?.text).toContain("timeout");
    const google = JSON.parse(seen[4]?.body ?? "{}") as {
      cardsV2: { card: { header: { title: string } } }[];
    };
    expect(chat.ok).toBe(true);
    expect(google.cardsV2[0]?.card.header.title).toContain("recovered");
    expect(matrix.ok).toBe(true);
    expect(seen[5]?.method).toBe("PUT");
    expect(seen[5]?.url).toContain("/_matrix/client/v3/rooms/");
    expect(seen[5]?.url).toContain("m.room.message");
    expect(seen[5]?.headers.get("authorization")).toBe("Bearer syt_token");
    expect(JSON.parse(seen[5]?.body ?? "{}").msgtype).toBe("m.text");
    expect(JSON.parse(seen[5]?.body ?? "{}").body).toContain("flapping");
  });

  it("surfaces HTTP failures and refuses private channel URLs", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response("no", { status: 502 });
    };
    const failed = await deliverChannel(
      {
        type: "matrix",
        config: {
          homeserver: "https://matrix.example",
          accessToken: "syt_token",
          roomId: "!room:matrix.example",
        },
      },
      { kind: "down", monitorName: "API", reason: "x" },
      { fetch: fetchImpl },
    );
    const blocked = await deliverChannel(
      {
        type: "ntfy",
        config: { server: "http://127.0.0.1:8080", topic: "ops" },
      },
      { kind: "down", monitorName: "API", reason: "x" },
      { fetch: fetchImpl },
    );
    const thrown = await deliverChannel(
      {
        type: "gotify",
        config: { server: "https://gotify.example", token: "t" },
      },
      { kind: "up", monitorName: "API", reason: "" },
      {
        fetch: async () => {
          throw new Error("connect failed");
        },
      },
    );
    expect(failed.ok).toBe(false);
    expect(failed.error).toContain("502");
    expect(blocked.ok).toBe(false);
    expect(calls).toBe(1);
    expect(thrown.ok).toBe(false);
    expect(thrown.error).toContain("connect failed");
  });
});
