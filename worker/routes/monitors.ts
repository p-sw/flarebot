// SPDX-License-Identifier: MIT

import { and, desc, eq, gte } from "drizzle-orm";
import type { Hono } from "hono";
import { t } from "../../shared/copy";
import {
  DAY_MS,
  firstRetainedDay,
  HOUR_MS,
  retentionCutoff,
} from "../../shared/history";
import { monitorTargetLabel } from "../../shared/monitor-draft";
import {
  monitorTargetKey,
  nextCheckAfterEdit,
} from "../../shared/monitor-schedule";
import { visibleStatus } from "../../shared/monitor-status";
import { can } from "../../shared/permissions";
import { monitorWriteSchema, parseMonitorConfig } from "../../shared/schemas";
import { sha256Hex } from "../crypto/secret";
import { getDb } from "../db/client";
import {
  monitorChannels,
  monitorState,
  monitors,
  outages,
  statusPageItems,
  statusPages,
  uptimeDaily,
  uptimeHourly,
} from "../db/schema";
import {
  ApiError,
  type AppContext,
  type AppEnv,
  assertMutationOrigin,
  audit,
  clientIp,
  parseBody,
  requestOrigin,
  requireActor,
  requireCan,
} from "../http";
import {
  assignShard,
  issueHeartbeatToken,
  revealHeartbeatToken,
  runInitialCheck,
  schedulerStub,
  snapshotFromRow,
} from "../monitors/sync";
import { historyRetentionDays } from "../retention";
import { percentile, saveRuntime } from "../scheduler/persist";
import {
  initialState,
  type RuntimeState,
  runtimeForPause,
} from "../scheduler/state-machine";

function percent(ok: number, fail: number): number | null {
  const total = ok + fail;
  if (total === 0) return null;
  return Math.round((ok / total) * 1000) / 10;
}

async function liveByShard(env: Env, shardIds: string[]) {
  const map = new Map<
    string,
    Awaited<ReturnType<ReturnType<typeof schedulerStub>["getAll"]>>[number]
  >();
  for (const shardId of [...new Set(shardIds)]) {
    const rows = await schedulerStub(env, shardId)
      .getAll()
      .catch(() => []);
    for (const row of rows) map.set(row.id, row);
  }
  return map;
}

export function registerMonitors(app: Hono<AppEnv>): void {
  app.get("/api/monitors", async (c) => {
    const actor = await requireActor(c);
    requireCan(actor, "monitors.read");
    const db = getDb(c.env.DB);
    const rows = await db
      .select()
      .from(monitors)
      .where(eq(monitors.organizationId, actor.organizationId));
    const states = await db.select().from(monitorState);
    const stateById = new Map(states.map((row) => [row.monitorId, row]));
    const links = await db.select().from(monitorChannels);
    const live = await liveByShard(
      c.env,
      rows.map((row) => row.shardId),
    );
    const since = Date.now() - 86_400_000;
    const hourly = await db
      .select()
      .from(uptimeHourly)
      .where(gte(uptimeHourly.hourStart, since));
    const showPush = can(actor, "monitors.write");
    const items = [];
    for (const row of rows) {
      const runtime = stateById.get(row.id);
      const memory = live.get(row.id);
      let ok = hourly
        .filter((item) => item.monitorId === row.id)
        .reduce((sum, item) => sum + item.okCount, 0);
      let fail = hourly
        .filter((item) => item.monitorId === row.id)
        .reduce((sum, item) => sum + item.failCount, 0);
      if (memory?.rollup && memory.rollup.hourStart >= since) {
        ok += memory.rollup.ok;
        fail += memory.rollup.fail;
      }
      let pushUrl: string | undefined;
      if (showPush && row.pushTokenEncrypted) {
        const token = await revealHeartbeatToken(c.env, row.pushTokenEncrypted);
        if (token) pushUrl = `${requestOrigin(c)}/push/${token}`;
      }
      items.push({
        id: row.id,
        name: row.name,
        type: row.type,
        paused: row.paused,
        intervalSeconds: row.intervalSeconds,
        target: targetOf(row.type, row.configJson),
        status: visibleStatus(
          row.paused,
          memory?.state.status ?? runtime?.status,
        ),
        since: runtime?.since ?? null,
        lastResponseMs:
          memory?.state.lastResponseMs ?? runtime?.lastResponseMs ?? null,
        lastCheckAt: memory?.state.lastCheckAt ?? runtime?.lastCheckAt ?? null,
        lastError: memory?.state.lastError ?? runtime?.lastError ?? null,
        uptime24: percent(ok, fail),
        pushUrl,
        channelIds: links
          .filter((link) => link.monitorId === row.id)
          .map((link) => link.channelId),
      });
    }
    items.sort((a, b) => a.name.localeCompare(b.name));
    return c.json({ monitors: items });
  });

  app.post("/api/monitors", async (c) => {
    const actor = await requireActor(c);
    assertMutationOrigin(c, actor);
    requireCan(actor, "monitors.write");
    const body = await parseBody(c, monitorWriteSchema);
    const parsed = parseMonitorConfig(body.type, body.config);
    if (!parsed.success)
      throw new ApiError(400, "validation", t("error_invalid_monitor"));
    const db = getDb(c.env.DB);
    await assertChannels(c.env, actor.organizationId, body.channelIds);
    const now = Date.now();
    const id = crypto.randomUUID();
    const shardId = await assignShard(
      c.env,
      body.intervalSeconds,
      body.timeoutSeconds,
    );
    const heartbeat =
      body.type === "heartbeat" ? await issueHeartbeatToken(c.env) : null;
    await db.insert(monitors).values({
      id,
      organizationId: actor.organizationId,
      name: body.name,
      type: body.type,
      configJson: JSON.stringify(parsed.data),
      intervalSeconds: body.intervalSeconds,
      timeoutSeconds: body.timeoutSeconds,
      retries: body.retries,
      recoveryThreshold: body.recoveryThreshold,
      regionsJson: JSON.stringify(["default"]),
      shardId,
      paused: body.paused,
      badgesEnabled: false,
      pushTokenHash: heartbeat?.hash ?? null,
      pushTokenEncrypted: heartbeat?.encrypted ?? null,
      createdAt: now,
      updatedAt: now,
    });
    for (const channelId of body.channelIds) {
      await db.insert(monitorChannels).values({ monitorId: id, channelId });
    }
    const row = await db
      .select()
      .from(monitors)
      .where(eq(monitors.id, id))
      .get();
    if (!row)
      throw new ApiError(500, "internal", t("error_monitor_not_stored"));
    if (body.paused) {
      const state = { ...initialState(now), status: "paused" as const };
      await saveRuntime(c.env.DB, id, state);
      await schedulerStub(c.env, shardId).upsert(
        snapshotFromRow(row, state, now + 365 * 86_400_000, null),
      );
    } else {
      await runInitialCheck(c.env, row, null);
    }
    await audit(
      c.env,
      actor,
      "monitor.create",
      id,
      null,
      { name: body.name, type: body.type },
      clientIp(c),
    );
    const pushUrl = heartbeat
      ? `${requestOrigin(c)}/push/${heartbeat.token}`
      : undefined;
    return c.json({ id, pushUrl }, 201);
  });

  app.get("/api/monitors/:id", async (c) => {
    const actor = await requireActor(c);
    requireCan(actor, "monitors.read");
    return c.json(
      await readMonitor(
        c,
        actor.organizationId,
        c.req.param("id"),
        can(actor, "monitors.write"),
      ),
    );
  });

  app.patch("/api/monitors/:id", async (c) => {
    const actor = await requireActor(c);
    assertMutationOrigin(c, actor);
    requireCan(actor, "monitors.write");
    const current = await ownedMonitor(
      c.env,
      actor.organizationId,
      c.req.param("id"),
    );
    const raw = await c.req.json().catch(() => null);
    if (isPauseOnly(raw)) {
      const db = getDb(c.env.DB);
      await db
        .update(monitors)
        .set({ paused: raw.paused, updatedAt: Date.now() })
        .where(eq(monitors.id, current.id));
      const row = await db
        .select()
        .from(monitors)
        .where(eq(monitors.id, current.id))
        .get();
      if (!row)
        throw new ApiError(500, "internal", t("error_monitor_not_stored"));
      await scheduleMonitor(c.env, row);
      await audit(
        c.env,
        actor,
        "monitor.update",
        row.id,
        { paused: current.paused },
        { paused: row.paused },
        clientIp(c),
      );
      return c.json(
        await readMonitor(
          c,
          actor.organizationId,
          row.id,
          can(actor, "monitors.write"),
        ),
      );
    }
    const parsedBody = monitorWriteSchema.safeParse(raw);
    if (!parsedBody.success)
      throw new ApiError(400, "validation", t("error_validation"));
    const body = parsedBody.data;
    const parsed = parseMonitorConfig(body.type, body.config);
    if (!parsed.success)
      throw new ApiError(400, "validation", t("error_invalid_monitor"));
    await assertChannels(c.env, actor.organizationId, body.channelIds);
    const db = getDb(c.env.DB);
    let pushHash = current.pushTokenHash;
    let pushEncrypted = current.pushTokenEncrypted;
    let freshToken: string | undefined;
    if (body.type === "heartbeat" && !pushEncrypted) {
      const issued = await issueHeartbeatToken(c.env);
      pushHash = issued.hash;
      pushEncrypted = issued.encrypted;
      freshToken = issued.token;
    }
    if (body.type !== "heartbeat") {
      pushHash = null;
      pushEncrypted = null;
    }
    await db
      .update(monitors)
      .set({
        name: body.name,
        type: body.type,
        configJson: JSON.stringify(parsed.data),
        intervalSeconds: body.intervalSeconds,
        timeoutSeconds: body.timeoutSeconds,
        retries: body.retries,
        recoveryThreshold: body.recoveryThreshold,
        paused: body.paused,
        pushTokenHash: pushHash,
        pushTokenEncrypted: pushEncrypted,
        updatedAt: Date.now(),
      })
      .where(eq(monitors.id, current.id));
    await db
      .delete(monitorChannels)
      .where(eq(monitorChannels.monitorId, current.id));
    for (const channelId of body.channelIds) {
      await db
        .insert(monitorChannels)
        .values({ monitorId: current.id, channelId });
    }
    const row = await db
      .select()
      .from(monitors)
      .where(eq(monitors.id, current.id))
      .get();
    if (!row)
      throw new ApiError(500, "internal", t("error_monitor_not_stored"));
    await rescheduleAfterEdit(c.env, row, current);
    await audit(
      c.env,
      actor,
      "monitor.update",
      row.id,
      { name: current.name, paused: current.paused },
      { name: body.name, paused: row.paused },
      clientIp(c),
    );
    return c.json(
      await readMonitor(
        c,
        actor.organizationId,
        row.id,
        can(actor, "monitors.write"),
        freshToken,
      ),
    );
  });

  app.delete("/api/monitors/:id", async (c) => {
    const actor = await requireActor(c);
    assertMutationOrigin(c, actor);
    requireCan(actor, "monitors.write");
    const row = await ownedMonitor(
      c.env,
      actor.organizationId,
      c.req.param("id"),
    );
    await schedulerStub(c.env, row.shardId)
      .remove(row.id)
      .catch(() => undefined);
    await getDb(c.env.DB).delete(monitors).where(eq(monitors.id, row.id));
    await audit(
      c.env,
      actor,
      "monitor.delete",
      row.id,
      { name: row.name },
      null,
      clientIp(c),
    );
    return c.json({ ok: true });
  });

  app.get("/api/monitors/:id/stats", async (c) => {
    const actor = await requireActor(c);
    requireCan(actor, "monitors.read");
    const row = await ownedMonitor(
      c.env,
      actor.organizationId,
      c.req.param("id"),
    );
    const db = getDb(c.env.DB);
    const now = Date.now();
    const retentionDays = await historyRetentionDays(c.env);
    const retainedFrom = firstRetainedDay(retentionCutoff(now, retentionDays));
    const hourly = await db
      .select()
      .from(uptimeHourly)
      .where(
        and(
          eq(uptimeHourly.monitorId, row.id),
          gte(
            uptimeHourly.hourStart,
            Math.max(now - 48 * HOUR_MS, retainedFrom),
          ),
        ),
      );
    const daily = await db
      .select()
      .from(uptimeDaily)
      .where(
        and(
          eq(uptimeDaily.monitorId, row.id),
          gte(uptimeDaily.dayStart, Math.max(now - 90 * DAY_MS, retainedFrom)),
        ),
      );
    const live = await schedulerStub(c.env, row.shardId)
      .getOne(row.id)
      .catch(() => null);
    const samples = hourly.flatMap((item) => {
      try {
        return JSON.parse(item.samplesJson) as number[];
      } catch {
        return [];
      }
    });
    if (live?.rollup) samples.push(...live.rollup.samples);
    const sumRange = (
      rows: { okCount: number; failCount: number }[],
      extra?: { ok: number; fail: number },
    ) => {
      const ok =
        rows.reduce((sum, item) => sum + item.okCount, 0) + (extra?.ok ?? 0);
      const fail =
        rows.reduce((sum, item) => sum + item.failCount, 0) +
        (extra?.fail ?? 0);
      return percent(ok, fail);
    };
    const extra = live?.rollup
      ? { ok: live.rollup.ok, fail: live.rollup.fail }
      : undefined;
    const dayAgo = now - 86_400_000;
    const weekAgo = now - 7 * 86_400_000;
    return c.json({
      recent: live?.recent ?? [],
      retentionDays,
      uptime: {
        h24: sumRange(
          hourly.filter((item) => item.hourStart >= dayAgo),
          extra,
        ),
        d7: sumRange(
          [
            ...daily.filter((item) => item.dayStart >= weekAgo),
            ...hourly.filter((item) => item.hourStart >= weekAgo),
          ],
          extra,
        ),
        d30: sumRange(
          [
            ...daily.filter((item) => item.dayStart >= now - 30 * 86_400_000),
            ...hourly.filter((item) => item.hourStart >= now - 2 * 86_400_000),
          ],
          extra,
        ),
        d90: sumRange(
          [
            ...daily,
            ...hourly.filter((item) => item.hourStart >= now - 2 * 86_400_000),
          ],
          extra,
        ),
      },
      p95: percentile(samples, 95),
      hourly: hourly.map((item) => ({
        hourStart: item.hourStart,
        ok: item.okCount,
        fail: item.failCount,
        avg:
          item.okCount + item.failCount === 0
            ? 0
            : Math.round(item.latencySum / (item.okCount + item.failCount)),
      })),
    });
  });

  app.get("/api/monitors/:id/outages", async (c) => {
    const actor = await requireActor(c);
    requireCan(actor, "outages.read");
    const row = await ownedMonitor(
      c.env,
      actor.organizationId,
      c.req.param("id"),
    );
    const rows = await getDb(c.env.DB)
      .select()
      .from(outages)
      .where(eq(outages.monitorId, row.id))
      .orderBy(desc(outages.startedAt))
      .limit(50);
    return c.json({ outages: rows });
  });

  app.post("/api/outages/:id/ack", async (c) => {
    const actor = await requireActor(c);
    assertMutationOrigin(c, actor);
    requireCan(actor, "outages.ack");
    const db = getDb(c.env.DB);
    const outage = await db
      .select()
      .from(outages)
      .where(eq(outages.id, c.req.param("id")))
      .get();
    if (!outage)
      throw new ApiError(404, "not_found", t("error_outage_not_found"));
    await ownedMonitor(c.env, actor.organizationId, outage.monitorId);
    await db
      .update(outages)
      .set({ acknowledgedBy: actor.userId, acknowledgedAt: Date.now() })
      .where(eq(outages.id, outage.id));
    await audit(c.env, actor, "outage.ack", outage.id, null, null, clientIp(c));
    return c.json({ ok: true });
  });

  app.post("/push/:token", (c) => acceptPush(c));
  app.get("/push/:token", (c) => acceptPush(c));
}

async function acceptPush(c: AppContext): Promise<Response> {
  const token = c.req.param("token") ?? "";
  const db = getDb(c.env.DB);
  const row = await db
    .select()
    .from(monitors)
    .where(eq(monitors.pushTokenHash, await sha256Hex(token)))
    .get();
  if (row?.type !== "heartbeat")
    return c.json(
      { error: { code: "not_found", message: "Unknown heartbeat." } },
      404,
    );
  if (row.paused)
    return c.json(
      { error: { code: "paused", message: "This monitor is paused." } },
      409,
    );
  const ok = await schedulerStub(c.env, row.shardId).recordPush(
    row.id,
    Date.now(),
  );
  if (!ok)
    return c.json(
      {
        error: {
          code: "not_ready",
          message: "The scheduler has not loaded this monitor yet.",
        },
      },
      503,
    );
  return c.json({ ok: true });
}

function isPauseOnly(value: unknown): value is { paused: boolean } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === 1 &&
    Object.hasOwn(record, "paused") &&
    typeof record.paused === "boolean"
  );
}

async function scheduleMonitor(
  env: Env,
  row: typeof monitors.$inferSelect,
): Promise<void> {
  const db = getDb(env.DB);
  const live = await schedulerStub(env, row.shardId)
    .getOne(row.id)
    .catch(() => null);
  const stored = await db
    .select()
    .from(monitorState)
    .where(eq(monitorState.monitorId, row.id))
    .get();
  const now = Date.now();
  const normalized = runtimeForPause(
    runtimeFrom(live?.state, stored),
    row.paused,
    now,
  );
  await saveRuntime(env.DB, row.id, normalized);
  await schedulerStub(env, row.shardId).upsert(
    snapshotFromRow(
      row,
      normalized,
      row.paused ? now + 365 * 86_400_000 : now,
      live?.lastPushAt ?? null,
    ),
  );
}

async function rescheduleAfterEdit(
  env: Env,
  row: typeof monitors.$inferSelect,
  previous: typeof monitors.$inferSelect,
): Promise<void> {
  const db = getDb(env.DB);
  const live = await schedulerStub(env, row.shardId)
    .getOne(row.id)
    .catch(() => null);
  const stored = await db
    .select()
    .from(monitorState)
    .where(eq(monitorState.monitorId, row.id))
    .get();
  const now = Date.now();
  const normalized = runtimeForPause(
    runtimeFrom(live?.state, stored),
    row.paused,
    now,
  );
  const nextCheckAt = nextCheckAfterEdit({
    now,
    paused: row.paused,
    wasPaused: previous.paused,
    intervalMs: row.intervalSeconds * 1000,
    previousIntervalMs: previous.intervalSeconds * 1000,
    previousNextCheckAt: live?.nextCheckAt ?? null,
    previousTarget: monitorTargetKey(
      previous.type,
      JSON.parse(previous.configJson) as unknown,
    ),
    nextTarget: monitorTargetKey(
      row.type,
      JSON.parse(row.configJson) as unknown,
    ),
  });
  await saveRuntime(env.DB, row.id, normalized);
  await schedulerStub(env, row.shardId).upsert(
    snapshotFromRow(row, normalized, nextCheckAt, live?.lastPushAt ?? null),
  );
}

export async function readMonitor(
  c: AppContext,
  organizationId: string,
  id: string,
  showPush: boolean,
  freshToken?: string,
) {
  const row = await ownedMonitor(c.env, organizationId, id);
  const db = getDb(c.env.DB);
  const state = await db
    .select()
    .from(monitorState)
    .where(eq(monitorState.monitorId, row.id))
    .get();
  const links = await db
    .select()
    .from(monitorChannels)
    .where(eq(monitorChannels.monitorId, row.id));
  const pages = await db
    .select({
      id: statusPages.id,
      title: statusPages.title,
      slug: statusPages.slug,
      published: statusPages.published,
      serveAtRoot: statusPages.serveAtRoot,
    })
    .from(statusPageItems)
    .innerJoin(statusPages, eq(statusPageItems.pageId, statusPages.id))
    .where(
      and(
        eq(statusPageItems.monitorId, row.id),
        eq(statusPages.organizationId, organizationId),
      ),
    );
  pages.sort((left, right) => left.title.localeCompare(right.title));
  const live = await schedulerStub(c.env, row.shardId)
    .getOne(row.id)
    .catch(() => null);
  let pushUrl: string | undefined;
  if (freshToken) pushUrl = `${requestOrigin(c)}/push/${freshToken}`;
  else if (showPush) {
    const token = await revealHeartbeatToken(c.env, row.pushTokenEncrypted);
    if (token) pushUrl = `${requestOrigin(c)}/push/${token}`;
  }
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    config: JSON.parse(row.configJson) as unknown,
    intervalSeconds: row.intervalSeconds,
    timeoutSeconds: row.timeoutSeconds,
    retries: row.retries,
    recoveryThreshold: row.recoveryThreshold,
    paused: row.paused,
    regions: JSON.parse(row.regionsJson) as string[],
    status: visibleStatus(row.paused, live?.state.status ?? state?.status),
    since: state?.since ?? live?.state.statusSince ?? null,
    lastResponseMs: live?.state.lastResponseMs ?? state?.lastResponseMs ?? null,
    lastCheckAt: live?.state.lastCheckAt ?? state?.lastCheckAt ?? null,
    lastError: live?.state.lastError ?? state?.lastError ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    target: targetOf(row.type, row.configJson),
    pushUrl,
    channelIds: links.map((link) => link.channelId),
    statusPages: pages,
    badgesEnabled: row.badgesEnabled,
    badgesPublic: row.badgesEnabled || pages.some((page) => page.published),
  };
}

function targetOf(type: string, configJson: string): string {
  try {
    return monitorTargetLabel(type, JSON.parse(configJson) as unknown);
  } catch {
    return "";
  }
}

function runtimeFrom(
  live: RuntimeState | undefined,
  stored: typeof monitorState.$inferSelect | undefined,
): RuntimeState {
  const base: RuntimeState = live
    ? { ...live, transitions: [...live.transitions] }
    : stored
      ? {
          status: stored.status as RuntimeState["status"],
          consecutiveFailures: stored.consecutiveFailures,
          consecutiveSuccesses: stored.consecutiveSuccesses,
          transitions: [],
          flappingNotified: stored.flapping,
          lastResponseMs: stored.lastResponseMs,
          statusSince: stored.since,
          lastCheckAt: stored.lastCheckAt,
          lastError: stored.lastError,
        }
      : initialState(Date.now());
  return base;
}

export async function ownedMonitor(
  env: Env,
  organizationId: string,
  id: string,
) {
  const row = await getDb(env.DB)
    .select()
    .from(monitors)
    .where(
      and(eq(monitors.id, id), eq(monitors.organizationId, organizationId)),
    )
    .get();
  if (!row) throw new ApiError(404, "not_found", t("error_monitor_not_found"));
  return row;
}

async function assertChannels(env: Env, organizationId: string, ids: string[]) {
  if (ids.length === 0) return;
  const { notificationChannels } = await import("../db/schema");
  const rows = await getDb(env.DB)
    .select()
    .from(notificationChannels)
    .where(eq(notificationChannels.organizationId, organizationId));
  const known = new Set(rows.map((row) => row.id));
  if (ids.some((id) => !known.has(id)))
    throw new ApiError(400, "validation", t("error_unknown_channel"));
}
