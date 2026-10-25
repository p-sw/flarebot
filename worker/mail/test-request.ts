// SPDX-License-Identifier: MIT

import { eq } from "drizzle-orm";
import { z } from "zod";
import { t } from "../../shared/copy";
import { describeMailSource } from "../../shared/mail-source";
import {
  diagnoseMailInput,
  encodeMailFailure,
  type MailConfigReason,
  type MailTestInput,
  type MailTestSource,
  parseMailRecipient,
  parseMailTestBody,
  redactMailDetail,
} from "../../shared/mail-test";
import { decryptString } from "../crypto/secret";
import { getDb } from "../db/client";
import { mailSettings } from "../db/schema";
import { ApiError } from "../http";
import {
  mailPasswordUnreadable,
  mailReasonMessage,
  mailStageMessage,
} from "../notify/copy";
import { deliverWith, resolveMail } from "./resolve";
import type { MailResult } from "./smtp";
import { smtpSecurity } from "./smtp";

const loopbackSmtpSchema = z.object({
  driver: z.literal("smtp"),
  host: z.string().regex(/^(127\.0\.0\.1|localhost|::1)$/i),
  port: z.number().int().min(1024).max(65535),
  security: z.enum(["starttls", "tls", "none"]),
  username: z.string().max(200).default(""),
  password: z.string().max(200).optional(),
  clearPassword: z.boolean().optional(),
  fromName: z.string().min(1).max(80),
  fromAddress: z.string().email(),
  email: z.string().email().optional(),
});

type MailRow = typeof mailSettings.$inferSelect;

export type PublicMailError = {
  code: "mail";
  message: string;
  stage: "config" | "connect" | "tls" | "auth" | "send";
  reason?: MailConfigReason;
  detail?: string;
};

type MailFailure = Extract<MailResult, { ok: false }>;

export type MailTestBody = {
  ok: boolean;
  source: MailTestSource;
  recorded: boolean;
  secretsOverride: boolean;
  error?: PublicMailError;
};

export function publicMailFailure(
  result: MailFailure,
  secrets: Array<string | undefined>,
): PublicMailError {
  const hidden = secrets.filter((item): item is string =>
    Boolean(item && item.trim().length >= 3),
  );
  const safe = result.reason
    ? undefined
    : redactMailDetail(result.message, hidden);
  const message = result.reason
    ? mailReasonMessage(result.reason)
    : mailStageMessage(result.stage);
  return {
    code: "mail",
    message,
    stage: result.stage,
    ...(result.reason ? { reason: result.reason } : {}),
    ...(safe ? { detail: safe } : {}),
  };
}

function failureResponse(
  result: MailFailure,
  source: MailTestSource,
  recorded: boolean,
  secretsOverride: boolean,
  secrets: Array<string | undefined>,
): MailTestBody {
  return {
    ok: false,
    source,
    recorded,
    secretsOverride,
    error: publicMailFailure(result, secrets),
  };
}

function configFailure(reason: MailConfigReason): MailFailure {
  return {
    ok: false,
    stage: "config",
    reason,
    permanent: true,
    message: reason,
  };
}

async function loadRow(env: Env): Promise<MailRow | undefined> {
  return getDb(env.DB)
    .select()
    .from(mailSettings)
    .where(eq(mailSettings.id, 1))
    .get();
}

function text(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function typedPassword(body: MailTestInput): string {
  if (body.driver !== "smtp" || body.clearPassword) return "";
  return body.password?.trim() ?? "";
}

async function matchesSaved(
  env: Env,
  row: MailRow,
  body: MailTestInput,
): Promise<boolean> {
  if (row.driver !== body.driver) return false;
  if (body.driver === "none") return true;
  if (text(row.fromName) !== text(body.fromName)) return false;
  if (text(row.fromAddress) !== text(body.fromAddress)) return false;
  if (body.driver === "cf-email") return true;
  if (text(row.host) !== text(body.host)) return false;
  if ((row.port ?? null) !== body.port) return false;
  if (smtpSecurity(row.security) !== body.security) return false;
  if (text(row.username) !== text(body.username)) return false;
  if (body.clearPassword) return !row.passwordEncrypted;
  const password = typedPassword(body);
  if (!password) return true;
  if (!row.passwordEncrypted || !env.ENCRYPTION_KEY) return false;
  try {
    const stored = await decryptString(
      env.ENCRYPTION_KEY,
      row.passwordEncrypted,
    );
    return stored === password;
  } catch {
    return false;
  }
}

function transientRow(
  body: MailTestInput,
  stored: MailRow | undefined,
): MailRow {
  const now = Date.now();
  const blank = {
    lastTestOk: null,
    lastTestAt: null,
    lastTestError: null,
    updatedAt: now,
  };
  if (body.driver === "none") {
    return {
      id: 1,
      driver: "none",
      host: null,
      port: null,
      security: null,
      username: null,
      passwordEncrypted: null,
      fromName: null,
      fromAddress: null,
      ...blank,
    };
  }
  if (body.driver === "cf-email") {
    return {
      id: 1,
      driver: "cf-email",
      host: null,
      port: null,
      security: null,
      username: null,
      passwordEncrypted: null,
      fromName: body.fromName.trim(),
      fromAddress: body.fromAddress.trim(),
      ...blank,
    };
  }
  const password = typedPassword(body);
  return {
    id: 1,
    driver: "smtp",
    host: body.host.trim(),
    port: body.port,
    security: body.security,
    username: body.username.trim(),
    passwordEncrypted:
      body.clearPassword || password
        ? null
        : (stored?.passwordEncrypted ?? null),
    fromName: body.fromName.trim(),
    fromAddress: body.fromAddress.trim(),
    ...blank,
  };
}

function parseBody(env: Env, raw: unknown): MailTestInput {
  const parsed = parseMailTestBody(raw);
  if (parsed.ok) return parsed.data;
  if (env.ALLOW_TEST_MAIL === "1") {
    const loopback = loopbackSmtpSchema.safeParse(raw);
    if (loopback.success) return loopback.data;
  }
  const reason = diagnoseMailInput(raw);
  if (reason) throw new MailConfigSignal(reason);
  throw new ApiError(
    400,
    "validation",
    parsed.message === "Invalid email"
      ? t("error_invalid_email")
      : t("error_validation"),
  );
}

class MailConfigSignal extends Error {
  constructor(readonly reason: MailConfigReason) {
    super(reason);
  }
}

async function recordResult(
  env: Env,
  result: MailResult,
  secrets: Array<string | undefined>,
): Promise<void> {
  const error = result.ok ? undefined : publicMailFailure(result, secrets);
  await getDb(env.DB)
    .update(mailSettings)
    .set({
      lastTestOk: result.ok,
      lastTestAt: Date.now(),
      lastTestError: error
        ? encodeMailFailure({
            stage: error.stage,
            reason: error.reason,
            detail: error.reason ? undefined : error.detail,
          })
        : null,
    })
    .where(eq(mailSettings.id, 1));
}

export function mailConfigChanged(
  existing: MailRow | undefined,
  next: {
    driver: string;
    host: string | null;
    port: number | null;
    security: string | null;
    username: string | null;
    passwordEncrypted: string | null;
    fromName: string | null;
    fromAddress: string | null;
  },
): boolean {
  if (!existing) return false;
  return (
    existing.driver !== next.driver ||
    text(existing.host) !== text(next.host) ||
    (existing.port ?? null) !== (next.port ?? null) ||
    (existing.security ?? null) !== (next.security ?? null) ||
    text(existing.username) !== text(next.username) ||
    (existing.passwordEncrypted ?? null) !== (next.passwordEncrypted ?? null) ||
    text(existing.fromName) !== text(next.fromName) ||
    text(existing.fromAddress) !== text(next.fromAddress)
  );
}

function unreadablePassword(): MailFailure {
  return {
    ok: false,
    stage: "config",
    permanent: true,
    message: mailPasswordUnreadable(),
  };
}

export async function executeMailTest(
  env: Env,
  raw: unknown,
  message: { toFallback: string; subject: string; text: string },
): Promise<MailTestBody> {
  const row = await loadRow(env);
  const secretsOverride = describeMailSource(env, row?.driver) === "secrets";
  if (secretsOverride) {
    const recipient = parseMailRecipient(raw);
    if (!recipient.ok)
      throw new ApiError(400, "validation", t("error_invalid_email"));
    const resolved = await resolveMail(env, row ?? null);
    const result = await deliverWith(env, resolved, {
      to: recipient.email ?? message.toFallback,
      subject: message.subject,
      text: message.text,
      messageId: `<${crypto.randomUUID()}@flarebot.local>`,
    });
    const secrets = [env.SMTP_PASSWORD, env.ENCRYPTION_KEY];
    if (!result.ok)
      return failureResponse(result, "secrets", false, true, secrets);
    return {
      ok: true,
      source: "secrets",
      recorded: false,
      secretsOverride: true,
    };
  }

  let body: MailTestInput;
  try {
    body = parseBody(env, raw);
  } catch (error) {
    if (error instanceof MailConfigSignal) {
      return failureResponse(
        configFailure(error.reason),
        "form",
        false,
        false,
        [],
      );
    }
    throw error;
  }

  const draft = transientRow(body, row);
  const password = typedPassword(body);
  const matches = row ? await matchesSaved(env, row, body) : false;
  const source: MailTestSource = matches ? "saved" : "form";
  const secrets = [password, env.SMTP_PASSWORD, env.ENCRYPTION_KEY];

  if (
    body.driver === "smtp" &&
    !password &&
    !body.clearPassword &&
    draft.passwordEncrypted &&
    !env.ENCRYPTION_KEY
  ) {
    const failure = configFailure("missing_encryption_key");
    if (matches) await recordResult(env, failure, secrets);
    return failureResponse(failure, source, matches, false, secrets);
  }

  let resolved: Awaited<ReturnType<typeof resolveMail>>;
  try {
    resolved = await resolveMail(
      env,
      draft,
      password ? { password } : undefined,
    );
  } catch {
    const failure = unreadablePassword();
    if (matches) await recordResult(env, failure, secrets);
    return failureResponse(failure, source, matches, false, secrets);
  }

  const result = await deliverWith(env, resolved, {
    to: body.email ?? message.toFallback,
    subject: message.subject,
    text: message.text,
    messageId: `<${crypto.randomUUID()}@flarebot.local>`,
  });
  if (matches)
    await recordResult(env, result, [
      password,
      resolved.smtp?.password,
      env.ENCRYPTION_KEY,
    ]);
  if (!result.ok) {
    return failureResponse(result, source, matches, false, [
      password,
      resolved.smtp?.password,
      env.ENCRYPTION_KEY,
    ]);
  }
  return { ok: true, source, recorded: matches, secretsOverride: false };
}
