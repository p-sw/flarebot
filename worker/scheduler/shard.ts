// SPDX-License-Identifier: MIT

import { DurableObject } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { SLOT_MS } from "../../shared/history";
import type { MonitorType } from "../../shared/schemas";
import { runCheck } from "../checks/run";
import { decryptString } from "../crypto/secret";
import { getDb } from "../db/client";
import { monitorChannels, notificationChannels } from "../db/schema";
import { enqueueMail } from "../mail/mailer";
import { isInMaintenance, loadActiveMaintenanceIds } from "../maintenance";
import { type ChannelDelivery, deliverChannel } from "../notify/dispatch";
import { CHECK_CONCURRENCY, CHECKS_PER_ALARM } from "./capacity";
import {
  closeOutage,
  mergeHourly,
  mergeSlot,
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

type Point = { t: number; ok: boolean; ms: number; maint?: boolean };
type Rollup = {
  hourStart: number;
  ok: number;
  fail: number;
  maint: number;
  sum: number;
  max: number;
  samples: number[];
};
type SlotRollup = {
  slotStart: number;
  ok: number;
  fail: number;
  sum: number;
  max: number;
  maint: number;
};

function normalizeRollup(rollup: Rollup | undefined): Rollup | null {
  if (!rollup) return null;
  return { ...rollup, maint: rollup.maint ?? 0 };
}

function normalizeSlot(slot: SlotRollup | undefined): SlotRollup | null {
  if (!slot) return null;
  return { ...slot, maint: slot.maint ?? 0 };
}
type Store = {
  monitors: Record<string, Snapshot>;
  recent: Record<string, Point[]>;
  rollups: Record<string, Rollup>;
  slots: Record<string, SlotRollup>;
  flushedAt: number;
};

export class SchedulerShard extends DurableObject<Env> {
  // Probe I/O yields the isolate, so a pause can land while a check is in flight.
  // Storage writes are queued so that check cannot persist the pre-pause snapshot.
  private writes: Promise<void> = Promise.resolve();

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.writes.then(task, task);
    this.writes = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async upsert(snapshot: Snapshot): Promise<void> {
    await this.enqueue(async () => {
      const store = await this.load();
      store.monitors[snapshot.id] = snapshot;
      await this.persist(store);
      await this.arm(store, Date.now());
    });
  }

  async noteSample(
    id: string,
    sample: { t: number; ok: boolean; ms: number; internal: boolean },
  ): Promise<void> {
    await this.enqueue(async () => {
      const store = await this.load();
      if (!store.monitors[id]) return;
      const active = await loadActiveMaintenanceIds(this.env.DB, sample.t);
      await this.recordSample(store, id, {
        ...sample,
        maintenance: isInMaintenance(id, active),
      });
      await this.persist(store);
    });
  }

  async remove(id: string): Promise<void> {
    await this.enqueue(async () => {
      const store = await this.load();
      delete store.monitors[id];
      delete store.recent[id];
      delete store.rollups[id];
      delete store.slots[id];
      await this.persist(store);
    });
  }

  async recordPush(id: string, at: number): Promise<boolean> {
    return this.enqueue(async () => {
      const store = await this.load();
      const monitor = store.monitors[id];
      if (!monitor) return false;
      monitor.lastPushAt = at;
      monitor.nextCheckAt = Math.min(monitor.nextCheckAt, at + 1000);
      await this.persist(store);
      await this.arm(store, at);
      return true;
    });
  }

  async getAll(): Promise<
    {
      id: string;
      state: RuntimeState;
      recent: Point[];
      nextCheckAt: number;
      lastPushAt: number | null;
      rollup: Rollup | null;
      slot: SlotRollup | null;
    }[]
  > {
    const store = await this.load();
    return Object.values(store.monitors).map((monitor) => ({
      id: monitor.id,
      state: monitor.state,
      recent: (store.recent[monitor.id] ?? []).slice(-40),
      nextCheckAt: monitor.nextCheckAt,
      lastPushAt: monitor.lastPushAt,
      rollup: normalizeRollup(store.rollups[monitor.id]),
      slot: normalizeSlot(store.slots[monitor.id]),
    }));
  }

  async getOne(id: string): Promise<{
    state: RuntimeState;
    recent: Point[];
    nextCheckAt: number;
    lastPushAt: number | null;
    rollup: Rollup | null;
    slot: SlotRollup | null;
  } | null> {
    const store = await this.load();
    const monitor = store.monitors[id];
    if (!monitor) return null;
    return {
      state: monitor.state,
      recent: (store.recent[id] ?? []).slice(-60),
      nextCheckAt: monitor.nextCheckAt,
      lastPushAt: monitor.lastPushAt,
      rollup: normalizeRollup(store.rollups[id]),
      slot: normalizeSlot(store.slots[id]),
    };
  }

  async scheduleOf(id: string): Promise<{
    intervalMs: number;
    timeoutMs: number;
    config: unknown;
    nextCheckAt: number;
    paused: boolean;
  } | null> {
    const store = await this.load();
    const monitor = store.monitors[id];
    if (!monitor) return null;
    return {
      intervalMs: monitor.intervalMs,
      timeoutMs: monitor.timeoutMs,
      config: monitor.config,
      nextCheckAt: monitor.nextCheckAt,
      paused: monitor.paused,
    };
  }

  async alarmAt(): Promise<number | null> {
    return this.ctx.storage.getAlarm();
  }

  async ensureAlarm(): Promise<void> {
    await this.enqueue(async () => {
      const current = await this.ctx.storage.getAlarm();
      if (current !== null) return;
      const store = await this.load();
      await this.arm(store, Date.now());
    });
  }

  async alarm(): Promise<void> {
    await this.runDue(Date.now());
  }

  async runDue(now: number): Promise<{ ran: number }> {
    const activeMaintenance = await loadActiveMaintenanceIds(this.env.DB, now);
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
        await this.checkOne(monitor.id, now, activeMaintenance);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CHECK_CONCURRENCY, due.length) }, () =>
        worker(),
      ),
    );
    await this.enqueue(async () => {
      const fresh = await this.load();
      if (now - fresh.flushedAt >= 5 * 60_000) {
        await this.flush(fresh, now);
        await this.persist(fresh);
      }
      const more = Object.values(fresh.monitors).some(
        (monitor) => !monitor.paused && monitor.nextCheckAt <= now,
      );
      await this.arm(fresh, more ? now + 500 : now);
    });
    return { ran: due.length };
  }

  private async checkOne(
    id: string,
    now: number,
    activeMaintenance: ReadonlySet<string>,
  ): Promise<void> {
    const preview = await this.load();
    const monitor = preview.monitors[id];
    if (!monitor || monitor.paused || monitor.nextCheckAt > now) return;
    // v1 runs one region. `regions` is stored so a later shard-per-region hint can reuse this snapshot.
    const region = monitor.regions[0] ?? "default";
    const outcome = await runCheck({
      type: monitor.type,
      config: monitor.config,
      timeoutMs: monitor.timeoutMs,
      intervalMs: monitor.intervalMs,
      lastPushAt: monitor.lastPushAt,
      now,
    });
    const committed = await this.enqueue(async () => {
      const store = await this.load();
      const current = store.monitors[id];
      if (!current || current.paused) return null;
      const transition = applyOutcome(current.state, outcome, {
        retries: current.retries,
        recoveryThreshold: current.recoveryThreshold,
        now,
      });
      current.state = transition.state;
      current.nextCheckAt =
        now + (transition.nextDelayMs ?? current.intervalMs);
      const inMaintenance = isInMaintenance(id, activeMaintenance);
      await this.recordSample(store, id, {
        t: now,
        ok: outcome.ok,
        ms: outcome.responseMs,
        internal: outcome.internal,
        maintenance: inMaintenance,
      });
      await this.persist(store);
      if (transition.openedOutage) {
        await openOutage(
          this.env.DB,
          id,
          outcome.error ?? outcome.errorKind ?? "down",
          now,
        );
      }
      if (transition.closedOutage) await closeOutage(this.env.DB, id, now);
      if (
        transition.openedOutage ||
        transition.closedOutage ||
        transition.alert
      ) {
        await saveRuntime(this.env.DB, id, current.state);
      }
      return {
        name: current.name,
        alert: transition.alert,
        reason: outcome.error ?? outcome.errorKind ?? "",
      };
    });
    if (!committed) return;
    try {
      this.env.ANALYTICS.writeDataPoint({
        indexes: [id],
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
        id,
        outcome.certNotAfter ?? null,
        outcome.ok ? null : outcome.error,
      ).catch(() => undefined);
    }
    if (committed.alert && !isInMaintenance(id, activeMaintenance)) {
      await this.notify(
        { ...monitor, name: committed.name },
        committed.alert,
        committed.reason,
      );
    }
  }

  private async recordSample(
    store: Store,
    id: string,
    sample: {
      t: number;
      ok: boolean;
      ms: number;
      internal: boolean;
      maintenance?: boolean;
    },
  ): Promise<void> {
    const points = store.recent[id] ?? [];
    points.push({
      t: sample.t,
      ok: sample.ok && !sample.internal,
      ms: sample.ms,
      maint: sample.maintenance || undefined,
    });
    store.recent[id] = points.slice(-60);
    const hourStart = Math.floor(sample.t / 3_600_000) * 3_600_000;
    const existing = store.rollups[id];
    const rollup: Rollup = existing
      ? { ...existing, maint: existing.maint ?? 0 }
      : {
          hourStart,
          ok: 0,
          fail: 0,
          maint: 0,
          sum: 0,
          max: 0,
          samples: [],
        };
    if (
      rollup.hourStart !== hourStart &&
      rollup.ok + rollup.fail + rollup.maint > 0
    ) {
      await mergeHourly(this.env.DB, id, rollup).catch(() => undefined);
      store.rollups[id] = {
        hourStart,
        ok: 0,
        fail: 0,
        maint: 0,
        sum: 0,
        max: 0,
        samples: [],
      };
    }
    const current = store.rollups[id] ?? rollup;
    current.maint = current.maint ?? 0;
    if (!sample.internal) {
      if (sample.maintenance) {
        current.maint += 1;
      } else {
        if (sample.ok) current.ok += 1;
        else current.fail += 1;
        current.sum += sample.ms;
        current.max = Math.max(current.max, sample.ms);
        current.samples.push(sample.ms);
        current.samples = current.samples.slice(-120);
      }
    }
    store.rollups[id] = current;
    const slotStart = Math.floor(sample.t / SLOT_MS) * SLOT_MS;
    const previous = store.slots[id];
    if (
      previous &&
      previous.slotStart !== slotStart &&
      previous.ok + previous.fail + (previous.maint ?? 0) > 0
    ) {
      await mergeSlot(this.env.DB, id, {
        ...previous,
        maint: previous.maint ?? 0,
      }).catch(() => undefined);
    }
    const slot: SlotRollup =
      !previous || previous.slotStart !== slotStart
        ? { slotStart, ok: 0, fail: 0, sum: 0, max: 0, maint: 0 }
        : { ...previous, maint: previous.maint ?? 0 };
    if (!sample.internal) {
      if (sample.maintenance) {
        slot.maint += 1;
      } else {
        if (sample.ok) slot.ok += 1;
        else slot.fail += 1;
        slot.sum += sample.ms;
        slot.max = Math.max(slot.max, sample.ms);
      }
    }
    store.slots[id] = slot;
  }

  private async flush(store: Store, now: number): Promise<void> {
    for (const [id, stored] of Object.entries(store.rollups)) {
      const rollup = { ...stored, maint: stored.maint ?? 0 };
      if (rollup.ok + rollup.fail + rollup.maint === 0) continue;
      await mergeHourly(this.env.DB, id, rollup);
      const monitor = store.monitors[id];
      if (monitor) await saveRuntime(this.env.DB, id, monitor.state);
      store.rollups[id] = {
        hourStart: rollup.hourStart,
        ok: 0,
        fail: 0,
        maint: 0,
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
    const [monitors, recent, rollups, slots, flushedAt] = await Promise.all([
      this.ctx.storage.get<Record<string, Snapshot>>("monitors"),
      this.ctx.storage.get<Record<string, Point[]>>("recent"),
      this.ctx.storage.get<Record<string, Rollup>>("rollups"),
      this.ctx.storage.get<Record<string, SlotRollup>>("slots"),
      this.ctx.storage.get<number>("flushedAt"),
    ]);
    return {
      monitors: monitors ?? {},
      recent: recent ?? {},
      rollups: rollups ?? {},
      slots: slots ?? {},
      flushedAt: flushedAt ?? 0,
    };
  }

  private async persist(store: Store): Promise<void> {
    await this.ctx.storage.put({
      monitors: store.monitors,
      recent: store.recent,
      rollups: store.rollups,
      slots: store.slots,
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
