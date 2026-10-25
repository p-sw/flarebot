// SPDX-License-Identifier: AGPL-3.0-only

import { m } from "../../src/paraglide/messages.js";
import brand from "../brand.config";

export default function AppFooter() {
  return (
    <footer className="mt-10 flex items-center justify-between gap-4 border-t border-border py-4 text-xs text-muted-foreground">
      <span>{brand.name}</span>
      <a
        className="underline-offset-2 hover:underline"
        href={brand.links.source}
      >
        {m.footer_source()}
      </a>
    </footer>
  );
}
