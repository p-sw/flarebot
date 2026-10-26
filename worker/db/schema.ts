// SPDX-License-Identifier: MIT

import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const organizations = sqliteTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash"),
  totpSecret: text("totp_secret"),
  totpPending: text("totp_pending"),
  totpEnabled: integer("totp_enabled", { mode: "boolean" })
    .notNull()
    .default(false),
  disabled: integer("disabled", { mode: "boolean" }).notNull().default(false),
  // Deprecated. The product language is brand/locale.json. The column stays so existing rows remain valid.
  locale: text("locale"),
  createdAt: integer("created_at").notNull(),
});

export const memberships = sqliteTable(
  "memberships",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    organizationId: text("organization_id").notNull(),
    role: text("role").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("memberships_user_org").on(table.userId, table.organizationId),
  ],
);

export const credentials = sqliteTable("credentials", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  credentialId: text("credential_id").notNull().unique(),
  publicKey: text("public_key").notNull(),
  counter: integer("counter").notNull(),
  deviceName: text("device_name"),
  transportsJson: text("transports_json"),
  createdAt: integer("created_at").notNull(),
});

export const webauthnChallenges = sqliteTable("webauthn_challenges", {
  id: text("id").primaryKey(),
  userId: text("user_id"),
  challenge: text("challenge").notNull(),
  type: text("type").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  userId: text("user_id").notNull(),
  expiresAt: integer("expires_at").notNull(),
  method: text("method").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const loginAttempts = sqliteTable("login_attempts", {
  email: text("email").primaryKey(),
  failures: integer("failures").notNull(),
  lockedUntil: integer("locked_until"),
});

export const invites = sqliteTable("invites", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  organizationId: text("organization_id").notNull(),
  role: text("role").notNull(),
  email: text("email"),
  createdBy: text("created_by").notNull(),
  expiresAt: integer("expires_at").notNull(),
  usedAt: integer("used_at"),
  usedBy: text("used_by"),
});

export const apiTokens = sqliteTable("api_tokens", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  organizationId: text("organization_id").notNull(),
  name: text("name").notNull(),
  scopesJson: text("scopes_json").notNull(),
  createdBy: text("created_by").notNull(),
  lastUsedAt: integer("last_used_at"),
  revokedAt: integer("revoked_at"),
  createdAt: integer("created_at").notNull(),
});

export const monitors = sqliteTable("monitors", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  configJson: text("config_json").notNull(),
  intervalSeconds: integer("interval_seconds").notNull(),
  timeoutSeconds: integer("timeout_seconds").notNull(),
  retries: integer("retries").notNull(),
  recoveryThreshold: integer("recovery_threshold").notNull(),
  regionsJson: text("regions_json").notNull(),
  shardId: text("shard_id").notNull(),
  paused: integer("paused", { mode: "boolean" }).notNull().default(false),
  badgesEnabled: integer("badges_enabled", { mode: "boolean" })
    .notNull()
    .default(false),
  pushTokenHash: text("push_token_hash"),
  pushTokenEncrypted: text("push_token_encrypted"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const monitorState = sqliteTable("monitor_state", {
  monitorId: text("monitor_id").primaryKey(),
  status: text("status").notNull(),
  since: integer("since").notNull(),
  lastResponseMs: integer("last_response_ms"),
  lastCheckAt: integer("last_check_at"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  consecutiveSuccesses: integer("consecutive_successes").notNull().default(0),
  lastError: text("last_error"),
  flapping: integer("flapping", { mode: "boolean" }).notNull().default(false),
});

export const outages = sqliteTable("outages", {
  id: text("id").primaryKey(),
  monitorId: text("monitor_id").notNull(),
  startedAt: integer("started_at").notNull(),
  endedAt: integer("ended_at"),
  cause: text("cause"),
  acknowledgedBy: text("acknowledged_by"),
  acknowledgedAt: integer("acknowledged_at"),
});

export const notificationChannels = sqliteTable("notification_channels", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  configEncrypted: text("config_encrypted").notNull(),
  // Deprecated. Notification copy uses brand/locale.json. The column stays so existing rows remain valid.
  locale: text("locale"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const monitorChannels = sqliteTable(
  "monitor_channels",
  {
    monitorId: text("monitor_id").notNull(),
    channelId: text("channel_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.monitorId, table.channelId] })],
);

export const statusPages = sqliteTable(
  "status_pages",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    slug: text("slug").notNull().unique(),
    published: integer("published", { mode: "boolean" })
      .notNull()
      .default(true),
    serveAtRoot: integer("serve_at_root", { mode: "boolean" })
      .notNull()
      .default(false),
    // Deprecated. Public pages render title, description, footer, and banner only.
    defaultLocale: text("default_locale").notNull(),
    localesJson: text("locales_json").notNull(),
    sourceLocale: text("source_locale").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    footer: text("footer").notNull(),
    banner: text("banner").notNull(),
    // Deprecated. Per-language status page text is no longer read.
    i18nJson: text("i18n_json").notNull(),
    logoUrl: text("logo_url"),
    accent: text("accent"),
    displayRange: text("display_range").notNull().default("24h"),
    subscribeEmail: integer("subscribe_email", { mode: "boolean" })
      .notNull()
      .default(false),
    subscribeWebhook: integer("subscribe_webhook", { mode: "boolean" })
      .notNull()
      .default(false),
    subscribeRss: integer("subscribe_rss", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("status_pages_one_root")
      .on(table.serveAtRoot)
      .where(sql`${table.serveAtRoot} = 1`),
  ],
);

export const statusPageItems = sqliteTable("status_page_items", {
  id: text("id").primaryKey(),
  pageId: text("page_id").notNull(),
  monitorId: text("monitor_id").notNull(),
  position: integer("position").notNull(),
  groupName: text("group_name").notNull(),
  displayName: text("display_name").notNull(),
  // Deprecated. Item names come from group_name and display_name.
  sourceLocale: text("source_locale").notNull(),
  i18nJson: text("i18n_json").notNull(),
});

export const uptimeHourly = sqliteTable(
  "uptime_hourly",
  {
    monitorId: text("monitor_id").notNull(),
    hourStart: integer("hour_start").notNull(),
    okCount: integer("ok_count").notNull(),
    failCount: integer("fail_count").notNull(),
    latencySum: integer("latency_sum").notNull(),
    latencyMax: integer("latency_max").notNull(),
    samplesJson: text("samples_json").notNull(),
    maintCount: integer("maint_count").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.monitorId, table.hourStart] })],
);

export const uptimeSlots = sqliteTable(
  "uptime_slots",
  {
    monitorId: text("monitor_id").notNull(),
    slotStart: integer("slot_start").notNull(),
    okCount: integer("ok_count").notNull(),
    failCount: integer("fail_count").notNull(),
    latencySum: integer("latency_sum").notNull(),
    latencyMax: integer("latency_max").notNull(),
    maintCount: integer("maint_count").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.monitorId, table.slotStart] }),
    index("uptime_slots_slot_idx").on(table.slotStart),
  ],
);

export const uptimeDaily = sqliteTable(
  "uptime_daily",
  {
    monitorId: text("monitor_id").notNull(),
    dayStart: integer("day_start").notNull(),
    okCount: integer("ok_count").notNull(),
    failCount: integer("fail_count").notNull(),
    latencySum: integer("latency_sum").notNull(),
    latencyMax: integer("latency_max").notNull(),
    maintCount: integer("maint_count").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.monitorId, table.dayStart] })],
);

export const rollupDirty = sqliteTable(
  "rollup_dirty",
  {
    monitorId: text("monitor_id").notNull(),
    dayStart: integer("day_start").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.monitorId, table.dayStart] }),
    index("rollup_dirty_day_idx").on(table.dayStart),
  ],
);

export const rollupWatermark = sqliteTable("rollup_watermark", {
  id: integer("id").primaryKey(),
  pendingBefore: integer("pending_before").notNull().default(0),
});

export const certInfo = sqliteTable("cert_info", {
  monitorId: text("monitor_id").primaryKey(),
  notAfter: integer("not_after"),
  lastCheckedAt: integer("last_checked_at").notNull(),
  source: text("source").notNull(),
  error: text("error"),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  valueJson: text("value_json").notNull(),
});

export const mailSettings = sqliteTable("mail_settings", {
  id: integer("id").primaryKey(),
  driver: text("driver").notNull(),
  host: text("host"),
  port: integer("port"),
  security: text("security"),
  username: text("username"),
  passwordEncrypted: text("password_encrypted"),
  fromName: text("from_name"),
  fromAddress: text("from_address"),
  lastTestOk: integer("last_test_ok", { mode: "boolean" }),
  lastTestAt: integer("last_test_at"),
  lastTestError: text("last_test_error"),
  updatedAt: integer("updated_at").notNull(),
});

export const mailOutbox = sqliteTable("mail_outbox", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  toAddress: text("to_address").notNull(),
  subject: text("subject").notNull(),
  textBody: text("text_body").notNull(),
  htmlBody: text("html_body"),
  status: text("status").notNull(),
  attempts: integer("attempts").notNull(),
  nextAttemptAt: integer("next_attempt_at").notNull(),
  lastError: text("last_error"),
  messageId: text("message_id").notNull(),
  headersJson: text("headers_json"),
  createdAt: integer("created_at").notNull(),
  sentAt: integer("sent_at"),
});

export const emailTokens = sqliteTable("email_tokens", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  userId: text("user_id").notNull(),
  purpose: text("purpose").notNull(),
  expiresAt: integer("expires_at").notNull(),
  usedAt: integer("used_at"),
  attempts: integer("attempts").notNull(),
});

export const incidents = sqliteTable("incidents", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  title: text("title").notNull(),
  notify: integer("notify", { mode: "boolean" }).notNull().default(false),
  createdBy: text("created_by"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  resolvedAt: integer("resolved_at"),
  sourceOutageId: text("source_outage_id"),
});

export const incidentMonitors = sqliteTable(
  "incident_monitors",
  {
    incidentId: text("incident_id").notNull(),
    monitorId: text("monitor_id").notNull(),
    impact: text("impact").notNull(),
  },
  (table) => [primaryKey({ columns: [table.incidentId, table.monitorId] })],
);

export const incidentPages = sqliteTable(
  "incident_pages",
  {
    incidentId: text("incident_id").notNull(),
    pageId: text("page_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.incidentId, table.pageId] })],
);

export const incidentUpdates = sqliteTable("incident_updates", {
  id: text("id").primaryKey(),
  incidentId: text("incident_id").notNull(),
  status: text("status").notNull(),
  body: text("body").notNull(),
  postedAt: integer("posted_at").notNull(),
  createdBy: text("created_by"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const incidentChannels = sqliteTable(
  "incident_channels",
  {
    incidentId: text("incident_id").notNull(),
    channelId: text("channel_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.incidentId, table.channelId] })],
);

export const maintenanceWindows = sqliteTable("maintenance_windows", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  timezone: text("timezone").notNull(),
  startAt: integer("start_at").notNull(),
  endAt: integer("end_at").notNull(),
  recurrence: text("recurrence").notNull(),
  weekdaysJson: text("weekdays_json").notNull(),
  notify: integer("notify", { mode: "boolean" }).notNull().default(false),
  cancelledAt: integer("cancelled_at"),
  createdBy: text("created_by"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const maintenanceMonitors = sqliteTable(
  "maintenance_monitors",
  {
    maintenanceId: text("maintenance_id").notNull(),
    monitorId: text("monitor_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.maintenanceId, table.monitorId] })],
);

export const maintenancePages = sqliteTable(
  "maintenance_pages",
  {
    maintenanceId: text("maintenance_id").notNull(),
    pageId: text("page_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.maintenanceId, table.pageId] })],
);

export const maintenanceChannels = sqliteTable(
  "maintenance_channels",
  {
    maintenanceId: text("maintenance_id").notNull(),
    channelId: text("channel_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.maintenanceId, table.channelId] })],
);

export const maintenanceSignals = sqliteTable(
  "maintenance_signals",
  {
    maintenanceId: text("maintenance_id").notNull(),
    occurrenceStart: integer("occurrence_start").notNull(),
    kind: text("kind").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.maintenanceId, table.occurrenceStart, table.kind],
    }),
  ],
);

export const announcementEvents = sqliteTable("announcement_events", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  kind: text("kind").notNull(),
  subjectType: text("subject_type").notNull(),
  subjectId: text("subject_id").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  href: text("href"),
  createdAt: integer("created_at").notNull(),
});

export const announcementOutbox = sqliteTable("announcement_outbox", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull(),
  channelId: text("channel_id").notNull(),
  status: text("status").notNull(),
  attempts: integer("attempts").notNull(),
  nextAttemptAt: integer("next_attempt_at").notNull(),
  lastError: text("last_error"),
  createdAt: integer("created_at").notNull(),
  sentAt: integer("sent_at"),
});

export const ssoProviders = sqliteTable("sso_providers", {
  id: text("id").primaryKey(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  displayName: text("display_name").notNull(),
  buttonLabel: text("button_label").notNull(),
  issuerUrl: text("issuer_url").notNull(),
  clientId: text("client_id").notNull(),
  clientSecretEncrypted: text("client_secret_encrypted"),
  scopes: text("scopes").notNull(),
  groupsClaim: text("groups_claim").notNull().default("groups"),
  jitEnabled: integer("jit_enabled", { mode: "boolean" })
    .notNull()
    .default(false),
  jitRole: text("jit_role").notNull().default("viewer"),
  allowedDomainsJson: text("allowed_domains_json").notNull().default("[]"),
  roleMappingsJson: text("role_mappings_json").notNull().default("[]"),
  discoveryJson: text("discovery_json"),
  discoveryAt: integer("discovery_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const ssoIdentities = sqliteTable(
  "sso_identities",
  {
    id: text("id").primaryKey(),
    providerId: text("provider_id").notNull(),
    subject: text("subject").notNull(),
    userId: text("user_id").notNull(),
    email: text("email").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("sso_identities_provider_subject").on(
      table.providerId,
      table.subject,
    ),
  ],
);

export const subscribers = sqliteTable(
  "subscribers",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    statusPageId: text("status_page_id").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    email: text("email"),
    addressHash: text("address_hash").notNull(),
    webhookUrlEncrypted: text("webhook_url_encrypted"),
    webhookSecretEncrypted: text("webhook_secret_encrypted"),
    followAll: integer("follow_all", { mode: "boolean" })
      .notNull()
      .default(true),
    monitorIdsJson: text("monitor_ids_json").notNull().default("[]"),
    confirmTokenHash: text("confirm_token_hash"),
    manageTokenHash: text("manage_token_hash").notNull(),
    unsubTokenHash: text("unsub_token_hash").notNull(),
    confirmExpiresAt: integer("confirm_expires_at"),
    failCount: integer("fail_count").notNull().default(0),
    origin: text("origin").notNull(),
    createdAt: integer("created_at").notNull(),
    confirmedAt: integer("confirmed_at"),
    disabledAt: integer("disabled_at"),
    disabledReason: text("disabled_reason"),
  },
  (table) => [
    uniqueIndex("subscribers_manage_token").on(table.manageTokenHash),
    uniqueIndex("subscribers_unsub_token").on(table.unsubTokenHash),
  ],
);

export const subscriptionDeliveries = sqliteTable(
  "subscription_deliveries",
  {
    id: text("id").primaryKey(),
    statusPageId: text("status_page_id").notNull(),
    subscriberId: text("subscriber_id").notNull(),
    eventId: text("event_id").notNull(),
    status: text("status").notNull(),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: integer("next_attempt_at").notNull(),
    lastError: text("last_error"),
    createdAt: integer("created_at").notNull(),
    sentAt: integer("sent_at"),
  },
  (table) => [
    uniqueIndex("subscription_deliveries_once").on(
      table.subscriberId,
      table.eventId,
    ),
  ],
);

export const subscriptionFanout = sqliteTable("subscription_fanout", {
  eventId: text("event_id").primaryKey(),
  cursorCreatedAt: integer("cursor_created_at").notNull().default(0),
  cursorId: text("cursor_id").notNull().default(""),
  done: integer("done", { mode: "boolean" }).notNull().default(false),
  updatedAt: integer("updated_at").notNull(),
});

export const subscriptionLimits = sqliteTable("subscription_limits", {
  bucket: text("bucket").primaryKey(),
  hits: integer("hits").notNull(),
  windowStart: integer("window_start").notNull(),
});

export const subscriptionTokens = sqliteTable("subscription_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  subscriberId: text("subscriber_id").notNull(),
  purpose: text("purpose").notNull(),
  expiresAt: integer("expires_at"),
  createdAt: integer("created_at").notNull(),
});

export const oidcTransactions = sqliteTable("oidc_transactions", {
  id: text("id").primaryKey(),
  providerId: text("provider_id").notNull(),
  stateHash: text("state_hash").notNull().unique(),
  nonceHash: text("nonce_hash").notNull(),
  codeVerifierEncrypted: text("code_verifier_encrypted").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const ssoJwksCache = sqliteTable("sso_jwks_cache", {
  url: text("url").primaryKey(),
  body: text("body").notNull(),
  fetchedAt: integer("fetched_at").notNull(),
});

export const auditLog = sqliteTable("audit_log", {
  id: text("id").primaryKey(),
  actorUserId: text("actor_user_id"),
  actorTokenId: text("actor_token_id"),
  action: text("action").notNull(),
  target: text("target"),
  beforeJson: text("before_json"),
  afterJson: text("after_json"),
  ip: text("ip"),
  createdAt: integer("created_at").notNull(),
});
