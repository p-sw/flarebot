// SPDX-License-Identifier: MIT

import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { decryptString } from "../worker/crypto/secret";
import { api, ownerSession } from "./helpers";

function encryptionKey(): string {
  const key = env.ENCRYPTION_KEY;
  if (!key) throw new Error("ENCRYPTION_KEY is not set");
  return key;
}

describe("notification channels", () => {
  it("encrypts secrets, masks them on read, and keeps a blank secret on update", async () => {
    const owner = await ownerSession();
    const created = await api(
      "/api/channels",
      {
        method: "POST",
        body: JSON.stringify({
          name: "Push",
          type: "ntfy",
          config: {
            server: "https://ntfy.example",
            topic: "ops",
            token: "super-secret-token",
            priority: 4,
          },
        }),
      },
      owner,
    );
    expect(created.status, await created.clone().text()).toBe(201);
    const id = ((await created.json()) as { id: string }).id;

    const listed = await api("/api/channels", {}, owner);
    const body = (await listed.json()) as {
      channels: {
        id: string;
        destination: string;
        config: { token?: string; topic?: string };
        secrets: string[];
      }[];
    };
    const channel = body.channels.find((item) => item.id === id);
    expect(channel?.config.token).toBe("");
    expect(channel?.config.topic).toBe("ops");
    expect(channel?.secrets).toContain("token");
    expect(channel?.destination).toBe("ops @ ntfy.example");
    expect(JSON.stringify(channel)).not.toContain("super-secret-token");

    const row = await env.DB.prepare(
      "SELECT config_encrypted FROM notification_channels WHERE id = ?",
    )
      .bind(id)
      .first<{ config_encrypted: string }>();
    expect(row?.config_encrypted).not.toContain("super-secret-token");
    const plain = JSON.parse(
      await decryptString(encryptionKey(), row?.config_encrypted ?? ""),
    ) as { token?: string };
    expect(plain.token).toBe("super-secret-token");

    const kept = await api(
      `/api/channels/${id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          name: "Push renamed",
          type: "ntfy",
          config: { server: "https://ntfy.example", topic: "ops", priority: 2 },
        }),
      },
      owner,
    );
    expect(kept.status).toBe(200);
    const keptPlain = JSON.parse(
      await decryptString(
        encryptionKey(),
        (
          await env.DB.prepare(
            "SELECT config_encrypted FROM notification_channels WHERE id = ?",
          )
            .bind(id)
            .first<{ config_encrypted: string }>()
        )?.config_encrypted ?? "",
      ),
    ) as { token?: string; priority?: number; name?: string };
    expect(keptPlain.token).toBe("super-secret-token");
    expect(keptPlain.priority).toBe(2);

    const cleared = await api(
      `/api/channels/${id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          name: "Push renamed",
          type: "ntfy",
          config: { server: "https://ntfy.example", topic: "ops" },
          clearSecrets: ["token"],
        }),
      },
      owner,
    );
    expect(cleared.status).toBe(200);
    const clearedPlain = JSON.parse(
      await decryptString(
        encryptionKey(),
        (
          await env.DB.prepare(
            "SELECT config_encrypted FROM notification_channels WHERE id = ?",
          )
            .bind(id)
            .first<{ config_encrypted: string }>()
        )?.config_encrypted ?? "",
      ),
    ) as { token?: string };
    expect(clearedPlain.token).toBeUndefined();
  });

  it("rejects a private channel URL and stores a teams webhook encrypted", async () => {
    const owner = await ownerSession();
    const blocked = await api(
      "/api/channels",
      {
        method: "POST",
        body: JSON.stringify({
          name: "Local gotify",
          type: "gotify",
          config: { server: "http://127.0.0.1:8080", token: "app" },
        }),
      },
      owner,
    );
    expect(blocked.status).toBe(400);

    const teams = await api(
      "/api/channels",
      {
        method: "POST",
        body: JSON.stringify({
          name: "Teams",
          type: "teams",
          config: { webhookUrl: "https://example.com/workflows/secret-hook" },
        }),
      },
      owner,
    );
    expect(teams.status).toBe(201);
    const id = ((await teams.json()) as { id: string }).id;
    const listed = await api("/api/channels", {}, owner);
    const body = (await listed.json()) as {
      channels: {
        id: string;
        destination: string;
        config: { webhookUrl?: string };
        secrets: string[];
      }[];
    };
    const channel = body.channels.find((item) => item.id === id);
    expect(channel?.destination).toBe("example.com");
    expect(channel?.config.webhookUrl).toBe("");
    expect(channel?.secrets).toEqual(["webhookUrl"]);
    expect(JSON.stringify(channel)).not.toContain("secret-hook");
  });
});
