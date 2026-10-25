// SPDX-License-Identifier: MIT

import { m } from "../paraglide/messages.js";

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
  forbidden: () => m.error_forbidden(),
  unauthorized: () => m.error_unauthorized(),
  not_found: () => m.error_not_found(),
  validation: () => m.error_validation(),
  conflict: () => m.error_conflict(),
  locked: () => m.error_locked(),
  totp_required: () => m.error_totp_required(),
  totp_invalid: () => m.error_totp_invalid(),
  bad_secret: () => m.error_bad_secret(),
  setup_closed: () => m.error_setup_closed(),
  rate_limited: () => m.error_rate_limited(),
};

export function errorText(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.code === "mail" && error.stage)
      return `${m.settings_test_fail()}: ${error.stage}`;
    return messages[error.code]?.() ?? error.message ?? m.error_generic();
  }
  return m.error_generic();
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
      data.error?.message ?? m.error_generic(),
      data.error?.code ?? "internal",
      response.status,
      data.error?.stage,
    );
  }
  return data as T;
}
