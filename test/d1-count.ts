// SPDX-License-Identifier: MIT

export function instrumentD1(database: D1Database): {
  count: () => number;
  restore: () => void;
} {
  const originalPrepare = database.prepare.bind(database);
  const originalBatch = database.batch.bind(database);
  const originalExec = database.exec.bind(database);
  let count = 0;
  const tap = (stmt: D1PreparedStatement): D1PreparedStatement => {
    const run = stmt.run.bind(stmt);
    const all = stmt.all.bind(stmt);
    const first = stmt.first.bind(stmt);
    const raw = stmt.raw.bind(stmt);
    const bind = stmt.bind.bind(stmt);
    stmt.run = ((...args: Parameters<D1PreparedStatement["run"]>) => {
      count += 1;
      return run(...args);
    }) as typeof stmt.run;
    stmt.all = ((...args: Parameters<D1PreparedStatement["all"]>) => {
      count += 1;
      return all(...args);
    }) as typeof stmt.all;
    stmt.first = ((...args: Parameters<D1PreparedStatement["first"]>) => {
      count += 1;
      return first(...args);
    }) as typeof stmt.first;
    stmt.raw = ((...args: Parameters<D1PreparedStatement["raw"]>) => {
      count += 1;
      return raw(...args);
    }) as typeof stmt.raw;
    stmt.bind = ((...args: Parameters<D1PreparedStatement["bind"]>) =>
      tap(bind(...args))) as typeof stmt.bind;
    return stmt;
  };
  database.prepare = ((sql: string) =>
    tap(originalPrepare(sql))) as typeof database.prepare;
  database.batch = ((statements: D1PreparedStatement[]) => {
    count += 1;
    return originalBatch(statements);
  }) as typeof database.batch;
  database.exec = ((sql: string) => {
    count += 1;
    return originalExec(sql);
  }) as typeof database.exec;
  return {
    count: () => count,
    restore() {
      database.prepare = originalPrepare as typeof database.prepare;
      database.batch = originalBatch as typeof database.batch;
      database.exec = originalExec;
    },
  };
}
