// SPDX-License-Identifier: MIT

import { m } from "../../src/paraglide/messages.js";
import brand from "../brand.config";

export default function AppFooter() {
  return (
    <footer className="mt-10 flex items-center justify-between gap-4 border-t border-border py-4 text-xs text-muted-foreground">
      <span>{brand.name}</span>
      {brand.links.source ? (
        <a
          className="underline-offset-2 hover:underline"
          href={brand.links.source}
        >
          {m.footer_source()}
        </a>
      ) : null}
    </footer>
  );
}
