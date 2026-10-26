// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import {
  blankChannelDraft,
  channelDestination,
  channelFieldErrors,
  channelPayload,
  redactChannelConfig,
  resolveChannelConfig,
} from "./channels";

const pushoverKey = "a".repeat(30);

describe("channel config", () => {
  it("rejects private URLs and accepts the new channel shapes", () => {
    expect(
      resolveChannelConfig(
        "ntfy",
        { server: "http://127.0.0.1", topic: "ops" },
        null,
      ).ok,
    ).toBe(false);
    expect(
      resolveChannelConfig(
        "gotify",
        { server: "https://10.1.2.3", token: "app" },
        null,
      ).ok,
    ).toBe(false);
    expect(
      resolveChannelConfig(
        "teams",
        { webhookUrl: "https://192.168.1.2/hook" },
        null,
      ).ok,
    ).toBe(false);
    expect(
      resolveChannelConfig(
        "google_chat",
        { webhookUrl: "ftp://chat.example/hook" },
        null,
      ).ok,
    ).toBe(false);
    expect(
      resolveChannelConfig(
        "matrix",
        {
          homeserver: "http://localhost:8008",
          accessToken: "syt_token_value",
          roomId: "!room:matrix.example",
        },
        null,
      ).ok,
    ).toBe(false);
    expect(
      resolveChannelConfig(
        "discord",
        { webhookUrl: "http://10.0.0.5/hook" },
        null,
      ).ok,
    ).toBe(false);

    const ntfy = resolveChannelConfig(
      "ntfy",
      {
        server: "https://ntfy.sh",
        topic: "ops",
        token: "",
        priority: 4,
        tags: "warning, rotating_light",
      },
      null,
    );
    expect(ntfy.ok).toBe(true);
    if (ntfy.ok) {
      expect(ntfy.config.token).toBeUndefined();
      expect(ntfy.config.priority).toBe(4);
    }
    expect(
      resolveChannelConfig(
        "pushover",
        { userKey: pushoverKey, appToken: pushoverKey, priority: 2 },
        null,
      ).ok,
    ).toBe(true);
    expect(
      resolveChannelConfig(
        "pushover",
        { userKey: pushoverKey, appToken: pushoverKey, priority: 3 },
        null,
      ).ok,
    ).toBe(false);
    expect(
      resolveChannelConfig(
        "matrix",
        {
          homeserver: "https://matrix.example",
          accessToken: "syt_token_value",
          roomId: "#ops:matrix.example",
        },
        null,
      ).ok,
    ).toBe(true);
    expect(
      resolveChannelConfig(
        "matrix",
        {
          homeserver: "https://matrix.example",
          accessToken: "syt_token_value",
          roomId: "ops",
        },
        null,
      ).ok,
    ).toBe(false);
  });

  it("keeps stored secrets when the form sends them blank and can clear optional ones", () => {
    const kept = resolveChannelConfig(
      "gotify",
      { server: "https://gotify.example", token: "" },
      { server: "https://old.example", token: "stored-token" },
    );
    expect(kept.ok).toBe(true);
    if (kept.ok) expect(kept.config.token).toBe("stored-token");

    const replaced = resolveChannelConfig(
      "discord",
      { webhookUrl: "https://example.com/new" },
      { webhookUrl: "https://discord.com/api/webhooks/1/secret" },
    );
    expect(replaced.ok).toBe(true);
    if (replaced.ok)
      expect(replaced.config.webhookUrl).toBe("https://example.com/new");

    const masked = resolveChannelConfig(
      "slack",
      { webhookUrl: "••••••••" },
      { webhookUrl: "https://hooks.slack.test/a" },
    );
    expect(masked.ok).toBe(true);
    if (masked.ok)
      expect(masked.config.webhookUrl).toBe("https://hooks.slack.test/a");

    const cleared = resolveChannelConfig(
      "ntfy",
      { server: "https://ntfy.sh", topic: "ops", token: "" },
      { token: "stored-token" },
      ["token"],
    );
    expect(cleared.ok).toBe(true);
    if (cleared.ok) expect(cleared.config.token).toBeUndefined();

    const headers = resolveChannelConfig(
      "webhook",
      {
        url: "",
        headers: [{ name: "authorization", value: "" }],
      },
      {
        url: "https://ops.example/hook",
        headers: [{ name: "authorization", value: "Bearer secret" }],
      },
    );
    expect(headers.ok).toBe(true);
    if (headers.ok) {
      expect(headers.config.url).toBe("https://ops.example/hook");
      expect(headers.config.headers).toEqual([
        { name: "authorization", value: "Bearer secret" },
      ]);
    }
  });

  it("redacts secrets and describes a channel without the secret", () => {
    const discord = redactChannelConfig("discord", {
      webhookUrl: "https://discord.com/api/webhooks/1/secret",
    });
    expect(discord.secrets).toEqual(["webhookUrl"]);
    expect(discord.config.webhookUrl).toBe("");
    expect(JSON.stringify(discord.config)).not.toContain("webhooks/1");
    expect(
      channelDestination("discord", {
        webhookUrl: "https://discord.com/api/webhooks/1/secret",
      }),
    ).toBe("discord.com");

    const pushover = redactChannelConfig("pushover", {
      userKey: pushoverKey,
      appToken: pushoverKey,
      device: "phone",
    });
    expect(pushover.secrets).toEqual(["userKey", "appToken"]);
    expect(pushover.config.device).toBe("phone");
    expect(
      channelDestination("ntfy", { server: "https://ntfy.sh", topic: "ops" }),
    ).toBe("ops @ ntfy.sh");
  });

  it("flags form fields and treats a saved secret as already filled", () => {
    const draft = blankChannelDraft("gotify");
    draft.name = "Ops";
    draft.gotifyServer = "https://gotify.example";
    expect(channelFieldErrors(draft).gotifyToken).toBe("required");
    expect(channelFieldErrors(draft, ["token"]).gotifyToken).toBeUndefined();

    const ntfy = blankChannelDraft("ntfy");
    ntfy.name = "Ops";
    ntfy.ntfyTopic = "ops alerts";
    expect(channelFieldErrors(ntfy).ntfyTopic).toBe("invalid");
    ntfy.ntfyServer = "http://localhost";
    ntfy.ntfyTopic = "ops";
    expect(channelFieldErrors(ntfy).ntfyServer).toBe("blocked");

    const payload = channelPayload({
      ...blankChannelDraft("matrix"),
      name: "Rooms",
      matrixServer: "https://matrix.example",
      matrixToken: "syt_token_value",
      matrixRoom: "!room:matrix.example",
    });
    expect(payload.type).toBe("matrix");
    expect(payload.config.roomId).toBe("!room:matrix.example");
    expect(
      channelFieldErrors({ ...blankChannelDraft("email"), name: "" }).name,
    ).toBe("required");
  });
});
