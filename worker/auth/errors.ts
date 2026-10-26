// SPDX-License-Identifier: MIT

import { t } from "../../shared/copy";
import { ApiError } from "../http";

export type SsoErrorCode =
  | "email"
  | "domain"
  | "denied"
  | "disabled"
  | "link"
  | "jit"
  | "config"
  | "token"
  | "state"
  | "role";

export class SsoFlowError extends Error {
  constructor(
    readonly code: SsoErrorCode,
    readonly email: string | null = null,
  ) {
    super(code);
    this.name = "SsoFlowError";
  }
}

function message(code: SsoErrorCode): string {
  switch (code) {
    case "email":
      return t("error_sso_email");
    case "domain":
      return t("error_sso_domain");
    case "denied":
      return t("error_sso_denied");
    case "disabled":
      return t("error_sso_disabled");
    case "link":
      return t("error_sso_link");
    case "jit":
      return t("error_sso_jit");
    case "config":
      return t("error_sso_config");
    case "token":
      return t("error_sso_token");
    case "state":
      return t("error_sso_state");
    case "role":
      return t("error_sso_denied");
  }
}

export function ssoFailure(error: SsoFlowError): ApiError {
  const status =
    error.code === "domain" ||
    error.code === "denied" ||
    error.code === "disabled" ||
    error.code === "link" ||
    error.code === "jit" ||
    error.code === "role"
      ? 403
      : 401;
  return new ApiError(status, `sso_${error.code}`, message(error.code));
}
