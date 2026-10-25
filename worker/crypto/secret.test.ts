// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import {
  base32Encode,
  decryptString,
  encryptString,
  hashPassword,
  totpCode,
  verifyPassword,
  verifyTotp,
} from "./secret";

const KEY = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=";

describe("secrets", () => {
  it("round-trips a password and a ciphertext", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("nope", hash)).toBe(false);
    const cipher = await encryptString(KEY, "smtp-password");
    expect(cipher.startsWith("v1.")).toBe(true);
    expect(await decryptString(KEY, cipher)).toBe("smtp-password");
  });

  it("accepts the current TOTP window", async () => {
    const secret = new Uint8Array(20).fill(3);
    const now = 1_700_000_000_000;
    const code = await totpCode(secret, now);
    expect(await verifyTotp(secret, code, now + 10_000)).toBe(true);
    expect(await verifyTotp(secret, "000000", now)).toBe(false);
    expect(base32Encode(secret)).toMatch(/^[A-Z2-7]+$/);
  });
});
