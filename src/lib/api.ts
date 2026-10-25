// SPDX-License-Identifier: MIT

import { t } from "@shared/copy";

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly stage?: string,
  ) {
    super(message);
  }
}

const messages: Record<string, () => string> = {
  forbidden: () => t("error_forbidden"),
  unauthorized: () => t("error_unauthorized"),
  not_found: () => t("error_not_found"),
  validation: () => t("error_validation"),
  conflict: () => t("error_conflict"),
  locked: () => t("error_locked"),
  totp_required: () => t("error_totp_required"),
  totp_invalid: () => t("error_totp_invalid"),
  bad_secret: () => t("error_bad_secret"),
  setup_closed: () => t("error_setup_closed"),
  rate_limited: () => t("error_rate_limited"),
};

export function errorText(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.code === "mail" && error.stage)
      return `${t("settings_test_fail")}: ${error.stage}`;
    return messages[error.code]?.() ?? error.message ?? t("error_generic");
  }
  return t("error_generic");
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type"))
    headers.set("content-type", "application/json");
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "same-origin",
  });
  const data = (await response.json().catch(() => ({}))) as {
    error?: { code?: string; message?: string; stage?: string };
  };
  if (!response.ok) {
    throw new ApiClientError(
      data.error?.message ?? t("error_generic"),
      data.error?.code ?? "internal",
      response.status,
      data.error?.stage,
    );
  }
  return data as T;
}
