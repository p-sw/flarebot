// SPDX-License-Identifier: MIT

import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { describeMailSource } from "../shared/mail-source";
import { encryptString } from "../worker/crypto/secret";
import { api, ownerSession } from "./helpers";
import { SMTP_PORTS } from "./smtp-ports";

const mutable = env as unknown as Record<string, string | undefined>;

async function resetMail(): Promise<void> {
  await env.DB.prepare("DELETE FROM mail_settings").run();
}

async function withEnv(
  values: Record<string, string | undefined>,
  task: () => Promise<void>,
): Promise<void> {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = mutable[key];
    mutable[key] = value;
  }
  try {
    await task();
  } finally {
    for (const [key, value] of Object.entries(previous)) mutable[key] = value;
  }
}

function smtp(overrides: Record<string, unknown> = {}) {
  return {
    driver: "smtp",
    host: "10.0.0.8",
    port: 587,
    security: "starttls",
    username: "bot",
    password: "secret",
    fromName: "Flarebot",
    fromAddress: "bot@example.com",
    email: "ops@example.com",
    ...overrides,
  };
}

async function post(owner: string, body: unknown): Promise<Response> {
  return api(
    "/api/settings/mail/test",
    { method: "POST", body: JSON.stringify(body) },
    owner,
  );
}

async function rowCount(): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM mail_settings",
  ).first<{ n: number }>();
  return Number(row?.n ?? 0);
}

describe("mail settings test", () => {
  it("describes secret override the same way delivery does", () => {
    expect(
      describeMailSource(
        { SMTP_HOST: "smtp.example.com", MAIL_FROM: "a@b.co" },
        "none",
      ),
    ).toBe("secrets");
    expect(describeMailSource({ SMTP_HOST: "smtp.example.com" }, "smtp")).toBe(
      "database",
    );
    expect(describeMailSource({ MAIL_FROM: "a@b.co" }, "smtp")).toBe(
      "database",
    );
    expect(describeMailSource({}, "cf-email")).toBe("cloudflare");
    expect(describeMailSource({}, "none")).toBe("none");
  });

  it("tests unsaved form values and does not create a row", async () => {
    await resetMail();
    const owner = await ownerSession();
    const response = await post(owner, smtp());
    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      source: string;
      recorded: boolean;
      secretsOverride: boolean;
      error: { reason?: string; stage?: string; message?: string };
    };
    expect(body.error.reason).toBe("blocked_host");
    expect(body.error.stage).toBe("config");
    expect(body.error.message).not.toBe("config");
    expect(body.source).toBe("form");
    expect(body.recorded).toBe(false);
    expect(body.secretsOverride).toBe(false);
    expect(await rowCount()).toBe(0);
    expect(JSON.stringify(body.error)).not.toContain("secret");
  });

  it("reports each configuration reason", async () => {
    await resetMail();
    const owner = await ownerSession();
    const cases: Array<{ body: unknown; reason: string }> = [
      {
        body: { driver: "none", email: "ops@example.com" },
        reason: "not_configured",
      },
      { body: {}, reason: "not_configured" },
      {
        body: {
          driver: "smtp",
          host: "smtp.example.com",
          port: 587,
          security: "starttls",
          username: "",
          fromName: "Flarebot",
          fromAddress: "",
          email: "ops@example.com",
        },
        reason: "missing_from",
      },
      {
        body: {
          driver: "cf-email",
          fromName: "Flarebot",
          email: "ops@example.com",
        },
        reason: "missing_from",
      },
      { body: { driver: "smtp", port: 587 }, reason: "incomplete_smtp" },
      {
        body: smtp({ host: "smtp.example.com", port: 25 }),
        reason: "port_25",
      },
      {
        body: smtp({ host: "smtp.example.com", port: 2525 }),
        reason: "unsupported_port",
      },
      { body: smtp({ host: "192.168.1.20" }), reason: "blocked_host" },
      { body: smtp({ host: "queue.internal" }), reason: "blocked_host" },
      {
        body: {
          driver: "cf-email",
          fromName: "Flarebot",
          fromAddress: "bot@example.com",
          email: "ops@example.com",
        },
        reason: "missing_binding",
      },
    ];
    for (const item of cases) {
      const response = await post(owner, item.body);
      expect(response.status, JSON.stringify(item.body)).toBe(400);
      const body = (await response.json()) as {
        recorded: boolean;
        error: { code?: string; reason?: string; stage?: string };
      };
      expect(body.error.code, JSON.stringify(item.body)).toBe("mail");
      expect(body.error.reason, JSON.stringify(item.body)).toBe(item.reason);
      expect(body.error.stage).toBe("config");
      expect(body.recorded).toBe(false);
    }
    expect(await rowCount()).toBe(0);

    const invalid = await post(owner, { driver: "pigeon" });
    expect(invalid.status).toBe(400);
    const invalidBody = (await invalid.json()) as { error: { code?: string } };
    expect(invalidBody.error.code).toBe("validation");
  });

  it("falls back to the stored password and does not echo it", async () => {
    await resetMail();
    const owner = await ownerSession();
    const key = env.ENCRYPTION_KEY;
    if (!key) throw new Error("ENCRYPTION_KEY is not set");
    const encrypted = await encryptString(key, "secret");
    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO mail_settings (
        id, driver, host, port, security, username, password_encrypted,
        from_name, from_address, updated_at
      ) VALUES (1, 'smtp', '127.0.0.1', ?, 'starttls', 'bot', ?, 'Flarebot', 'bot@example.com', ?)`,
    )
      .bind(SMTP_PORTS.ok, encrypted, now)
      .run();

    const accepted = await post(owner, {
      driver: "smtp",
      host: "127.0.0.1",
      port: SMTP_PORTS.ok,
      security: "starttls",
      username: "bot",
      fromName: "Flarebot",
      fromAddress: "bot@example.com",
      email: "ops@example.com",
    });
    expect(accepted.status, await accepted.clone().text()).toBe(200);
    const acceptedBody = (await accepted.json()) as {
      source: string;
      recorded: boolean;
    };
    expect(acceptedBody).toMatchObject({
      ok: true,
      source: "saved",
      recorded: true,
      secretsOverride: false,
    });

    const wrong = await post(owner, {
      driver: "smtp",
      host: "127.0.0.1",
      port: SMTP_PORTS.ok,
      security: "starttls",
      username: "bot",
      password: "not-the-stored-password",
      fromName: "Flarebot",
      fromAddress: "bot@example.com",
      email: "ops@example.com",
    });
    expect(wrong.status).toBe(400);
    const wrongBody = (await wrong.json()) as {
      recorded: boolean;
      error: { stage?: string; detail?: string; message?: string };
    };
    expect(wrongBody.error.stage).toBe("auth");
    expect(wrongBody.recorded).toBe(false);
    const wrongText = JSON.stringify(wrongBody.error);
    expect(wrongText).not.toContain("secret");
    expect(wrongText).not.toContain("not-the-stored-password");
    expect(wrongBody.error.detail).toContain("535");

    const stored = await env.DB.prepare(
      "SELECT password_encrypted, host, last_test_ok FROM mail_settings WHERE id = 1",
    ).first<{
      password_encrypted: string;
      host: string;
      last_test_ok: number;
    }>();
    expect(stored?.password_encrypted).toBe(encrypted);
    expect(stored?.host).toBe("127.0.0.1");
    expect(stored?.last_test_ok).toBe(1);

    const view = await api("/api/settings/mail", {}, owner);
    const visible = await view.text();
    expect(visible).not.toContain('"secret"');
    expect(visible).not.toContain(encrypted);
    expect(visible).toContain('"hasPassword":true');
  });

  it("records last_test only when the form matches the saved row", async () => {
    await resetMail();
    const owner = await ownerSession();
    const saved = await api(
      "/api/settings/mail",
      { method: "PUT", body: JSON.stringify(smtp()) },
      owner,
    );
    expect(saved.status).toBe(200);

    const matched = await post(owner, smtp({ password: undefined }));
    expect(matched.status).toBe(400);
    const matchedBody = (await matched.json()) as {
      source: string;
      recorded: boolean;
      error: { reason?: string };
    };
    expect(matchedBody.error.reason).toBe("blocked_host");
    expect(matchedBody.source).toBe("saved");
    expect(matchedBody.recorded).toBe(true);

    const first = await env.DB.prepare(
      "SELECT host, last_test_ok, last_test_at, last_test_error FROM mail_settings WHERE id = 1",
    ).first<{
      host: string;
      last_test_ok: number;
      last_test_at: number;
      last_test_error: string;
    }>();
    expect(first?.host).toBe("10.0.0.8");
    expect(first?.last_test_ok).toBe(0);
    expect(first?.last_test_at).toBeGreaterThan(0);
    expect(JSON.parse(first?.last_test_error ?? "{}")).toMatchObject({
      stage: "config",
      reason: "blocked_host",
    });

    const other = await post(
      owner,
      smtp({ host: "10.0.0.9", password: undefined }),
    );
    expect(other.status).toBe(400);
    const otherBody = (await other.json()) as {
      source: string;
      recorded: boolean;
    };
    expect(otherBody.source).toBe("form");
    expect(otherBody.recorded).toBe(false);
    const second = await env.DB.prepare(
      "SELECT host, last_test_error FROM mail_settings WHERE id = 1",
    ).first<{ host: string; last_test_error: string }>();
    expect(second?.host).toBe("10.0.0.8");
    expect(second?.last_test_error).toBe(first?.last_test_error);

    const changed = await api(
      "/api/settings/mail",
      { method: "PUT", body: JSON.stringify(smtp({ host: "10.0.0.9" })) },
      owner,
    );
    expect(changed.status).toBe(200);
    const cleared = await env.DB.prepare(
      "SELECT host, last_test_at FROM mail_settings WHERE id = 1",
    ).first<{ host: string; last_test_at: number | null }>();
    expect(cleared?.host).toBe("10.0.0.9");
    expect(cleared?.last_test_at).toBeNull();
  });

  it("refuses to read a stored password when the encryption key is missing", async () => {
    await resetMail();
    const owner = await ownerSession();
    const key = env.ENCRYPTION_KEY;
    if (!key) throw new Error("ENCRYPTION_KEY is not set");
    const encrypted = await encryptString(key, "secret");
    await env.DB.prepare(
      `INSERT INTO mail_settings (
        id, driver, host, port, security, username, password_encrypted,
        from_name, from_address, updated_at
      ) VALUES (1, 'smtp', '10.0.0.8', 587, 'starttls', 'bot', ?, 'Flarebot', 'bot@example.com', ?)`,
    )
      .bind(encrypted, Date.now())
      .run();
    await withEnv({ ENCRYPTION_KEY: "" }, async () => {
      const response = await post(owner, smtp({ password: undefined }));
      expect(response.status).toBe(400);
      const body = (await response.json()) as {
        error: { reason?: string };
        recorded: boolean;
      };
      expect(body.error.reason).toBe("missing_encryption_key");
      expect(body.recorded).toBe(true);
    });
    expect(env.ENCRYPTION_KEY).toBe(key);
  });

  it("tests worker secrets instead of the form when they override", async () => {
    await resetMail();
    const owner = await ownerSession();
    await withEnv(
      {
        SMTP_HOST: "10.9.8.7",
        MAIL_FROM: "secrets@example.com",
        SMTP_PORT: "587",
        SMTP_PASSWORD: "from-env",
      },
      async () => {
        const response = await post(owner, {
          driver: "none",
          email: "ops@example.com",
        });
        expect(response.status).toBe(400);
        const body = (await response.json()) as {
          source: string;
          recorded: boolean;
          secretsOverride: boolean;
          error: { reason?: string };
        };
        expect(body.error.reason).toBe("blocked_host");
        expect(body.source).toBe("secrets");
        expect(body.recorded).toBe(false);
        expect(body.secretsOverride).toBe(true);
        expect(JSON.stringify(body)).not.toContain("from-env");
        expect(await rowCount()).toBe(0);

        const listed = await api("/api/settings/mail", {}, owner);
        const mail = (await listed.json()) as { secretsOverride: boolean };
        expect(mail.secretsOverride).toBe(true);
      },
    );

    await withEnv({ SMTP_HOST: "10.9.8.7", MAIL_FROM: "" }, async () => {
      const response = await post(owner, {
        driver: "none",
        email: "ops@example.com",
      });
      const body = (await response.json()) as {
        source: string;
        error: { reason?: string };
      };
      expect(body.error.reason).toBe("not_configured");
      expect(body.source).toBe("form");
    });

    await withEnv(
      {
        SMTP_HOST: "smtp.example.com",
        MAIL_FROM: "secrets@example.com",
        SMTP_PORT: "25",
      },
      async () => {
        const response = await post(owner, smtp({ host: "10.0.0.8" }));
        const body = (await response.json()) as { error: { reason?: string } };
        expect(body.error.reason).toBe("port_25");
      },
    );
    expect(env.SMTP_HOST).toBeUndefined();
    expect(env.MAIL_FROM).toBeUndefined();
  });
});
