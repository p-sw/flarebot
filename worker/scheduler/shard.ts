// SPDX-License-Identifier: AGPL-3.0-only

import { DurableObject } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import type { MonitorType } from "../../shared/schemas";
import { runCheck } from "../checks/run";
import { decryptString } from "../crypto/secret";
import { getDb } from "../db/client";
import { monitorChannels, notificationChannels } from "../db/schema";
import { enqueueMail } from "../mail/mailer";
import { isInMaintenance } from "../maintenance";
import { type ChannelDelivery, deliverChannel } from "../notify/dispatch";
import { CHECK_CONCURRENCY, CHECKS_PER_ALARM } from "./capacity";
import {
  closeOutage,
  mergeHourly,
  openOutage,
  saveCert,
  saveRuntime,
} from "./persist";
import { applyOutcome, type RuntimeState } from "./state-machine";

export type Snapshot = {
  id: string;
  name: string;
  type: MonitorType;
  intervalMs: number;
  timeoutMs: number;
  retries: number;
  recoveryThreshold: number;
  config: unknown;
  paused: boolean;
  nextCheckAt: number;
  state: RuntimeState;
  lastPushAt: number | null;
  regions: string[];
};

type Point = { t: number; ok: boolean; ms: number };
type Rollup = {
  hourStart: number;
  ok: number;
  fail: number;
  sum: number;
  max: number;
  samples: number[];
};
type Store = {
  monitors: Record<string, Snapshot>;
  recent: Record<string, Point[]>;
  rollups: Record<string, Rollup>;
  flushedAt: number;
};

export class SchedulerShard extends DurableObject<Env> {
  async upsert(snapshot: Snapshot): Promise<void> {
    const store = await this.load();
    store.monitors[snapshot.id] = snapshot;
    await this.persist(store);
    await this.arm(store, Date.now());
  }

  async noteSample(
    id: string,
    sample: { t: number; ok: boolean; ms: number; internal: boolean },
  ): Promise<void> {
    const store = await this.load();
    if (!store.monitors[id]) return;
    await this.recordSample(store, id, sample);
    await this.persist(store);
  }

  async remove(id: string): Promise<void> {
    const store = await this.load();
    delete store.monitors[id];
    delete store.recent[id];
    delete store.rollups[id];
    await this.persist(store);
  }

  async recordPush(id: string, at: number): Promise<boolean> {
    const store = await this.load();
    const monitor = store.monitors[id];
    if (!monitor) return false;
    monitor.lastPushAt = at;
    monitor.nextCheckAt = Math.min(monitor.nextCheckAt, at + 1000);
    await this.persist(store);
    await this.arm(store, at);
    return true;
  }

  async getAll(): Promise<
    {
      id: string;
      state: RuntimeState;
      recent: Point[];
      nextCheckAt: number;
      lastPushAt: number | null;
      rollup: Rollup | null;
    }[]
  > {
    const store = await this.load();
    return Object.values(store.monitors).map((monitor) => ({
      id: monitor.id,
      state: monitor.state,
      recent: (store.recent[monitor.id] ?? []).slice(-40),
      nextCheckAt: monitor.nextCheckAt,
      lastPushAt: monitor.lastPushAt,
      rollup: store.rollups[monitor.id] ?? null,
    }));
  }

  async getOne(id: string): Promise<{
    state: RuntimeState;
    recent: Point[];
    nextCheckAt: number;
    lastPushAt: number | null;
    rollup: Rollup | null;
  } | null> {
    const store = await this.load();
    const monitor = store.monitors[id];
    if (!monitor) return null;
    return {
      state: monitor.state,
      recent: (store.recent[id] ?? []).slice(-60),
      nextCheckAt: monitor.nextCheckAt,
      lastPushAt: monitor.lastPushAt,
      rollup: store.rollups[id] ?? null,
    };
  }

  async ensureAlarm(): Promise<void> {
    const current = await this.ctx.storage.getAlarm();
    if (current !== null) return;
    const store = await this.load();
    await this.arm(store, Date.now());
  }

  async alarm(): Promise<void> {
    await this.runDue(Date.now());
  }

  async runDue(now: number): Promise<{ ran: number }> {
    const store = await this.load();
    const due = Object.values(store.monitors)
      .filter((monitor) => !monitor.paused && monitor.nextCheckAt <= now)
      .sort((a, b) => a.nextCheckAt - b.nextCheckAt)
      .slice(0, CHECKS_PER_ALARM);
    let cursor = 0;
    const worker = async () => {
      while (cursor < due.length) {
        const index = cursor;
        cursor += 1;
        const monitor = due[index];
        if (!monitor) continue;
        await this.checkOne(store, monitor, now);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CHECK_CONCURRENCY, due.length) }, () =>
        worker(),
      ),
    );
    if (now - store.flushedAt >= 5 * 60_000) await this.flush(store, now);
    await this.persist(store);
    const more = Object.values(store.monitors).some(
      (monitor) => !monitor.paused && monitor.nextCheckAt <= now,
    );
    await this.arm(store, more ? now + 500 : now);
    return { ran: due.length };
  }

  private async checkOne(
    store: Store,
    monitor: Snapshot,
    now: number,
  ): Promise<void> {
    // v1 runs one region. `regions` is stored so a later shard-per-region hint can reuse this snapshot.
    const region = monitor.regions[0] ?? "default";
    void region;
    const outcome = await runCheck({
      type: monitor.type,
      config: monitor.config,
      timeoutMs: monitor.timeoutMs,
      intervalMs: monitor.intervalMs,
      lastPushAt: monitor.lastPushAt,
      now,
    });
    const transition = applyOutcome(monitor.state, outcome, {
      retries: monitor.retries,
      recoveryThreshold: monitor.recoveryThreshold,
      now,
    });
    monitor.state = transition.state;
    monitor.nextCheckAt = now + (transition.nextDelayMs ?? monitor.intervalMs);
    await this.recordSample(store, monitor.id, {
      t: now,
      ok: outcome.ok,
      ms: outcome.responseMs,
      internal: outcome.internal,
    });
    try {
      this.env.ANALYTICS.writeDataPoint({
        indexes: [monitor.id],
        blobs: [
          region,
          outcome.internal ? "unknown" : outcome.ok ? "up" : "down",
          outcome.errorKind ?? "",
        ],
        doubles: [
          outcome.responseMs,
          outcome.httpStatus ?? 0,
          outcome.ok ? 1 : 0,
        ],
      });
    } catch {
      // Analytics Engine is optional for local runs that omit the binding.
    }
    if (monitor.type === "ssl") {
      await saveCert(
        this.env.DB,
        monitor.id,
        outcome.certNotAfter ?? null,
        outcome.ok ? null : outcome.error,
      ).catch(() => undefined);
    }
    if (transition.openedOutage) {
      await openOutage(
        this.env.DB,
        monitor.id,
        outcome.error ?? outcome.errorKind ?? "down",
        now,
      );
    }
    if (transition.closedOutage)
      await closeOutage(this.env.DB, monitor.id, now);
    if (
      transition.openedOutage ||
      transition.closedOutage ||
      transition.alert
    ) {
      await saveRuntime(this.env.DB, monitor.id, monitor.state);
    }
    if (transition.alert && !isInMaintenance(monitor.id, now)) {
      await this.notify(
        monitor,
        transition.alert,
        outcome.error ?? outcome.errorKind ?? "",
      );
    }
  }

  private async recordSample(
    store: Store,
    id: string,
    sample: { t: number; ok: boolean; ms: number; internal: boolean },
  ): Promise<void> {
    const points = store.recent[id] ?? [];
    points.push({
      t: sample.t,
      ok: sample.ok && !sample.internal,
      ms: sample.ms,
    });
    store.recent[id] = points.slice(-60);
    const hourStart = Math.floor(sample.t / 3_600_000) * 3_600_000;
    const rollup = store.rollups[id] ?? {
      hourStart,
      ok: 0,
      fail: 0,
      sum: 0,
      max: 0,
      samples: [],
    };
    if (rollup.hourStart !== hourStart && rollup.ok + rollup.fail > 0) {
      await mergeHourly(this.env.DB, id, rollup).catch(() => undefined);
      store.rollups[id] = {
        hourStart,
        ok: 0,
        fail: 0,
        sum: 0,
        max: 0,
        samples: [],
      };
    }
    const current = store.rollups[id] ?? rollup;
    if (!sample.internal) {
      if (sample.ok) current.ok += 1;
      else current.fail += 1;
      current.sum += sample.ms;
      current.max = Math.max(current.max, sample.ms);
      current.samples.push(sample.ms);
      current.samples = current.samples.slice(-120);
    }
    store.rollups[id] = current;
  }

  private async flush(store: Store, now: number): Promise<void> {
    for (const [id, rollup] of Object.entries(store.rollups)) {
      if (rollup.ok + rollup.fail === 0) continue;
      await mergeHourly(this.env.DB, id, rollup);
      const monitor = store.monitors[id];
      if (monitor) await saveRuntime(this.env.DB, id, monitor.state);
      store.rollups[id] = {
        hourStart: rollup.hourStart,
        ok: 0,
        fail: 0,
        sum: 0,
        max: 0,
        samples: [],
      };
    }
    store.flushedAt = now;
  }

  private async notify(
    monitor: Snapshot,
    kind: "down" | "up" | "unstable",
    reason: string,
  ): Promise<void> {
    const db = getDb(this.env.DB);
    const links = await db
      .select()
      .from(monitorChannels)
      .where(eq(monitorChannels.monitorId, monitor.id));
    for (const link of links) {
      const channel = await db
        .select()
        .from(notificationChannels)
        .where(eq(notificationChannels.id, link.channelId))
        .get();
      if (!channel || !this.env.ENCRYPTION_KEY) continue;
      let config: Record<string, unknown> = {};
      try {
        config = JSON.parse(
          await decryptString(this.env.ENCRYPTION_KEY, channel.configEncrypted),
        ) as Record<string, unknown>;
      } catch {
        continue;
      }
      const delivery: ChannelDelivery = {
        type: channel.type as ChannelDelivery["type"],
        locale: channel.locale,
        config,
      };
      await deliverChannel(
        delivery,
        { kind, monitorName: monitor.name, reason },
        {
          enqueueEmail: async (input) => {
            await enqueueMail(this.env, { kind: "alert", ...input });
          },
        },
      );
    }
  }

  private async load(): Promise<Store> {
    const [monitors, recent, rollups, flushedAt] = await Promise.all([
      this.ctx.storage.get<Record<string, Snapshot>>("monitors"),
      this.ctx.storage.get<Record<string, Point[]>>("recent"),
      this.ctx.storage.get<Record<string, Rollup>>("rollups"),
      this.ctx.storage.get<number>("flushedAt"),
    ]);
    return {
      monitors: monitors ?? {},
      recent: recent ?? {},
      rollups: rollups ?? {},
      flushedAt: flushedAt ?? 0,
    };
  }

  private async persist(store: Store): Promise<void> {
    await this.ctx.storage.put({
      monitors: store.monitors,
      recent: store.recent,
      rollups: store.rollups,
      flushedAt: store.flushedAt,
    });
  }

  private async arm(store: Store, now: number): Promise<void> {
    const upcoming = Object.values(store.monitors)
      .filter((monitor) => !monitor.paused)
      .map((monitor) => monitor.nextCheckAt)
      .sort((a, b) => a - b)[0];
    await this.ctx.storage.setAlarm(upcoming ?? now + 60_000);
  }
}
