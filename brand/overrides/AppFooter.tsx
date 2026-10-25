// SPDX-License-Identifier: MIT

import { t } from "@shared/copy";
import brand from "../brand.config";

export default function AppFooter() {
  return (
    <footer className="mt-10 flex items-center justify-between gap-4 border-t border-border py-4 text-xs text-muted-foreground">
      <span>{t("app_name")}</span>
      {brand.links.source ? (
        <a
          className="underline-offset-2 hover:underline"
          href={brand.links.source}
        >
          {t("footer_source")}
        </a>
      ) : null}
    </footer>
  );
}
