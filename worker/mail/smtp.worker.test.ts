// SPDX-License-Identifier: AGPL-3.0-only

import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { SMTP_PORTS } from "../../test/smtp-ports";
import { encryptString } from "../crypto/secret";
import { enqueueMail } from "./mailer";
import { sendSmtp } from "./smtp";

const fast = {
  allowLoopback: true,
  responseTimeoutMs: 800,
  socketTimeoutMs: 800,
  sendTimeoutMs: 1_500,
};

const message = {
  to: "ops@example.com",
  subject: "down",
  text: "API is down",
  messageId: "<m@flarebot.local>",
};

function settings(
  port: number,
  security: "starttls" | "tls" = "starttls",
): Parameters<typeof sendSmtp>[0] {
  return {
    host: "127.0.0.1",
    port,
    security,
    username: "bot",
    password: "secret",
    fromName: "Flarebot",
    fromAddress: "bot@example.com",
  };
}

describe("sendSmtp", () => {
  it("walks STARTTLS, implicit TLS, auth, permanent, transient, and a full send", async () => {
    const starttls = await sendSmtp(
      settings(SMTP_PORTS.starttls),
      message,
      fast,
    );
    expect(starttls.ok).toBe(false);
    if (!starttls.ok) expect(starttls.stage).toBe("tls");

    const implicit = await sendSmtp(
      settings(SMTP_PORTS.implicitTls, "tls"),
      message,
      fast,
    );
    expect(implicit.ok).toBe(false);
    if (!implicit.ok) expect(["tls", "connect"]).toContain(implicit.stage);

    const auth = await sendSmtp(settings(SMTP_PORTS.authFail), message, fast);
    expect(auth.ok).toBe(false);
    if (!auth.ok) {
      expect(auth.stage).toBe("auth");
      expect(auth.permanent).toBe(true);
    }

    const mailbox = await sendSmtp(
      settings(SMTP_PORTS.mailboxFail),
      message,
      fast,
    );
    expect(mailbox.ok).toBe(false);
    if (!mailbox.ok) expect(mailbox.permanent).toBe(true);

    const retry = await sendSmtp(settings(SMTP_PORTS.transient), message, fast);
    expect(retry.ok).toBe(false);
    if (!retry.ok) expect(retry.permanent).toBe(false);

    const sent = await sendSmtp(settings(SMTP_PORTS.ok), message, fast);
    expect(sent.ok).toBe(true);

    const hung = await sendSmtp(settings(SMTP_PORTS.hang), message, fast);
    expect(hung.ok).toBe(false);
    if (!hung.ok) expect(["connect", "timeout", "send"]).toContain(hung.stage);

    const blocked = await sendSmtp(
      { ...settings(587), host: "127.0.0.1" },
      message,
    );
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.stage).toBe("config");
  });
});

describe("mail outbox", () => {
  async function saveMailPort(port: number) {
    const key = env.ENCRYPTION_KEY;
    if (!key) throw new Error("ENCRYPTION_KEY is not set");
    const password = await encryptString(key, "secret");
    await env.DB.prepare(
      `INSERT INTO mail_settings (
        id, driver, host, port, security, username, password_encrypted,
        from_name, from_address, updated_at
      ) VALUES (1, 'smtp', '127.0.0.1', ?, 'starttls', 'bot', ?, 'Flarebot', 'bot@example.com', ?)
      ON CONFLICT(id) DO UPDATE SET
        driver = 'smtp', host = '127.0.0.1', port = ?, security = 'starttls',
        username = 'bot', password_encrypted = ?, from_address = 'bot@example.com',
        updated_at = ?`,
    )
      .bind(port, password, Date.now(), port, password, Date.now())
      .run();
  }

  it("stops on a permanent SMTP failure and retries a 4xx once", async () => {
    await saveMailPort(SMTP_PORTS.authFail);
    const failedId = await enqueueMail(env, {
      kind: "alert",
      to: "ops@example.com",
      subject: "permanent",
      text: "no",
    });
    const mailer = env.MAILER.get(env.MAILER.idFromName("mailer"));
    await mailer.pump();
    await mailer.pump();
    const failed = await env.DB.prepare(
      "SELECT status, attempts FROM mail_outbox WHERE id = ?",
    )
      .bind(failedId)
      .first<{ status: string; attempts: number }>();
    expect(failed).toEqual({ status: "failed", attempts: 1 });

    await saveMailPort(SMTP_PORTS.transient);
    const retryId = await enqueueMail(env, {
      kind: "alert",
      to: "ops@example.com",
      subject: "transient",
      text: "later",
    });
    await mailer.pump();
    const retry = await env.DB.prepare(
      "SELECT status, attempts, next_attempt_at FROM mail_outbox WHERE id = ?",
    )
      .bind(retryId)
      .first<{ status: string; attempts: number; next_attempt_at: number }>();
    expect(retry?.status).toBe("pending");
    expect(retry?.attempts).toBe(1);
    expect((retry?.next_attempt_at ?? 0) - Date.now()).toBeGreaterThan(50_000);
  });

  it("claims a row once when the outbox is pumped twice", async () => {
    await saveMailPort(SMTP_PORTS.ok);
    const id = await enqueueMail(env, {
      kind: "alert",
      to: "ops@example.com",
      subject: "once",
      text: "sent",
    });
    const mailer = env.MAILER.get(env.MAILER.idFromName("mailer"));
    await Promise.all([mailer.pump(), mailer.pump()]);
    const row = await env.DB.prepare(
      "SELECT status, attempts FROM mail_outbox WHERE id = ?",
    )
      .bind(id)
      .first<{ status: string; attempts: number }>();
    expect(row).toEqual({ status: "sent", attempts: 1 });
  });
});
