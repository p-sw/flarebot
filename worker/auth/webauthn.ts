// SPDX-License-Identifier: MIT

import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { and, eq, gt } from "drizzle-orm";
import { t } from "../../shared/copy";
import { b64ToBytes, bytesToB64 } from "../crypto/secret";
import { getDb } from "../db/client";
import { credentials, webauthnChallenges } from "../db/schema";
import { ApiError, type AppContext } from "../http";

const CHALLENGE_MS = 5 * 60_000;

export function rpFromRequest(c: AppContext): { rpID: string; origin: string } {
  const url = new URL(c.req.url);
  return { rpID: url.hostname, origin: url.origin };
}

async function storeChallenge(
  env: Env,
  challenge: string,
  type: string,
  userId: string | null,
): Promise<void> {
  const db = getDb(env.DB);
  await db.insert(webauthnChallenges).values({
    id: crypto.randomUUID(),
    userId,
    challenge,
    type,
    expiresAt: Date.now() + CHALLENGE_MS,
  });
}

async function takeChallenge(
  env: Env,
  challenge: string,
  type: string,
): Promise<{ userId: string | null } | null> {
  const db = getDb(env.DB);
  const row = await db
    .select()
    .from(webauthnChallenges)
    .where(
      and(
        eq(webauthnChallenges.challenge, challenge),
        eq(webauthnChallenges.type, type),
        gt(webauthnChallenges.expiresAt, Date.now()),
      ),
    )
    .get();
  if (!row) return null;
  await db.delete(webauthnChallenges).where(eq(webauthnChallenges.id, row.id));
  return { userId: row.userId };
}

export async function registrationOptions(
  c: AppContext,
  user: { id: string; email: string; name: string },
) {
  const { rpID } = rpFromRequest(c);
  const db = getDb(c.env.DB);
  const existing = await db
    .select()
    .from(credentials)
    .where(eq(credentials.userId, user.id));
  const options = await generateRegistrationOptions({
    rpName: "Flarebot",
    rpID,
    userName: user.email,
    userID: Uint8Array.from(new TextEncoder().encode(user.id)),
    userDisplayName: user.name,
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
    excludeCredentials: existing.map((row) => ({
      id: row.credentialId,
      transports: row.transportsJson
        ? (JSON.parse(row.transportsJson) as string[])
        : undefined,
    })),
  });
  await storeChallenge(c.env, options.challenge, "registration", user.id);
  return options;
}

export async function verifyRegistration(
  c: AppContext,
  userId: string,
  response: RegistrationResponseJSON,
  deviceName: string | undefined,
) {
  const { origin, rpID } = rpFromRequest(c);
  const challenge = response.response.clientDataJSON;
  const client = JSON.parse(
    new TextDecoder().decode(b64UrlToBytes(challenge)),
  ) as { challenge?: string };
  const expected = client.challenge;
  if (!expected)
    throw new ApiError(400, "webauthn", t("error_challenge_missing"));
  const stored = await takeChallenge(c.env, expected, "registration");
  if (!stored || stored.userId !== userId)
    throw new ApiError(400, "webauthn", t("error_challenge_expired"));
  const verified = await verifyRegistrationResponse({
    response,
    expectedChallenge: expected,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: false,
  });
  if (!verified.verified)
    throw new ApiError(400, "webauthn", t("error_passkey_rejected"));
  const credential = verified.registrationInfo.credential;
  const db = getDb(c.env.DB);
  await db.insert(credentials).values({
    id: crypto.randomUUID(),
    userId,
    credentialId: credential.id,
    publicKey: bytesToB64(credential.publicKey),
    counter: credential.counter,
    deviceName: deviceName?.slice(0, 80) ?? t("passkey_default_name"),
    transportsJson: credential.transports
      ? JSON.stringify(credential.transports)
      : null,
    createdAt: Date.now(),
  });
  return { id: credential.id };
}

export async function authenticationOptions(c: AppContext) {
  const { rpID } = rpFromRequest(c);
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "preferred",
  });
  await storeChallenge(c.env, options.challenge, "authentication", null);
  return options;
}

export async function verifyAuthentication(
  c: AppContext,
  response: AuthenticationResponseJSON,
) {
  const { origin, rpID } = rpFromRequest(c);
  const client = JSON.parse(
    new TextDecoder().decode(b64UrlToBytes(response.response.clientDataJSON)),
  ) as { challenge?: string };
  const expected = client.challenge;
  if (!expected)
    throw new ApiError(400, "webauthn", t("error_challenge_missing"));
  const stored = await takeChallenge(c.env, expected, "authentication");
  if (!stored)
    throw new ApiError(400, "webauthn", t("error_challenge_expired"));
  const db = getDb(c.env.DB);
  const credential = await db
    .select()
    .from(credentials)
    .where(eq(credentials.credentialId, response.id))
    .get();
  if (!credential)
    throw new ApiError(401, "unauthorized", t("error_unknown_passkey"));
  const verified = await verifyAuthenticationResponse({
    response,
    expectedChallenge: expected,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: false,
    credential: {
      id: credential.credentialId,
      publicKey: Uint8Array.from(b64ToBytes(credential.publicKey)),
      counter: credential.counter,
      transports: credential.transportsJson
        ? (JSON.parse(credential.transportsJson) as string[])
        : undefined,
    },
  });
  if (!verified.verified)
    throw new ApiError(401, "unauthorized", t("error_passkey_rejected"));
  await db
    .update(credentials)
    .set({ counter: verified.authenticationInfo.newCounter })
    .where(eq(credentials.id, credential.id));
  return credential.userId;
}

function b64UrlToBytes(value: string): Uint8Array {
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return b64ToBytes(padded);
}
