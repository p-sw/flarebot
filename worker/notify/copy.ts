// SPDX-License-Identifier: MIT

import { t } from "../../shared/copy";

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

export function channelTestText(name: string, copy: CopyFn = t) {
  return copy("channel_test_body", { name });
}
