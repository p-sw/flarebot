// SPDX-License-Identifier: MIT

import { t } from "@shared/copy";
import type { ReactNode } from "react";
import logo from "../assets/logo.svg";

export default function LoginBackdrop({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen md:grid-cols-2">
      <div className="hidden flex-col justify-between bg-sidebar p-10 text-sidebar-foreground md:flex">
        <img src={logo} alt="" className="h-10 w-10" />
        <div>
          <p className="text-3xl font-medium">{t("app_name")}</p>
          <p className="mt-2 max-w-sm text-sidebar-muted">
            {t("status_hero_tagline")}
          </p>
        </div>
      </div>
      <div className="flex items-center justify-center p-6">{children}</div>
    </div>
  );
}
