// SPDX-License-Identifier: MIT

import { t } from "@shared/copy";
import { isMailConfigReason, redactMailDetail } from "@shared/mail-test";

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly stage?: string,
    readonly reason?: string,
    readonly detail?: string,
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

function stageSentence(stage: string | undefined): string | undefined {
  switch (stage === "timeout" ? "connect" : stage) {
    case "config":
      return t("mail_stage_config");
    case "connect":
      return t("mail_stage_connect");
    case "tls":
      return t("mail_stage_tls");
    case "auth":
      return t("mail_stage_auth");
    case "send":
      return t("mail_stage_send");
    default:
      return undefined;
  }
}

function reasonSentence(reason: string | undefined): string | undefined {
  if (!reason || !isMailConfigReason(reason)) return undefined;
  switch (reason) {
    case "not_configured":
      return t("mail_reason_not_configured");
    case "missing_from":
      return t("mail_reason_missing_from");
    case "incomplete_smtp":
      return t("mail_reason_incomplete_smtp");
    case "port_25":
      return t("mail_reason_port_25");
    case "unsupported_port":
      return t("mail_reason_unsupported_port");
    case "blocked_host":
      return t("mail_reason_blocked_host");
    case "missing_binding":
      return t("mail_reason_missing_binding");
    case "missing_encryption_key":
      return t("mail_reason_missing_encryption_key");
  }
}

export function mailFailureText(error: {
  stage?: string;
  reason?: string;
  detail?: string;
  message?: string;
}): string {
  const reason = reasonSentence(error.reason);
  if (reason) return reason;
  const stage = stageSentence(error.stage);
  const detail = redactMailDetail(error.detail);
  if (stage && detail)
    return t("mail_error_detail", { message: stage, detail });
  if (stage) return stage;
  const message = error.message?.trim();
  if (
    message &&
    !/^(config|connect|tls|auth|send|timeout)$/i.test(message) &&
    !message.startsWith("Test failed")
  )
    return message;
  return t("settings_test_fail");
}

export function errorText(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.code === "mail") return mailFailureText(error);
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
    error?: {
      code?: string;
      message?: string;
      stage?: string;
      reason?: string;
      detail?: string;
    };
  };
  if (!response.ok) {
    throw new ApiClientError(
      data.error?.message ?? t("error_generic"),
      data.error?.code ?? "internal",
      response.status,
      data.error?.stage,
      data.error?.reason,
      data.error?.detail,
    );
  }
  return data as T;
}
