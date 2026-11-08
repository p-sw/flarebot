// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import {
  BADGE_COLOR_ORANGE,
  badgeStatusFromRuntime,
  statusColor,
} from "./badge";
import {
  barState,
  DAY_MS,
  fitBars,
  HOUR_MS,
  resolveWindow,
  SLOT_MS,
  summarizeHistory,
  utcDayStart,
} from "./history";
import { announcedStatus, pageOverall, presentStatus } from "./impact";
import {
  blankMonitorDraft,
  draftFromMonitor,
  monitorFieldErrors,
  monitorPayload,
} from "./monitor-draft";
import { visibleStatus } from "./monitor-status";
import {
  httpConfigSchema,
  JSON_PATH_SYNTAX_ISSUE,
  monitorWriteSchema,
} from "./schemas";

const now = Date.UTC(2026, 0, 15, 12, 30, 0);

function http(degraded: unknown) {
  return httpConfigSchema.safeParse({
    url: "https://example.com/health",
    degraded,
  });
}

function issues(degraded: unknown) {
  const parsed = http(degraded);
  if (parsed.success) return [];
  return parsed.error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

describe("degraded config schema", () => {
  it("fills keyword mode and alerts when only a condition is given", () => {
    const parsed = http({ keyword: "slow" });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.degraded).toEqual({
      keyword: "slow",
      keywordMode: "present",
      notify: true,
    });
  });

  it("keeps the HTTP config valid without a degraded block", () => {
    const parsed = http(undefined);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.degraded).toBeUndefined();
  });

  it.each(["$.status", "$.items[0].ok", "$['a.b']", "$"])(
    "accepts the supported JSON path %j",
    (jsonPath) => {
      expect(issues({ jsonPath, jsonExpect: "degraded" })).toEqual([]);
    },
  );

  it.each(["status", "$.", "$..status", "$.items[*]", "   "])(
    "rejects the JSON path %j with the syntax issue",
    (jsonPath) => {
      expect(issues({ jsonPath, jsonExpect: "degraded" })).toEqual([
        { path: "degraded.jsonPath", message: JSON_PATH_SYNTAX_ISSUE },
      ]);
    },
  );

  it("lets an empty JSON path through as no JSON condition", () => {
    expect(issues({ jsonPath: "", keyword: "slow" })).toEqual([]);
  });

  it("requires an expected value with a JSON path", () => {
    expect(issues({ jsonPath: "$.status" })).toEqual([
      {
        path: "degraded.jsonExpect",
        message: "A degraded JSON path needs an expected value.",
      },
    ]);
  });

  it("requires a JSON path with an expected value", () => {
    expect(issues({ jsonExpect: "degraded" })).toEqual([
      {
        path: "degraded.jsonPath",
        message: "A degraded JSON value needs a path.",
      },
    ]);
    expect(issues({ jsonPath: "", jsonExpect: "degraded" })).toHaveLength(1);
  });

  it("accepts an empty expected value with a path", () => {
    expect(issues({ jsonPath: "$.note", jsonExpect: "" })).toEqual([]);
  });

  it.each([
    [1, true],
    [30_000, true],
    [0, false],
    [30_001, false],
    [1.5, false],
    [-5, false],
  ])("treats a %d ms limit as valid=%s", (maxResponseMs, valid) => {
    expect(http({ maxResponseMs }).success).toBe(valid);
  });

  it("caps the degraded keyword and expected value lengths", () => {
    expect(http({ keyword: "k".repeat(500) }).success).toBe(true);
    expect(http({ keyword: "k".repeat(501) }).success).toBe(false);
    expect(http({ jsonPath: "$.a", jsonExpect: "v".repeat(501) }).success).toBe(
      false,
    );
    expect(
      http({ jsonPath: `$.${"a".repeat(199)}`, jsonExpect: "x" }).success,
    ).toBe(false);
  });

  it("rejects an unknown keyword mode", () => {
    expect(http({ keyword: "slow", keywordMode: "maybe" }).success).toBe(false);
  });

  it("does not syntax-check the health JSON path", () => {
    const parsed = httpConfigSchema.safeParse({
      url: "https://example.com/health",
      jsonPath: "status",
    });
    expect(parsed.success).toBe(true);
  });
});

describe("degraded monitor draft", () => {
  function httpDraft(
    extra: Partial<ReturnType<typeof blankMonitorDraft>> = {},
  ) {
    return {
      ...blankMonitorDraft(),
      name: "Gallery",
      type: "http" as const,
      url: "https://example.com/api/status/proxy",
      ...extra,
    };
  }

  it("round-trips every degraded field through the form", () => {
    const degraded = {
      keyword: "slow",
      keywordMode: "absent",
      jsonPath: "$.status",
      jsonExpect: "degraded",
      maxResponseMs: 1500,
      notify: false,
    };
    const draft = draftFromMonitor({
      name: "Gallery",
      type: "http",
      paused: false,
      intervalSeconds: 60,
      timeoutSeconds: 10,
      retries: 2,
      recoveryThreshold: 1,
      channelIds: [],
      config: { url: "https://example.com/health", degraded },
    });
    expect(draft).toMatchObject({
      degradedKeyword: "slow",
      degradedKeywordMode: "absent",
      degradedJsonPath: "$.status",
      degradedJsonExpect: "degraded",
      degradedMaxMs: "1500",
      degradedNotify: false,
    });
    const payload = monitorPayload(draft);
    expect(monitorWriteSchema.safeParse(payload).success).toBe(true);
    expect((payload.config as { degraded: unknown }).degraded).toEqual(
      degraded,
    );
  });

  it("reads a monitor without degraded conditions as blank with alerts on", () => {
    const draft = draftFromMonitor({
      name: "Plain",
      type: "http",
      paused: false,
      intervalSeconds: 60,
      timeoutSeconds: 10,
      retries: 2,
      recoveryThreshold: 1,
      channelIds: [],
      config: { url: "https://example.com" },
    });
    expect(draft).toMatchObject({
      degradedKeyword: "",
      degradedKeywordMode: "present",
      degradedJsonPath: "",
      degradedJsonExpect: "",
      degradedMaxMs: "",
      degradedNotify: true,
    });
  });

  it("stores no degraded block when every condition is blank", () => {
    const payload = monitorPayload(
      httpDraft({ degradedNotify: false, degradedKeywordMode: "absent" }),
    );
    expect(payload.config).not.toHaveProperty("degraded");
  });

  it("trims the degraded fields and drops whitespace-only ones", () => {
    const payload = monitorPayload(
      httpDraft({
        degradedKeyword: "  slow  ",
        degradedJsonPath: "   ",
        degradedJsonExpect: "",
        degradedMaxMs: " 250 ",
      }),
    );
    expect((payload.config as { degraded: unknown }).degraded).toEqual({
      keyword: "slow",
      keywordMode: "present",
      maxResponseMs: 250,
      notify: true,
    });
  });

  it.each([
    ["status", "json_path"],
    ["$..status", "json_path"],
  ])("maps the degraded JSON path %j to the %s error", (path, code) => {
    const errors = monitorFieldErrors(
      httpDraft({ degradedJsonPath: path, degradedJsonExpect: "degraded" }),
    );
    expect(errors.degradedJsonPath).toBe(code);
  });

  it("maps a degraded path without an expected value to the JSON error", () => {
    const errors = monitorFieldErrors(
      httpDraft({ degradedJsonPath: "$.status" }),
    );
    expect(errors.degradedJsonExpect).toBe("json");
    expect(errors.degradedJsonPath).toBeUndefined();
  });

  it.each(["0", "30001", "1.5", "fast"])(
    "maps the degraded limit %j to the degraded_ms error",
    (value) => {
      expect(
        monitorFieldErrors(httpDraft({ degradedMaxMs: value })).degradedMaxMs,
      ).toBe("degraded_ms");
    },
  );

  it("accepts a valid degraded draft without errors", () => {
    expect(
      monitorFieldErrors(
        httpDraft({
          degradedJsonPath: "$.status",
          degradedJsonExpect: "degraded",
          degradedMaxMs: "30000",
        }),
      ),
    ).toEqual({});
  });

  it("keeps the health JSON error code for the health path", () => {
    const errors = monitorFieldErrors(
      httpDraft({ jsonPath: "$.ok", jsonExpect: "v".repeat(501) }),
    );
    expect(errors.jsonExpect).toBe("json");
  });
});

describe("degraded history bars", () => {
  it.each([
    [[10, 0, 0, 0], "up"],
    [[10, 0, 0, 1], "degraded"],
    [[99, 1, 0, 0], "up"],
    [[99, 1, 0, 3], "degraded"],
    [[95, 5, 0, 0], "degraded"],
    [[80, 20, 0, 5], "down"],
    [[0, 0, 3, 0], "maintenance"],
    [[0, 0, 0, 0], "empty"],
  ] as const)("counts %j as %s", ([ok, fail, maint, degraded], state) => {
    expect(barState(ok, fail, maint, degraded)).toBe(state);
  });

  it("leaves uptime at 100% when every check was degraded", () => {
    const window = resolveWindow("24h", 90, now);
    const hour = Math.floor(now / HOUR_MS) * HOUR_MS;
    const summary = summarizeHistory({
      window,
      now,
      daily: [],
      hourly: [{ start: hour, ok: 12, fail: 0, sum: 1200, degraded: 12 }],
      live: null,
    });
    expect(summary.uptime).toBe(100);
    const bar = summary.bars.find((item) => item.start === hour);
    expect(bar).toMatchObject({ uptime: 100, state: "degraded" });
  });

  it("paints only the slot that held the degraded check", () => {
    const window = resolveWindow("24h", 90, now);
    const slot = Math.floor(now / SLOT_MS) * SLOT_MS;
    const summary = summarizeHistory({
      window,
      now,
      daily: [],
      hourly: [],
      slots: [
        { start: slot - SLOT_MS, ok: 15, fail: 0, sum: 150, degraded: 0 },
        { start: slot, ok: 15, fail: 0, sum: 150, degraded: 1 },
      ],
      live: null,
    });
    const quiet = summary.bars.find((item) => item.start === slot - SLOT_MS);
    const marked = summary.bars.find((item) => item.start === slot);
    expect(quiet).toMatchObject({ state: "up", degraded: 0 });
    expect(marked).toMatchObject({ state: "degraded", degraded: 1 });
  });

  it("adds the open slot and hour from the shard", () => {
    const window = resolveWindow("24h", 90, now);
    const slot = Math.floor(now / SLOT_MS) * SLOT_MS;
    const summary = summarizeHistory({
      window,
      now,
      daily: [],
      hourly: [],
      slots: [],
      live: {
        start: Math.floor(now / HOUR_MS) * HOUR_MS,
        ok: 3,
        fail: 0,
        sum: 30,
        degraded: 2,
      },
      liveSlot: { start: slot, ok: 3, fail: 0, sum: 30, degraded: 2 },
    });
    expect(summary.bars.find((item) => item.start === slot)?.state).toBe(
      "degraded",
    );
  });

  it.each(["7d", "30d"] as const)(
    "reads degraded counts from closed days in the %s range",
    (range) => {
      const window = resolveWindow(range, 90, now);
      const yesterday = utcDayStart(now) - DAY_MS;
      const summary = summarizeHistory({
        window,
        now,
        daily: [
          { start: yesterday, ok: 1440, fail: 0, sum: 1440, degraded: 30 },
          {
            start: yesterday - DAY_MS,
            ok: 1440,
            fail: 0,
            sum: 1440,
            degraded: 0,
          },
        ],
        hourly: [],
        live: null,
      });
      expect(summary.uptime).toBe(100);
      const states = summary.bars
        .filter((bar) => bar.uptime !== null)
        .map((bar) => [
          bar.start < yesterday ? "before" : "yesterday",
          bar.state,
        ]);
      expect(states).toContainEqual(["yesterday", "degraded"]);
      expect(states).toContainEqual(["before", "up"]);
      expect(states).not.toContainEqual(["before", "degraded"]);
    },
  );

  // Known gap, reported with this test. Decision 55 paints a bar yellow when
  // it holds a degraded check. For a closed day the 7d and 30d views spread
  // the daily row over every bar of that day, so one degraded check paints
  // the whole day, even though hourly rows say which bar held it.
  it.fails("paints only the 7d bar that held a degraded check on a closed day", () => {
    const window = resolveWindow("7d", 90, now);
    const yesterday = utcDayStart(now) - DAY_MS;
    const hourly = Array.from({ length: 24 }, (_, hour) => ({
      start: yesterday + hour * HOUR_MS,
      ok: 60,
      fail: 0,
      sum: 600,
      degraded: hour === 3 ? 1 : 0,
    }));
    const summary = summarizeHistory({
      window,
      now,
      daily: [
        { start: yesterday, ok: 1440, fail: 0, sum: 14_400, degraded: 1 },
      ],
      hourly,
      live: null,
    });
    const day = summary.bars.filter(
      (bar) => bar.start >= yesterday && bar.start < yesterday + DAY_MS,
    );
    expect(day.filter((bar) => bar.state === "degraded")).toHaveLength(1);
  });

  it("keeps the degraded count when bars are merged for a narrow screen", () => {
    const window = resolveWindow("24h", 90, now);
    const slot = Math.floor(now / SLOT_MS) * SLOT_MS;
    const summary = summarizeHistory({
      window,
      now,
      daily: [],
      hourly: [],
      slots: [{ start: slot, ok: 15, fail: 0, sum: 150, degraded: 2 }],
      live: null,
    });
    const merged = fitBars(summary.bars, 24);
    expect(merged.reduce((total, bar) => total + (bar.degraded ?? 0), 0)).toBe(
      2,
    );
    expect(merged.filter((bar) => bar.state === "degraded")).toHaveLength(1);
  });
});

describe("degraded page status", () => {
  it("shows a live degraded check on the monitor row", () => {
    expect(visibleStatus(false, "degraded")).toBe("degraded");
    expect(
      presentStatus({
        paused: false,
        runtime: "degraded",
        impact: null,
        maintenance: false,
      }),
    ).toBe("degraded");
  });

  it.each([
    [
      { impact: "major_outage", maintenance: true, paused: true },
      "major_outage",
    ],
    [{ impact: null, maintenance: true, paused: true }, "maintenance"],
    [{ impact: null, maintenance: false, paused: true }, "paused"],
    [{ impact: null, maintenance: false, paused: false }, "up"],
  ] as const)("announces %j as %s", (input, status) => {
    expect(announcedStatus(input)).toBe(status);
  });

  it("keeps the page overall operational for live down and degraded checks", () => {
    const announced = [
      announcedStatus({ impact: null, maintenance: false, paused: false }),
      announcedStatus({ impact: null, maintenance: false, paused: false }),
    ];
    expect(pageOverall(announced)).toBe("operational");
  });
});

describe("degraded badge", () => {
  it("keeps the orange degraded badge for a live degraded check", () => {
    const status = badgeStatusFromRuntime(false, "degraded");
    expect(status).toBe("degraded");
    expect(statusColor(status)).toBe(BADGE_COLOR_ORANGE);
  });
});
