// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { alertSeverity, notificationText } from "./copy";
import { deliverChannel } from "./dispatch";

function capture() {
  const seen: { url: string; body: Record<string, unknown> }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    seen.push({
      url: String(input),
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    return new Response("ok", { status: 200 });
  };
  return { seen, fetchImpl };
}

describe("degraded alert copy", () => {
  it("names the monitor and the matched condition when it becomes degraded", () => {
    expect(
      notificationText(
        "degraded",
        "Gallery",
        "Response time was over the degraded limit",
      ),
    ).toEqual({
      subject: "Gallery is degraded",
      body: "Gallery responds but is degraded. Reason: Response time was over the degraded limit",
    });
  });

  it("falls back to the unknown reason text when the reason is empty", () => {
    const text = notificationText("degraded", "Gallery", "");
    expect(text.body).toContain("Gallery responds but is degraded. Reason: ");
    expect(text.body).not.toMatch(/Reason: $/);
  });

  it("says the monitor is no longer degraded when it clears", () => {
    expect(notificationText("degraded_resolved", "Gallery", "ignored")).toEqual(
      {
        subject: "Gallery is no longer degraded",
        body: "Gallery is operational again.",
      },
    );
  });

  it.each([
    ["degraded", "unstable"],
    ["degraded_resolved", "up"],
    ["down", "down"],
    ["up", "up"],
    ["unstable", "unstable"],
  ] as const)("sends %s with the %s severity", (kind, severity) => {
    expect(alertSeverity(kind)).toBe(severity);
  });
});

describe("degraded alert delivery", () => {
  it.each(["degraded", "degraded_resolved"] as const)(
    "posts the %s event name to a generic webhook",
    async (kind) => {
      const { seen, fetchImpl } = capture();
      const result = await deliverChannel(
        { type: "webhook", config: { url: "https://ops.example/hook" } },
        { kind, monitorName: "Gallery", reason: "Degraded keyword was found" },
        { fetch: fetchImpl },
      );
      expect(result.ok).toBe(true);
      expect(seen[0]?.body).toMatchObject({
        event: kind,
        monitor: "Gallery",
        reason: "Degraded keyword was found",
      });
    },
  );

  it("gives ntfy the flapping priority for degraded and the recovery priority for the clear", async () => {
    const { seen, fetchImpl } = capture();
    const channel = {
      type: "ntfy" as const,
      config: { server: "https://ntfy.example", topic: "ops" },
    };
    await deliverChannel(
      channel,
      { kind: "degraded", monitorName: "Gallery", reason: "slow" },
      { fetch: fetchImpl },
    );
    await deliverChannel(
      channel,
      { kind: "degraded_resolved", monitorName: "Gallery", reason: "" },
      { fetch: fetchImpl },
    );
    expect(seen[0]?.body).toMatchObject({
      priority: 4,
      tags: ["warning"],
      title: "Gallery is degraded",
    });
    expect(seen[1]?.body).toMatchObject({
      priority: 3,
      tags: ["white_check_mark"],
      title: "Gallery is no longer degraded",
    });
  });

  it("queues the degraded subject for an email channel", async () => {
    const queued: { subject: string; text: string }[] = [];
    const result = await deliverChannel(
      { type: "email", config: { to: "ops@example.com" } },
      { kind: "degraded", monitorName: "Gallery", reason: "slow" },
      {
        enqueueEmail: async (input) => {
          queued.push(input);
        },
      },
    );
    expect(result.ok).toBe(true);
    expect(queued[0]).toMatchObject({
      subject: "Gallery is degraded",
      text: "Gallery responds but is degraded. Reason: slow",
    });
  });
});
