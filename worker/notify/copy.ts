// SPDX-License-Identifier: MIT

import { t } from "../../shared/copy";
import type { MailConfigReason } from "../../shared/mail-test";

export type NoticeKind = "down" | "up" | "unstable";

export type CopyFn = typeof t;

export function notificationText(
  kind: NoticeKind,
  name: string,
  reason: string,
  copy: CopyFn = t,
) {
  if (kind === "up") {
    return {
      subject: copy("notify_up_subject", { name }),
      body: copy("notify_up_body", { name }),
    };
  }
  if (kind === "unstable") {
    return {
      subject: copy("notify_unstable_subject", { name }),
      body: copy("notify_unstable_body", { name }),
    };
  }
  return {
    subject: copy("notify_down_subject", { name }),
    body: copy("notify_down_body", {
      name,
      reason: reason || copy("notify_reason_unknown"),
    }),
  };
}

export function inviteMail(
  input: { name: string; instance: string; role: string; link: string },
  copy: CopyFn = t,
) {
  return {
    subject: copy("mail_invite_subject", { instance: input.instance }),
    text: copy("mail_invite_body", input),
  };
}

export function resetMail(
  input: { instance: string; link: string },
  copy: CopyFn = t,
) {
  return {
    subject: copy("mail_reset_subject", { instance: input.instance }),
    text: copy("mail_reset_body", input),
  };
}

export function testMail(instance: string, copy: CopyFn = t) {
  return {
    subject: copy("mail_test_subject", { instance }),
    text: copy("mail_test_body", { instance }),
  };
}

export function mailStageMessage(
  stage: "config" | "connect" | "tls" | "auth" | "send",
): string {
  switch (stage) {
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
  }
}

export function mailReasonMessage(reason: MailConfigReason): string {
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

export function mailPasswordUnreadable(): string {
  return t("mail_password_unreadable");
}

export function channelTestText(name: string, copy: CopyFn = t) {
  return copy("channel_test_body", { name });
}
