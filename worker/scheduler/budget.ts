// SPDX-License-Identifier: MIT

/**
 * Free-plan cron cap. D1 allows 50 queries per Worker invocation
 * (https://developers.cloudflare.com/d1/platform/limits/). A `batch()`
 * call counts as one of those queries. Rows read and rows written are
 * still metered per row, including index rows
 * (https://developers.cloudflare.com/d1/platform/pricing/), so this cap
 * only decides how much work one cron starts. The daily rollup stays
 * set-based because batching a full recompute would not cut the row quotas.
 */
export const FREE_CRON_STATEMENT_BUDGET = 40;

/** Deletes plus the prune-state write, after the two setting reads. */
export const PRUNE_RUN_STATEMENTS = 11;
/** href, channels, announcement insert, outbox insert, signal insert. */
export const SIGNAL_EMIT_STATEMENTS = 5;
/** Event read, channel read, mail insert, status update, with spare. */
export const ANNOUNCEMENT_ROW_STATEMENTS = 6;
/** Fan-out preamble after the event row is known, plus the cursor write. */
export const FANOUT_EVENT_STATEMENTS = 7;
/** Subscriber, event, page, tokens, mail, and the delivery update. */
export const SUBSCRIPTION_SEND_STATEMENTS = 10;
/**
 * Alarm flush: one maintenance read, one batched hourly read, one batched
 * write. Independent of how many monitors the shard holds.
 */
export const FLUSH_ALARM_STATEMENTS = 3;

const registry = new WeakMap<D1Database, BudgetState>();

type BudgetState = {
  used: number;
  limit: number;
  deferred: boolean;
};

export class CronBudgetDeferred extends Error {
  constructor() {
    super("Cron deferred work to the next run");
    this.name = "CronBudgetDeferred";
  }
}

export function canSpend(database: D1Database, count: number): boolean {
  const state = registry.get(database);
  if (!state) return true;
  return state.used + count <= state.limit;
}

export function markDeferred(database: D1Database): void {
  const state = registry.get(database);
  if (state) state.deferred = true;
}

export function openCronBudget(
  database: D1Database,
  limit = FREE_CRON_STATEMENT_BUDGET,
): {
  database: D1Database;
  used: () => number;
  deferred: () => boolean;
} {
  const state: BudgetState = { used: 0, limit, deferred: false };
  const charge = () => {
    if (state.used + 1 > state.limit) throw new CronBudgetDeferred();
    state.used += 1;
  };
  const wrapped = new Proxy(database, {
    get(target, prop, receiver) {
      if (prop === "prepare") {
        return (sql: string) => arm(target.prepare(sql), charge);
      }
      if (prop === "batch") {
        return (statements: D1PreparedStatement[]) =>
          guard(charge, () => target.batch(statements));
      }
      if (prop === "exec") {
        return (sql: string) => guard(charge, () => target.exec(sql));
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  registry.set(wrapped, state);
  return {
    database: wrapped,
    used: () => state.used,
    deferred: () => state.deferred,
  };
}

export function withDatabase(env: Env, database: D1Database): Env {
  return new Proxy(env, {
    get(target, prop, receiver) {
      if (prop === "DB") return database;
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as Env;
}

function guard<T>(charge: () => void, invoke: () => T): Promise<Awaited<T>> {
  try {
    charge();
  } catch (error) {
    return Promise.reject(error);
  }
  return Promise.resolve(invoke());
}

function arm(
  stmt: D1PreparedStatement,
  charge: () => void,
): D1PreparedStatement {
  const run = stmt.run.bind(stmt);
  const all = stmt.all.bind(stmt);
  const first = stmt.first.bind(stmt);
  const raw = stmt.raw.bind(stmt);
  const bind = stmt.bind.bind(stmt);
  stmt.run = ((...args: Parameters<D1PreparedStatement["run"]>) =>
    guard(charge, () => run(...args))) as typeof stmt.run;
  stmt.all = ((...args: Parameters<D1PreparedStatement["all"]>) =>
    guard(charge, () => all(...args))) as typeof stmt.all;
  stmt.first = ((...args: Parameters<D1PreparedStatement["first"]>) =>
    guard(charge, () => first(...args))) as typeof stmt.first;
  stmt.raw = ((...args: Parameters<D1PreparedStatement["raw"]>) =>
    guard(charge, () => raw(...args))) as typeof stmt.raw;
  stmt.bind = ((...args: Parameters<D1PreparedStatement["bind"]>) =>
    arm(bind(...args), charge)) as typeof stmt.bind;
  return stmt;
}
