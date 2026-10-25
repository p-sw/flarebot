// SPDX-License-Identifier: AGPL-3.0-only

import { m } from "../../src/paraglide/messages.js";

export type NoticeKind = "down" | "up" | "unstable";

function localeOf(locale: string | null | undefined): "en" | "ko" {
  return locale === "ko" ? "ko" : "en";
}

export function notificationText(
  locale: string | null | undefined,
  kind: NoticeKind,
  name: string,
  reason: string,
) {
  const options = { locale: localeOf(locale) };
  if (kind === "up") {
    return {
      subject: m.notify_up_subject({ name }, options),
      body: m.notify_up_body({ name }, options),
    };
  }
  if (kind === "unstable") {
    return {
      subject: m.notify_unstable_subject({ name }, options),
      body: m.notify_unstable_body({ name }, options),
    };
  }
  return {
    subject: m.notify_down_subject({ name }, options),
    body: m.notify_down_body({ name, reason: reason || "unknown" }, options),
  };
}

export function inviteMail(
  locale: string | null | undefined,
  input: { name: string; instance: string; role: string; link: string },
) {
  const options = { locale: localeOf(locale) };
  return {
    subject: m.mail_invite_subject({ instance: input.instance }, options),
    text: m.mail_invite_body(input, options),
  };
}

export function resetMail(
  locale: string | null | undefined,
  input: { instance: string; link: string },
) {
  const options = { locale: localeOf(locale) };
  return {
    subject: m.mail_reset_subject({ instance: input.instance }, options),
    text: m.mail_reset_body(input, options),
  };
}

export function testMail(locale: string | null | undefined, instance: string) {
  const options = { locale: localeOf(locale) };
  return {
    subject: m.mail_test_subject({ instance }, options),
    text: m.mail_test_body({ instance }, options),
  };
}

export function channelTestText(
  locale: string | null | undefined,
  name: string,
) {
  return m.channel_test_body({ name }, { locale: localeOf(locale) });
}
