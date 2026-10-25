// SPDX-License-Identifier: MIT

import { and, desc, eq, ne } from "drizzle-orm";
import type { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { z } from "zod";
import { missingTranslationCount } from "../../shared/content";
import { LOCALE_COOKIE } from "../../shared/locales";
import { describeMailSource } from "../../shared/mail-source";
import {
  assertScopesWithinRole,
  can,
  isRole,
  scopesForRole,
} from "../../shared/permissions";
import {
  accountPatchSchema,
  channelWriteSchema,
  inviteSchema,
  mailSettingsSchema,
  passwordChangeSchema,
  roleChangeSchema,
  statusPageRootSchema,
  statusPageWriteSchema,
  tokenCreateSchema,
  totpConfirmSchema,
} from "../../shared/schemas";
import {
  b64ToBytes,
  base32Encode,
  bytesToB64,
  decryptString,
  encryptString,
  hashPassword,
  randomToken,
  requireEncryptionKey,
  sha256Hex,
  verifyPassword,
  verifyTotp,
} from "../crypto/secret";
import { getDb } from "../db/client";
import {
  apiTokens,
  auditLog,
  credentials,
  emailTokens,
  invites,
  mailSettings,
  memberships,
  monitors,
  notificationChannels,
  sessions,
  statusPageItems,
  statusPages,
  users,
} from "../db/schema";
import {
  ApiError,
  type AppEnv,
  assertMutationOrigin,
  audit,
  clearLocaleCookie,
  clientIp,
  parseBody,
  requestOrigin,
  requireActor,
  requireCan,
  writeLocaleCookie,
} from "../http";
import { enqueueMail } from "../mail/mailer";
import { deliverWith, resolveMail } from "../mail/resolve";
import { inviteMail, resetMail, testMail } from "../notify/copy";
import { deliverChannel, sampleChannelText } from "../notify/dispatch";
import { instanceName, readSetting, writeSetting } from "../settings-store";
import { loadPublicStatus, loadRootPublicStatus } from "../status/public";
import { setServeAtRoot } from "../status/root";

const settingsSchema = z.object({
  instanceName: z.string().min(1).max(80).optional(),
  defaultLocale: z.enum(["en", "ko"]).optional(),
  authMode: z.enum(["local", "access"]).optional(),
});

async function ownerCount(env: Env, organizationId: string): Promise<number> {
  const rows = await getDb(env.DB)
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        eq(memberships.organizationId, organizationId),
        eq(memberships.role, "owner"),
      ),
    );
  return rows.length;
}

export function registerManage(app: Hono<AppEnv>): void {
  app.get("/api/channels", async (c) => {
    const actor = await requireActor(c);
    requireCan(actor, "channels.read");
    const rows = await getDb(c.env.DB)
      .select()
      .from(notificationChannels)
      .where(eq(notificationChannels.organizationId, actor.organizationId));
    const reveal = can(actor, "channels.write");
    const items = [];
    for (const row of rows) {
      let config: unknown;
      if (reveal && c.env.ENCRYPTION_KEY) {
        config = JSON.parse(
          await decryptString(c.env.ENCRYPTION_KEY, row.configEncrypted),
        );
      }
      items.push({
        id: row.id,
        name: row.name,
        type: row.type,
        locale: row.locale,
        config,
      });
    }
    return c.json({ channels: items });
  });

  app.post("/api/channels", async (c) => {
    const actor = await requireActor(c);
    assertMutationOrigin(c, actor);
    requireCan(actor, "channels.write");
    const body = await parseBody(c, channelWriteSchema);
    const id = crypto.randomUUID();
    const now = Date.now();
    await getDb(c.env.DB)
      .insert(notificationChannels)
      .values({
        id,
        organizationId: actor.organizationId,
        name: body.name,
        type: body.type,
        configEncrypted: await encryptString(
          requireEncryptionKey(c.env),
          JSON.stringify(body.config),
        ),
        locale: body.locale ?? null,
        createdAt: now,
        updatedAt: now,
      });
    await audit(
      c.env,
      actor,
      "channel.create",
      id,
      null,
      { name: body.name, type: body.type },
      clientIp(c),
    );
    return c.json({ id }, 201);
  });

  app.patch("/api/channels/:id", async (c) => {
    const actor = await requireActor(c);
    assertMutationOrigin(c, actor);
    requireCan(actor, "channels.write");
    const body = await parseBody(c, channelWriteSchema);
    const db = getDb(c.env.DB);
    const row = await db
      .select()
      .from(notificationChannels)
      .where(eq(notificationChannels.id, c.req.param("id")))
      .get();
    if (!row || row.organizationId !== actor.organizationId)
      throw new ApiError(404, "not_found", "Channel not found.");
    await db
      .update(notificationChannels)
      .set({
        name: body.name,
        type: body.type,
        locale: body.locale ?? null,
        configEncrypted: await encryptString(
          requireEncryptionKey(c.env),
          JSON.stringify(body.config),
        ),
        updatedAt: Date.now(),
      })
      .where(eq(notificationChannels.id, row.id));
    await audit(
      c.env,
      actor,
      "channel.update",
      row.id,
      { name: row.name },
      { name: body.name },
      clientIp(c),
    );
    return c.json({ id: row.id });
  });

  app.delete("/api/channels/:id", async (c) => {
    const actor = await requireActor(c);
    assertMutationOrigin(c, actor);
    requireCan(actor, "channels.write");
    const db = getDb(c.env.DB);
    const row = await db
      .select()
      .from(notificationChannels)
      .where(eq(notificationChannels.id, c.req.param("id")))
      .get();
    if (!row || row.organizationId !== actor.organizationId)
      throw new ApiError(404, "not_found", "Channel not found.");
    await db
      .delete(notificationChannels)
      .where(eq(notificationChannels.id, row.id));
    await audit(
      c.env,
      actor,
      "channel.delete",
      row.id,
      { name: row.name },
      null,
      clientIp(c),
    );
    return c.json({ ok: true });
  });

  app.post("/api/channels/:id/test", async (c) => {
    const actor = await requireActor(c);
    assertMutationOrigin(c, actor);
    requireCan(actor, "channels.write");
    const db = getDb(c.env.DB);
    const row = await db
      .select()
      .from(notificationChannels)
      .where(eq(notificationChannels.id, c.req.param("id")))
      .get();
    if (!row || row.organizationId !== actor.organizationId)
      throw new ApiError(404, "not_found", "Channel not found.");
    const config = JSON.parse(
      await decryptString(requireEncryptionKey(c.env), row.configEncrypted),
    ) as Record<string, unknown>;
    const sample = sampleChannelText(row.locale, row.name);
    if (row.type === "email") {
      const settings = await db
        .select()
        .from(mailSettings)
        .where(eq(mailSettings.id, 1))
        .get();
      const resolved = await resolveMail(c.env, settings ?? null);
      const result = await deliverWith(c.env, resolved, {
        to: String(config.to ?? actor.email),
        subject: sample.subject,
        text: sample.body,
        messageId: `<${crypto.randomUUID()}@flarebot.local>`,
      });
      if (!result.ok)
        return c.json(
          {
            error: {
              code: "mail",
              message: result.message ?? "Email failed",
              stage: result.stage,
            },
          },
          400,
        );
      return c.json({ ok: true });
    }
    const result = await deliverChannel(
      {
        type: row.type as "discord" | "slack" | "telegram" | "webhook",
        locale: row.locale,
        config,
      },
      { kind: "down", monitorName: row.name, reason: "test" },
      {},
    );
    if (!result.ok)
      return c.json(
        { error: { code: "mail", message: result.error ?? "Delivery failed" } },
        400,
      );
    return c.json({ ok: true });
  });

  app.get("/api/status-pages", async (c) => {
    const actor = await requireActor(c);
    requireCan(actor, "status_pages.read");
    const db = getDb(c.env.DB);
    const pages = await db
      .select()
      .from(statusPages)
      .where(eq(statusPages.organizationId, actor.organizationId));
    const items = await db.select().from(statusPageItems);
    return c.json({
      pages: pages.map((page) => ({
        id: page.id,
        slug: page.slug,
        title: page.title,
        published: page.published,
        serveAtRoot: page.serveAtRoot,
        locales: JSON.parse(page.localesJson) as string[],
        missing: missingTranslationCount(
          ["title", "description", "footer", "banner"],
          JSON.parse(page.localesJson) as string[],
          page.sourceLocale,
          JSON.parse(page.i18nJson),
          {
            title: page.title,
            description: page.description,
            footer: page.footer,
            banner: page.banner,
          },
        ),
        itemCount: items.filter((item) => item.pageId === page.id).length,
      })),
    });
  });

  app.post("/api/status-pages", async (c) => {
    const actor = await requireActor(c);
    assertMutationOrigin(c, actor);
    requireCan(actor, "status_pages.write");
    const body = await parseBody(c, statusPageWriteSchema);
    if (body.serveAtRoot && !body.published) {
      throw new ApiError(
        400,
        "validation",
        "Publish the page before serving it at the site root.",
      );
    }
    await assertMonitors(
      c.env,
      actor.organizationId,
      body.items.map((item) => item.monitorId),
    );
    const db = getDb(c.env.DB);
    const clash = await db
      .select({ id: statusPages.id })
      .from(statusPages)
      .where(eq(statusPages.slug, body.slug))
      .get();
    if (clash)
      throw new ApiError(409, "conflict", "That address is already used.");
    const id = crypto.randomUUID();
    const now = Date.now();
    await db.insert(statusPages).values({
      id,
      organizationId: actor.organizationId,
      slug: body.slug,
      published: body.published,
      defaultLocale: body.defaultLocale,
      localesJson: JSON.stringify(body.locales),
      sourceLocale: body.sourceLocale,
      title: body.title,
      description: body.description,
      footer: body.footer,
      banner: body.banner,
      i18nJson: JSON.stringify(body.i18n),
      logoUrl: body.logoUrl || null,
      accent: body.accent || null,
      createdAt: now,
      updatedAt: now,
    });
    for (const item of body.items) {
      await db.insert(statusPageItems).values({
        id: item.id ?? crypto.randomUUID(),
        pageId: id,
        monitorId: item.monitorId,
        position: item.position,
        groupName: item.groupName,
        displayName: item.displayName,
        sourceLocale: item.sourceLocale,
        i18nJson: JSON.stringify(item.i18n),
      });
    }
    if (body.serveAtRoot) await setServeAtRoot(c.env, id, true);
    await audit(
      c.env,
      actor,
      "status_page.create",
      id,
      null,
      { slug: body.slug, serveAtRoot: Boolean(body.serveAtRoot) },
      clientIp(c),
    );
    return c.json({ id }, 201);
  });

  app.get("/api/status-pages/:id", async (c) => {
    const actor = await requireActor(c);
    requireCan(actor, "status_pages.read");
    const page = await ownedPage(
      c.env,
      actor.organizationId,
      c.req.param("id"),
    );
    const items = await getDb(c.env.DB)
      .select()
      .from(statusPageItems)
      .where(eq(statusPageItems.pageId, page.id));
    items.sort((a, b) => a.position - b.position);
    return c.json({
      ...page,
      locales: JSON.parse(page.localesJson),
      i18n: JSON.parse(page.i18nJson),
      items: items.map((item) => ({
        ...item,
        i18n: JSON.parse(item.i18nJson),
      })),
    });
  });

  app.patch("/api/status-pages/:id", async (c) => {
    const actor = await requireActor(c);
    assertMutationOrigin(c, actor);
    requireCan(actor, "status_pages.write");
    const current = await ownedPage(
      c.env,
      actor.organizationId,
      c.req.param("id"),
    );
    const body = await parseBody(c, statusPageWriteSchema);
    if (body.serveAtRoot && !body.published) {
      throw new ApiError(
        400,
        "validation",
        "Publish the page before serving it at the site root.",
      );
    }
    await assertMonitors(
      c.env,
      actor.organizationId,
      body.items.map((item) => item.monitorId),
    );
    const db = getDb(c.env.DB);
    const clash = await db
      .select()
      .from(statusPages)
      .where(
        and(eq(statusPages.slug, body.slug), ne(statusPages.id, current.id)),
      )
      .get();
    if (clash)
      throw new ApiError(409, "conflict", "That address is already used.");
    await db
      .update(statusPages)
      .set({
        slug: body.slug,
        published: body.published,
        defaultLocale: body.defaultLocale,
        localesJson: JSON.stringify(body.locales),
        sourceLocale: body.sourceLocale,
        title: body.title,
        description: body.description,
        footer: body.footer,
        banner: body.banner,
        i18nJson: JSON.stringify(body.i18n),
        logoUrl: body.logoUrl || null,
        accent: body.accent || null,
        updatedAt: Date.now(),
      })
      .where(eq(statusPages.id, current.id));
    await db
      .delete(statusPageItems)
      .where(eq(statusPageItems.pageId, current.id));
    for (const item of body.items) {
      await db.insert(statusPageItems).values({
        id: item.id ?? crypto.randomUUID(),
        pageId: current.id,
        monitorId: item.monitorId,
        position: item.position,
        groupName: item.groupName,
        displayName: item.displayName,
        sourceLocale: item.sourceLocale,
        i18nJson: JSON.stringify(item.i18n),
      });
    }
    const serveAtRoot = body.published
      ? (body.serveAtRoot ?? current.serveAtRoot)
      : false;
    if (!body.published) {
      if (current.serveAtRoot) await setServeAtRoot(c.env, current.id, false);
    } else if (typeof body.serveAtRoot === "boolean") {
      await setServeAtRoot(c.env, current.id, body.serveAtRoot);
    }
    await audit(
      c.env,
      actor,
      "status_page.update",
      current.id,
      { slug: current.slug, serveAtRoot: current.serveAtRoot },
      { slug: body.slug, serveAtRoot },
      clientIp(c),
    );
    return c.json({ id: current.id });
  });

  app.put("/api/status-pages/:id/root", async (c) => {
    const actor = await requireActor(c);
    assertMutationOrigin(c, actor);
    requireCan(actor, "status_pages.write");
    const current = await ownedPage(
      c.env,
      actor.organizationId,
      c.req.param("id"),
    );
    const body = await parseBody(c, statusPageRootSchema);
    if (body.serveAtRoot && !current.published) {
      throw new ApiError(
        400,
        "validation",
        "Publish the page before serving it at the site root.",
      );
    }
    await setServeAtRoot(c.env, current.id, body.serveAtRoot);
    await audit(
      c.env,
      actor,
      "status_page.root",
      current.id,
      { serveAtRoot: current.serveAtRoot },
      { serveAtRoot: body.serveAtRoot },
      clientIp(c),
    );
    return c.json({ id: current.id, serveAtRoot: body.serveAtRoot });
  });

  app.delete("/api/status-pages/:id", async (c) => {
    const actor = await requireActor(c);
    assertMutationOrigin(c, actor);
    requireCan(actor, "status_pages.write");
    const page = await ownedPage(
      c.env,
      actor.organizationId,
      c.req.param("id"),
    );
    await getDb(c.env.DB)
      .delete(statusPages)
      .where(eq(statusPages.id, page.id));
    await audit(
      c.env,
      actor,
      "status_page.delete",
      page.id,
      { slug: page.slug },
      null,
      clientIp(c),
    );
    return c.json({ ok: true });
  });

  app.get("/api/public/status/:slug", async (c) => {
    const page = await loadPublicStatus(
      c.env,
      c.req.param("slug"),
      c.req.header("accept-language") ?? null,
      c.req.query("lang") ?? null,
      getCookie(c, LOCALE_COOKIE) ?? null,
    );
    if (!page) throw new ApiError(404, "not_found", "Status page not found.");
    const headers: Record<string, string> = {
      "cache-control": "private, no-store",
    };
    if (page.localeSource === "header") headers.vary = "Accept-Language";
    if (page.localeSource === "cookie") headers.vary = "Cookie";
    return c.json(page, 200, headers);
  });

  app.get("/api/public/root", async (c) => {
    const page = await loadRootPublicStatus(
      c.env,
      c.req.header("accept-language") ?? null,
      c.req.query("lang") ?? null,
      getCookie(c, LOCALE_COOKIE) ?? null,
    );
    if (!page) throw new ApiError(404, "not_found", "Status page not found.");
    const headers: Record<string, string> = {
      "cache-control": "private, no-store",
    };
    if (page.localeSource === "header") headers.vary = "Accept-Language";
    if (page.localeSource === "cookie") headers.vary = "Cookie";
    return c.json(page, 200, headers);
  });

  app.get("/api/team", async (c) => {
    const actor = await requireActor(c);
    requireCan(actor, "users.read");
    const db = getDb(c.env.DB);
    const members = await db
      .select()
      .from(memberships)
      .where(eq(memberships.organizationId, actor.organizationId));
    const people = await db.select().from(users);
    const pending = await db
      .select()
      .from(invites)
      .where(eq(invites.organizationId, actor.organizationId));
    return c.json({
      members: members.map((member) => {
        const user = people.find((person) => person.id === member.userId);
        return {
          id: member.userId,
          name: user?.name ?? "",
          email: user?.email ?? "",
          role: member.role,
          disabled: user?.disabled ?? false,
        };
      }),
      invites: pending
        .filter((invite) => !invite.usedAt && invite.expiresAt > Date.now())
        .map((invite) => ({
          id: invite.id,
          email: invite.email,
          role: invite.role,
          expiresAt: invite.expiresAt,
        })),
    });
  });

  app.post("/api/team/invites", async (c) => {
    const actor = await requireActor(c);
    assertMutationOrigin(c, actor);
    requireCan(actor, "users.invite");
    const body = await parseBody(c, inviteSchema);
    const token = randomToken();
    const now = Date.now();
    const id = crypto.randomUUID();
    await getDb(c.env.DB)
      .insert(invites)
      .values({
        id,
        tokenHash: await sha256Hex(token),
        organizationId: actor.organizationId,
        role: body.role,
        email: body.email?.toLowerCase() ?? null,
        createdBy: actor.userId,
        expiresAt: now + 7 * 86_400_000,
        usedAt: null,
        usedBy: null,
      });
    const link = `${requestOrigin(c)}/invite/${token}`;
    if (body.email) {
      const copy = inviteMail(actor.locale, {
        name: body.email,
        instance: await instanceName(c.env),
        role: body.role,
        link,
      });
      await enqueueMail(c.env, {
        kind: "invite",
        to: body.email,
        subject: copy.subject,
        text: copy.text,
      }).catch(() => undefined);
    }
    await audit(
      c.env,
      actor,
      "user.invite",
      id,
      null,
      { role: body.role, email: body.email ?? null },
      clientIp(c),
    );
    return c.json({ id, link }, 201);
  });

  app.post("/api/team/:userId/role", async (c) => {
    const actor = await requireActor(c);
    assertMutationOrigin(c, actor);
    requireCan(actor, "users.role");
    const body = await parseBody(c, roleChangeSchema);
    if (body.role === "owner")
      throw new ApiError(
        403,
        "forbidden",
        "Transfer ownership instead of assigning the owner role.",
      );
    const db = getDb(c.env.DB);
    const target = await db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, c.req.param("userId")),
          eq(memberships.organizationId, actor.organizationId),
        ),
      )
      .get();
    if (!target || !isRole(target.role))
      throw new ApiError(404, "not_found", "Member not found.");
    if (target.role === "owner" && actor.role !== "owner")
      throw new ApiError(
        403,
        "forbidden",
        "Only an owner can change another owner.",
      );
    if (
      target.role === "owner" &&
      (await ownerCount(c.env, actor.organizationId)) <= 1
    ) {
      throw new ApiError(409, "conflict", "Keep at least one owner.");
    }
    await db
      .update(memberships)
      .set({ role: body.role })
      .where(eq(memberships.id, target.id));
    await audit(
      c.env,
      actor,
      "user.role",
      target.userId,
      { role: target.role },
      { role: body.role },
      clientIp(c),
    );
    return c.json({ ok: true });
  });

  app.post("/api/team/:userId/disable", async (c) => {
    const actor = await requireActor(c);
    assertMutationOrigin(c, actor);
    requireCan(actor, "users.role");
    const body = await parseBody(c, z.object({ disabled: z.boolean() }));
    const db = getDb(c.env.DB);
    const target = await db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, c.req.param("userId")),
          eq(memberships.organizationId, actor.organizationId),
        ),
      )
      .get();
    if (!target) throw new ApiError(404, "not_found", "Member not found.");
    if (target.role === "owner") {
      if (actor.role !== "owner")
        throw new ApiError(
          403,
          "forbidden",
          "Only an owner can change another owner.",
        );
      if (body.disabled && (await ownerCount(c.env, actor.organizationId)) <= 1)
        throw new ApiError(409, "conflict", "Keep at least one owner.");
    }
    await db
      .update(users)
      .set({ disabled: body.disabled })
      .where(eq(users.id, target.userId));
    if (body.disabled)
      await db.delete(sessions).where(eq(sessions.userId, target.userId));
    await audit(
      c.env,
      actor,
      "user.disable",
      target.userId,
      null,
      { disabled: body.disabled },
      clientIp(c),
    );
    return c.json({ ok: true });
  });

  app.post("/api/team/transfer", async (c) => {
    const actor = await requireActor(c);
    assertMutationOrigin(c, actor);
    requireCan(actor, "instance.transfer");
    const body = await parseBody(c, z.object({ userId: z.string().uuid() }));
    if (body.userId === actor.userId)
      throw new ApiError(400, "validation", "Pick a different member.");
    const db = getDb(c.env.DB);
    const target = await db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, body.userId),
          eq(memberships.organizationId, actor.organizationId),
        ),
      )
      .get();
    if (!target) throw new ApiError(404, "not_found", "Member not found.");
    const user = await db
      .select()
      .from(users)
      .where(eq(users.id, target.userId))
      .get();
    if (!user || user.disabled)
      throw new ApiError(
        400,
        "validation",
        "That member cannot become the owner.",
      );
    const mine = await db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, actor.userId),
          eq(memberships.organizationId, actor.organizationId),
        ),
      )
      .get();
    if (!mine)
      throw new ApiError(403, "forbidden", "Owner membership is missing.");
    await db
      .update(memberships)
      .set({ role: "owner" })
      .where(eq(memberships.id, target.id));
    await db
      .update(memberships)
      .set({ role: "admin" })
      .where(eq(memberships.id, mine.id));
    await audit(
      c.env,
      actor,
      "instance.transfer",
      target.userId,
      { from: actor.userId },
      { to: target.userId },
      clientIp(c),
    );
    return c.json({ ok: true });
  });

  app.post("/api/team/:userId/reset", async (c) => {
    const actor = await requireActor(c);
    assertMutationOrigin(c, actor);
    requireCan(actor, "users.role");
    const db = getDb(c.env.DB);
    const target = await db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, c.req.param("userId")),
          eq(memberships.organizationId, actor.organizationId),
        ),
      )
      .get();
    if (!target) throw new ApiError(404, "not_found", "Member not found.");
    const user = await db
      .select()
      .from(users)
      .where(eq(users.id, target.userId))
      .get();
    if (!user) throw new ApiError(404, "not_found", "Member not found.");
    const token = randomToken();
    await db.insert(emailTokens).values({
      id: crypto.randomUUID(),
      tokenHash: await sha256Hex(token),
      userId: user.id,
      purpose: "reset",
      expiresAt: Date.now() + 60 * 60_000,
      usedAt: null,
      attempts: 0,
    });
    const link = `${requestOrigin(c)}/reset/${token}`;
    const copy = resetMail(user.locale, {
      instance: await instanceName(c.env),
      link,
    });
    await enqueueMail(c.env, {
      kind: "reset",
      to: user.email,
      subject: copy.subject,
      text: copy.text,
    }).catch(() => undefined);
    await audit(c.env, actor, "user.reset", user.id, null, null, clientIp(c));
    return c.json({ link });
  });

  app.get("/api/tokens", async (c) => {
    const actor = await requireActor(c);
    requireCan(actor, "tokens.read");
    const rows = await getDb(c.env.DB)
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.organizationId, actor.organizationId));
    const visible = rows.filter(
      (row) =>
        !row.revokedAt &&
        (row.createdBy === actor.userId || can(actor, "users.read")),
    );
    return c.json({
      tokens: visible.map((row) => ({
        id: row.id,
        name: row.name,
        scopes: JSON.parse(row.scopesJson) as string[],
        createdBy: row.createdBy,
        lastUsedAt: row.lastUsedAt,
        createdAt: row.createdAt,
      })),
      allowedScopes: scopesForRole(actor.role),
    });
  });

  app.post("/api/tokens", async (c) => {
    const actor = await requireActor(c);
    assertMutationOrigin(c, actor);
    requireCan(actor, "tokens.write");
    const body = await parseBody(c, tokenCreateSchema);
    if (!assertScopesWithinRole(actor.role, body.scopes)) {
      throw new ApiError(
        403,
        "forbidden",
        "Those scopes are wider than your role.",
      );
    }
    const raw = randomToken("flb_");
    const id = crypto.randomUUID();
    await getDb(c.env.DB)
      .insert(apiTokens)
      .values({
        id,
        tokenHash: await sha256Hex(raw),
        organizationId: actor.organizationId,
        name: body.name,
        scopesJson: JSON.stringify(body.scopes),
        createdBy: actor.userId,
        lastUsedAt: null,
        revokedAt: null,
        createdAt: Date.now(),
      });
    await audit(
      c.env,
      actor,
      "token.create",
      id,
      null,
      { name: body.name, scopes: body.scopes },
      clientIp(c),
    );
    return c.json({ id, token: raw }, 201);
  });

  app.delete("/api/tokens/:id", async (c) => {
    const actor = await requireActor(c);
    assertMutationOrigin(c, actor);
    requireCan(actor, "tokens.write");
    const db = getDb(c.env.DB);
    const row = await db
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.id, c.req.param("id")))
      .get();
    if (!row || row.organizationId !== actor.organizationId)
      throw new ApiError(404, "not_found", "Token not found.");
    if (row.createdBy !== actor.userId && !can(actor, "users.role"))
      throw new ApiError(
        403,
        "forbidden",
        "You can only revoke your own tokens.",
      );
    await db
      .update(apiTokens)
      .set({ revokedAt: Date.now() })
      .where(eq(apiTokens.id, row.id));
    await audit(
      c.env,
      actor,
      "token.revoke",
      row.id,
      { name: row.name },
      null,
      clientIp(c),
    );
    return c.json({ ok: true });
  });

  app.get("/api/audit", async (c) => {
    const actor = await requireActor(c);
    requireCan(actor, "audit.read");
    const rows = await getDb(c.env.DB)
      .select()
      .from(auditLog)
      .orderBy(desc(auditLog.createdAt))
      .limit(200);
    return c.json({
      events: rows.map((row) => ({
        id: row.id,
        action: row.action,
        target: row.target,
        actorUserId: row.actorUserId,
        createdAt: row.createdAt,
      })),
    });
  });

  app.get("/api/settings", async (c) => {
    const actor = await requireActor(c);
    requireCan(actor, "instance.settings");
    return c.json({
      instanceName: await instanceName(c.env),
      defaultLocale: await readSetting(c.env, "default_locale", "en"),
      authMode: await readSetting(c.env, "auth_mode", "local"),
      turnstile: Boolean(c.env.TURNSTILE_SITE_KEY),
    });
  });

  app.put("/api/settings", async (c) => {
    const actor = await requireActor(c);
    assertMutationOrigin(c, actor);
    requireCan(actor, "instance.settings");
    const body = await parseBody(c, settingsSchema);
    if (body.authMode === "access") {
      throw new ApiError(
        501,
        "not_implemented",
        "Cloudflare Access mode is stored for later and is not enforced in this version.",
      );
    }
    if (body.instanceName)
      await writeSetting(c.env, "instance_name", body.instanceName);
    if (body.defaultLocale)
      await writeSetting(c.env, "default_locale", body.defaultLocale);
    if (body.authMode) await writeSetting(c.env, "auth_mode", body.authMode);
    await audit(
      c.env,
      actor,
      "instance.settings",
      null,
      null,
      body,
      clientIp(c),
    );
    return c.json({ ok: true });
  });

  app.get("/api/settings/mail", async (c) => {
    const actor = await requireActor(c);
    requireCan(actor, "mail.read");
    const row = await getDb(c.env.DB)
      .select()
      .from(mailSettings)
      .where(eq(mailSettings.id, 1))
      .get();
    return c.json({
      driver: row?.driver ?? "none",
      host: row?.host ?? "",
      port: row?.port ?? 587,
      security: row?.security ?? "starttls",
      username: row?.username ?? "",
      hasPassword: Boolean(row?.passwordEncrypted),
      fromName: row?.fromName ?? "",
      fromAddress: row?.fromAddress ?? "",
      secretsOverride: Boolean(c.env.SMTP_HOST && c.env.MAIL_FROM),
      activeSource: describeMailSource(c.env, row?.driver),
      emailBinding: Boolean(c.env.EMAIL),
      lastTestOk: row?.lastTestOk ?? null,
      lastTestError: row?.lastTestError ?? null,
    });
  });

  app.put("/api/settings/mail", async (c) => {
    const actor = await requireActor(c);
    assertMutationOrigin(c, actor);
    requireCan(actor, "mail.write");
    const body = await parseBody(c, mailSettingsSchema);
    const db = getDb(c.env.DB);
    const existing = await db
      .select()
      .from(mailSettings)
      .where(eq(mailSettings.id, 1))
      .get();
    let passwordEncrypted = existing?.passwordEncrypted ?? null;
    const nextPassword =
      body.driver === "smtp" ? (body.password?.trim() ?? "") : "";
    if (body.driver === "smtp" && body.clearPassword) {
      passwordEncrypted = null;
    } else if (nextPassword) {
      passwordEncrypted = await encryptString(
        requireEncryptionKey(c.env),
        nextPassword,
      );
    }
    const value = {
      id: 1,
      driver: body.driver,
      host: body.driver === "smtp" ? body.host : null,
      port: body.driver === "smtp" ? body.port : null,
      security: body.driver === "smtp" ? body.security : null,
      username: body.driver === "smtp" ? body.username : null,
      passwordEncrypted: body.driver === "smtp" ? passwordEncrypted : null,
      fromName: body.driver === "none" ? null : body.fromName,
      fromAddress: body.driver === "none" ? null : body.fromAddress,
      lastTestOk: existing?.lastTestOk ?? null,
      lastTestAt: existing?.lastTestAt ?? null,
      lastTestError: existing?.lastTestError ?? null,
      updatedAt: Date.now(),
    };
    await db
      .insert(mailSettings)
      .values(value)
      .onConflictDoUpdate({ target: mailSettings.id, set: value });
    await audit(
      c.env,
      actor,
      "mail.update",
      "1",
      null,
      { driver: body.driver },
      clientIp(c),
    );
    return c.json({ ok: true });
  });

  app.post("/api/settings/mail/test", async (c) => {
    const actor = await requireActor(c);
    assertMutationOrigin(c, actor);
    requireCan(actor, "mail.write");
    const raw = await c.req.json().catch(() => ({}));
    const parsed = z
      .object({ email: z.string().email().optional() })
      .safeParse(raw ?? {});
    if (!parsed.success) throw new ApiError(400, "validation", "Invalid email");
    const body = parsed.data;
    const db = getDb(c.env.DB);
    const row = await db
      .select()
      .from(mailSettings)
      .where(eq(mailSettings.id, 1))
      .get();
    const resolved = await resolveMail(c.env, row ?? null);
    const copy = testMail(actor.locale, await instanceName(c.env));
    const result = await deliverWith(c.env, resolved, {
      to: body.email ?? actor.email,
      subject: copy.subject,
      text: copy.text,
      messageId: `<${crypto.randomUUID()}@flarebot.local>`,
    });
    await db
      .update(mailSettings)
      .set({
        lastTestOk: result.ok,
        lastTestAt: Date.now(),
        lastTestError: result.ok
          ? null
          : `${result.stage ?? "send"}: ${result.message ?? "failed"}`,
      })
      .where(eq(mailSettings.id, 1));
    if (!result.ok)
      return c.json(
        {
          error: {
            code: "mail",
            message: result.message ?? "Email failed",
            stage: result.stage ?? "send",
          },
        },
        400,
      );
    return c.json({ ok: true });
  });

  app.get("/api/account", async (c) => {
    const actor = await requireActor(c);
    const db = getDb(c.env.DB);
    const user = await db
      .select()
      .from(users)
      .where(eq(users.id, actor.userId))
      .get();
    const keys = await db
      .select()
      .from(credentials)
      .where(eq(credentials.userId, actor.userId));
    return c.json({
      id: actor.userId,
      name: actor.name,
      email: actor.email,
      locale: actor.locale,
      role: actor.role,
      totpEnabled: user?.totpEnabled ?? false,
      hasPassword: Boolean(user?.passwordHash),
      passkeys: keys.map((key) => ({
        id: key.id,
        deviceName: key.deviceName,
        createdAt: key.createdAt,
      })),
    });
  });

  app.patch("/api/account", async (c) => {
    const actor = await requireActor(c);
    assertMutationOrigin(c, actor);
    const body = await parseBody(c, accountPatchSchema);
    const patch: { name?: string; locale?: string | null } = {};
    if (body.name) patch.name = body.name;
    if (body.locale !== undefined) patch.locale = body.locale;
    await getDb(c.env.DB)
      .update(users)
      .set(patch)
      .where(eq(users.id, actor.userId));
    if (body.locale) writeLocaleCookie(c, body.locale);
    else if (body.locale === null) clearLocaleCookie(c);
    return c.json({ ok: true });
  });

  app.post("/api/account/password", async (c) => {
    const actor = await requireActor(c);
    assertMutationOrigin(c, actor);
    const body = await parseBody(c, passwordChangeSchema);
    const db = getDb(c.env.DB);
    const user = await db
      .select()
      .from(users)
      .where(eq(users.id, actor.userId))
      .get();
    if (
      !user?.passwordHash ||
      !(await verifyPassword(body.currentPassword, user.passwordHash))
    ) {
      throw new ApiError(401, "unauthorized", "Current password is incorrect.");
    }
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(body.newPassword) })
      .where(eq(users.id, user.id));
    return c.json({ ok: true });
  });

  app.post("/api/account/totp/setup", async (c) => {
    const actor = await requireActor(c);
    assertMutationOrigin(c, actor);
    const raw = crypto.getRandomValues(new Uint8Array(20));
    const pending = await encryptString(
      requireEncryptionKey(c.env),
      bytesToB64(raw),
    );
    await getDb(c.env.DB)
      .update(users)
      .set({ totpPending: pending })
      .where(eq(users.id, actor.userId));
    const secret = base32Encode(raw);
    const label = encodeURIComponent(actor.email);
    return c.json({
      secret,
      otpauth: `otpauth://totp/Flarebot:${label}?secret=${secret}&issuer=Flarebot`,
    });
  });

  app.post("/api/account/totp/confirm", async (c) => {
    const actor = await requireActor(c);
    assertMutationOrigin(c, actor);
    const body = await parseBody(c, totpConfirmSchema);
    const db = getDb(c.env.DB);
    const user = await db
      .select()
      .from(users)
      .where(eq(users.id, actor.userId))
      .get();
    if (!user?.totpPending)
      throw new ApiError(400, "validation", "Start authenticator setup first.");
    const secret = b64ToBytes(
      await decryptString(requireEncryptionKey(c.env), user.totpPending),
    );
    if (!(await verifyTotp(secret, body.code, Date.now())))
      throw new ApiError(401, "totp_invalid", "That code was not accepted.");
    await db
      .update(users)
      .set({
        totpSecret: user.totpPending,
        totpPending: null,
        totpEnabled: true,
      })
      .where(eq(users.id, user.id));
    await audit(
      c.env,
      actor,
      "account.totp",
      user.id,
      null,
      { enabled: true },
      clientIp(c),
    );
    return c.json({ ok: true });
  });

  app.post("/api/account/totp/disable", async (c) => {
    const actor = await requireActor(c);
    assertMutationOrigin(c, actor);
    const body = await parseBody(
      c,
      z.object({
        password: z.string().min(1).optional(),
        code: z
          .string()
          .regex(/^\d{6}$/)
          .optional(),
      }),
    );
    const db = getDb(c.env.DB);
    const user = await db
      .select()
      .from(users)
      .where(eq(users.id, actor.userId))
      .get();
    const passwordOk =
      user?.passwordHash && body.password
        ? await verifyPassword(body.password, user.passwordHash)
        : false;
    const totpOk =
      user?.totpSecret && body.code
        ? await verifyTotp(
            b64ToBytes(
              await decryptString(requireEncryptionKey(c.env), user.totpSecret),
            ),
            body.code,
            Date.now(),
          )
        : false;
    if (!passwordOk && !totpOk)
      throw new ApiError(
        401,
        "unauthorized",
        "Confirm with your password or authenticator code.",
      );
    await db
      .update(users)
      .set({ totpEnabled: false, totpSecret: null, totpPending: null })
      .where(eq(users.id, actor.userId));
    return c.json({ ok: true });
  });

  app.delete("/api/account/passkeys/:id", async (c) => {
    const actor = await requireActor(c);
    assertMutationOrigin(c, actor);
    const db = getDb(c.env.DB);
    const key = await db
      .select()
      .from(credentials)
      .where(eq(credentials.id, c.req.param("id")))
      .get();
    if (!key || key.userId !== actor.userId)
      throw new ApiError(404, "not_found", "Passkey not found.");
    await db.delete(credentials).where(eq(credentials.id, key.id));
    return c.json({ ok: true });
  });
}

async function ownedPage(env: Env, organizationId: string, id: string) {
  const page = await getDb(env.DB)
    .select()
    .from(statusPages)
    .where(
      and(
        eq(statusPages.id, id),
        eq(statusPages.organizationId, organizationId),
      ),
    )
    .get();
  if (!page) throw new ApiError(404, "not_found", "Status page not found.");
  return page;
}

async function assertMonitors(env: Env, organizationId: string, ids: string[]) {
  if (ids.length === 0) return;
  const rows = await getDb(env.DB)
    .select({ id: monitors.id })
    .from(monitors)
    .where(eq(monitors.organizationId, organizationId));
  const known = new Set(rows.map((row) => row.id));
  if (ids.some((id) => !known.has(id)))
    throw new ApiError(400, "validation", "Unknown monitor.");
}
