// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { bytesToB64Url } from "../crypto/secret";
import { verifyJwt } from "./jwt";

const text = new TextEncoder();

function b64urlJson(value: unknown): string {
  return bytesToB64Url(text.encode(JSON.stringify(value)));
}

async function rs256() {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  if (!("privateKey" in pair)) throw new Error("expected a key pair");
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return {
    privateKey: pair.privateKey,
    jwk: { ...jwk, kid: "k1", alg: "RS256", use: "sig" },
  };
}

async function sign(
  privateKey: CryptoKey,
  payload: Record<string, unknown>,
  header: Record<string, unknown> = { alg: "RS256", kid: "k1", typ: "JWT" },
): Promise<string> {
  const encodedHeader = b64urlJson(header);
  const encodedPayload = b64urlJson(payload);
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      privateKey,
      text.encode(`${encodedHeader}.${encodedPayload}`),
    ),
  );
  return `${encodedHeader}.${encodedPayload}.${bytesToB64Url(signature)}`;
}

describe("jwt verification", () => {
  it("accepts an RS256 token and rejects none, a bad signature, and the wrong key id", async () => {
    const { privateKey, jwk } = await rs256();
    const token = await sign(privateKey, { sub: "user", exp: 10 });
    const ok = await verifyJwt(token, { keys: [jwk] });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.payload.sub).toBe("user");

    const noneHeader = b64urlJson({ alg: "none", typ: "JWT" });
    const nonePayload = b64urlJson({ sub: "user" });
    expect(
      (await verifyJwt(`${noneHeader}.${nonePayload}.`, { keys: [jwk] })).ok,
    ).toBe(false);

    const [encodedHeader, , signature] = token.split(".");
    const tampered = `${encodedHeader}.${b64urlJson({ sub: "other" })}.${signature}`;
    expect((await verifyJwt(tampered, { keys: [jwk] })).ok).toBe(false);

    const wrongKid = await verifyJwt(token, {
      keys: [{ ...jwk, kid: "other" }],
    });
    expect(wrongKid.ok).toBe(false);
    if (!wrongKid.ok) expect(wrongKid.reason).toBe("kid");
    const malformed = await verifyJwt("not-a-jwt", { keys: [jwk] });
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.reason).toBe("malformed");
  });
});
