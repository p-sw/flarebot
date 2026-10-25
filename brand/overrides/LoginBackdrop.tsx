// SPDX-License-Identifier: AGPL-3.0-only

import type { ReactNode } from "react";
import { m } from "../../src/paraglide/messages.js";
import logo from "../assets/logo.svg";
import brand from "../brand.config";

export default function LoginBackdrop({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen md:grid-cols-2">
      <div className="hidden flex-col justify-between bg-sidebar p-10 text-sidebar-foreground md:flex">
        <img src={logo} alt="" className="h-10 w-10" />
        <div>
          <p className="text-3xl font-medium">{brand.name}</p>
          <p className="mt-2 max-w-sm text-sidebar-muted">
            {m.status_hero_tagline()}
          </p>
        </div>
      </div>
      <div className="flex items-center justify-center p-6">{children}</div>
    </div>
  );
}
