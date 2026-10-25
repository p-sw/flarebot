// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { deliverChannel } from "./dispatch";

describe("deliverChannel", () => {
  it("posts a Discord content payload and queues email", async () => {
    const calls: { url: string; body: string }[] = [];
    const queued: string[] = [];
    const discord = await deliverChannel(
      {
        type: "discord",
        locale: "en",
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
      { type: "email", locale: "ko", config: { to: "ops@example.com" } },
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
});
