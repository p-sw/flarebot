// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import {
  CronBudgetDeferred,
  FREE_CRON_STATEMENT_BUDGET,
  openCronBudget,
} from "./budget";

function statement(): D1PreparedStatement {
  const stmt = {
    bind() {
      return statement();
    },
    async run() {
      return { results: [], success: true, meta: {} };
    },
    async all() {
      return { results: [], success: true, meta: {} };
    },
    async first() {
      return null;
    },
    async raw() {
      return [];
    },
  };
  return stmt as unknown as D1PreparedStatement;
}

function fakeDatabase(): D1Database {
  return {
    prepare() {
      return statement();
    },
    async batch(statements: D1PreparedStatement[]) {
      return statements.map(() => ({ results: [], success: true, meta: {} }));
    },
    async exec() {
      return { count: 0, duration: 0 };
    },
  } as unknown as D1Database;
}

describe("cron statement budget", () => {
  it("counts a batch as one query and stops at the free-plan cap", async () => {
    const budget = openCronBudget(fakeDatabase(), FREE_CRON_STATEMENT_BUDGET);
    await budget.database.batch([]);
    expect(budget.used()).toBe(1);
    for (let index = 0; index < FREE_CRON_STATEMENT_BUDGET - 1; index += 1) {
      await budget.database.prepare("SELECT 1").all();
    }
    expect(budget.used()).toBe(FREE_CRON_STATEMENT_BUDGET);
    await expect(
      budget.database.prepare("SELECT 1").run(),
    ).rejects.toBeInstanceOf(CronBudgetDeferred);
    expect(budget.used()).toBe(FREE_CRON_STATEMENT_BUDGET);
    expect(FREE_CRON_STATEMENT_BUDGET).toBeLessThanOrEqual(40);
  });
});
