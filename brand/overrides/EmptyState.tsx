// SPDX-License-Identifier: MIT

import type { ReactNode } from "react";
import { m } from "../../src/paraglide/messages.js";

export default function EmptyState({ action }: { action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card px-6 py-12 text-center">
      <h2 className="text-lg font-medium">{m.empty_title()}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{m.empty_body()}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
