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
    <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-medium tracking-tight">{title}</h1>
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    </header>
  );
}
