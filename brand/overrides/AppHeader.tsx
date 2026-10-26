// SPDX-License-Identifier: MIT

import type { ReactNode } from "react";

export default function AppHeader({
  title,
  actions,
}: {
  title: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <h1
        title={title}
        className="min-w-0 truncate text-2xl font-medium tracking-tight"
      >
        {title}
      </h1>
      <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div>
    </header>
  );
}
