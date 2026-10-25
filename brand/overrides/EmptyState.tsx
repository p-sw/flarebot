// SPDX-License-Identifier: MIT

import { t } from "@shared/copy";
import type { ReactNode } from "react";

export default function EmptyState({ action }: { action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card px-6 py-12 text-center">
      <h2 className="text-lg font-medium">{t("empty_title")}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{t("empty_body")}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
