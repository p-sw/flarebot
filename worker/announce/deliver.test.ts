// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import type { AnnouncementEvent } from "../../shared/announcements";
import type { ChannelType } from "../../shared/channels";
import { deliverAnnouncement } from "./deliver";

const event: AnnouncementEvent = {
  kind: "incident.created",
  organizationId: "org",
  subjectType: "incident",
  subjectId: "inc",
  title: "API outage",
  summary: "Latency is high",
  occurredAt: 1_700_000_000_000,
  href: "/s/status/incidents/inc",
};

function callsOf() {
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
  return { seen, fetchImpl };
}

async function send(type: ChannelType, config: Record<string, unknown>) {
  const { seen, fetchImpl } = callsOf();
  const result = await deliverAnnouncement({ type, config }, event, {
    fetch: fetchImpl,
  });
  return { result, call: seen[0] };
}

describe("deliverAnnouncement", () => {
  it("uses the same transports as monitor alerts for the newer channel types", async () => {
    const ntfy = await send("ntfy", {
      server: "https://ntfy.example",
      topic: "ops",
      token: "secret",
    });
    expect(ntfy.result.ok).toBe(true);
    expect(ntfy.call?.url).toBe("https://ntfy.example");
    expect(ntfy.call?.headers.get("authorization")).toBe("Bearer secret");
    const ntfyBody = JSON.parse(ntfy.call?.body ?? "{}") as {
      topic: string;
      priority: number;
      tags: string[];
      title: string;
    };
    expect(ntfyBody.topic).toBe("ops");
    expect(ntfyBody.priority).toBe(5);
    expect(ntfyBody.tags).toEqual(["rotating_light"]);
    expect(ntfyBody.title).toContain("API outage");

    const gotify = await send("gotify", {
      server: "https://gotify.example/",
      token: "app",
    });
    expect(gotify.call?.url).toBe("https://gotify.example/message");
    expect(gotify.call?.headers.get("x-gotify-key")).toBe("app");
    expect(JSON.parse(gotify.call?.body ?? "{}").priority).toBe(8);

    const pushover = await send("pushover", {
      userKey: "user",
      appToken: "app",
    });
    expect(pushover.call?.url).toBe("https://api.pushover.net/1/messages.json");
    expect(JSON.parse(pushover.call?.body ?? "{}").priority).toBe(1);

    const teams = await send("teams", {
      webhookUrl: "https://teams.example/hook",
    });
    const card = JSON.parse(teams.call?.body ?? "{}") as {
      attachments: { content: { body: { color?: string }[] } }[];
    };
    expect(card.attachments[0]?.content.body[0]?.color).toBe("Attention");

    const chat = await send("google_chat", {
      webhookUrl: "https://chat.example/hook",
    });
    const chatBody = JSON.parse(chat.call?.body ?? "{}") as {
      cardsV2: { card: { header: { subtitle: string } } }[];
    };
    expect(chatBody.cardsV2[0]?.card.header.subtitle).toBe("API outage");

    const matrix = await send("matrix", {
      homeserver: "https://matrix.example",
      roomId: "!room:example.com",
      accessToken: "tok",
    });
    expect(matrix.call?.method).toBe("PUT");
    expect(matrix.call?.url).toContain(
      "/_matrix/client/v3/rooms/!room%3Aexample.com/send/m.room.message/",
    );
    expect(matrix.call?.headers.get("authorization")).toBe("Bearer tok");

    const hook = await send("webhook", { url: "https://ops.example/hook" });
    const payload = JSON.parse(hook.call?.body ?? "{}") as {
      event: string;
      subjectId: string;
      href: string;
    };
    expect(payload.event).toBe("incident.created");
    expect(payload.subjectId).toBe("inc");
    expect(payload.href).toBe("/s/status/incidents/inc");
  });

  it("treats a resolved incident like a recovery and refuses a private target", async () => {
    const { seen, fetchImpl } = callsOf();
    const resolved = await deliverAnnouncement(
      {
        type: "ntfy",
        config: { server: "https://ntfy.example", topic: "ops" },
      },
      { ...event, kind: "incident.resolved" },
      { fetch: fetchImpl },
    );
    expect(resolved.ok).toBe(true);
    expect(JSON.parse(seen[0]?.body ?? "{}").priority).toBe(3);
    expect(JSON.parse(seen[0]?.body ?? "{}").tags).toEqual([
      "white_check_mark",
    ]);

    const blocked = await deliverAnnouncement(
      {
        type: "gotify",
        config: { server: "http://127.0.0.1:8080", token: "app" },
      },
      { ...event, kind: "maintenance.started" },
      { fetch: fetchImpl },
    );
    expect(blocked.ok).toBe(false);
    expect(seen).toHaveLength(1);
  });
});
