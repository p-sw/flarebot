// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import {
  FREE_PLAN_SUBSCRIPTION,
  isNonPublicIp,
  rateBucket,
  renderAtom,
  renderRss,
  SUBSCRIPTION_DRAIN_BATCH,
  signBody,
  subscriberWantsEvent,
  webhookUrlIssue,
} from "./subscriptions";

describe("webhook addresses", () => {
  it("blocks private, loopback, link-local, and plaintext http", () => {
    expect(webhookUrlIssue("http://example.com/hook", false).ok).toBe(false);
    expect(webhookUrlIssue("https://example.com/hook", false)).toMatchObject({
      ok: true,
    });
    expect(webhookUrlIssue("http://example.com/hook", true)).toMatchObject({
      ok: true,
    });
    for (const raw of [
      "https://127.0.0.1/hook",
      "https://10.1.2.3/hook",
      "https://192.168.1.20/hook",
      "https://172.16.4.4/hook",
      "https://169.254.169.254/latest",
      "https://[::1]/hook",
      "https://[fe80::1]/hook",
      "https://[fd00::1]/hook",
      "https://localhost/hook",
      "https://metadata.google.internal/hook",
      "https://2130706433/hook",
      "https://user:pass@example.com/hook",
      "ftp://example.com/hook",
    ]) {
      expect(webhookUrlIssue(raw, true).ok, raw).toBe(false);
    }
    expect(isNonPublicIp("8.8.8.8")).toBe(false);
    expect(isNonPublicIp("::ffff:127.0.0.1")).toBe(true);
  });
});

describe("subscriber matching", () => {
  it("follows every monitor unless the visitor picked a subset", () => {
    expect(subscriberWantsEvent(true, [], ["m1"])).toBe(true);
    expect(subscriberWantsEvent(false, ["m2"], ["m1"])).toBe(false);
    expect(subscriberWantsEvent(false, ["m1", "m2"], ["m2"])).toBe(true);
    expect(subscriberWantsEvent(false, ["m1"], [])).toBe(false);
  });
});

describe("feeds", () => {
  it("escapes titles and points at the status page", () => {
    const rss = renderRss({
      title: "Status & more",
      description: "Public",
      pageUrl: "https://status.example/s/main",
      selfUrl: "https://status.example/s/main/feed.rss",
      items: [
        {
          id: "evt-1",
          title: "API <down>",
          summary: "Looking & waiting",
          href: "/s/main/incidents/evt-1",
          occurredAt: Date.UTC(2026, 0, 2, 3, 4, 5),
        },
      ],
    });
    expect(rss).toContain("Status &amp; more");
    expect(rss).toContain("API &lt;down&gt;");
    expect(rss).toContain("https://status.example/s/main/incidents/evt-1");
    const atom = renderAtom({
      title: "Status",
      pageUrl: "https://status.example/s/main",
      selfUrl: "https://status.example/s/main/feed.atom",
      items: [],
    });
    expect(atom).toContain("http://www.w3.org/2005/Atom");
  });
});

describe("free-plan delivery math", () => {
  it("stays inside the cron, subrequest, and D1 write budgets", () => {
    expect(FREE_PLAN_SUBSCRIPTION.deliveriesPerDay).toBe(1728);
    expect(FREE_PLAN_SUBSCRIPTION.drainPerRun).toBe(SUBSCRIPTION_DRAIN_BATCH);
    expect(
      FREE_PLAN_SUBSCRIPTION.webhookSubrequestsPerRun +
        FREE_PLAN_SUBSCRIPTION.mailKicksPerRun +
        FREE_PLAN_SUBSCRIPTION.announcementDrainSubrequests,
    ).toBeLessThan(FREE_PLAN_SUBSCRIPTION.subrequestBudget);
    expect(FREE_PLAN_SUBSCRIPTION.d1WritesPerFullDay).toBeLessThan(100_000);
    const hour = Date.UTC(2026, 4, 1, 2, 15);
    const first = rateBucket("ip", "abc", hour);
    const later = rateBucket("ip", "abc", hour + 10 * 60_000);
    expect(first.bucket).toBe(later.bucket);
    expect(rateBucket("ip", "abc", hour + 60 * 60_000).bucket).not.toBe(
      first.bucket,
    );
  });

  it("signs the timestamp and body together", async () => {
    const mac = await signBody("secret", "100", '{"ok":true}');
    expect(mac).toHaveLength(64);
    expect(mac).not.toBe(await signBody("other", "100", '{"ok":true}'));
  });
});
