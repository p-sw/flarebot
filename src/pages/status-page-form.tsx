// SPDX-License-Identifier: MIT

import AppHeader from "@brand/overrides/AppHeader";
import { t } from "@shared/copy";
import type { DisplayRange } from "@shared/history";
import {
  duplicateSectionNames,
  isStatusSlug,
  itemsFromSections,
  type LayoutSection,
  sectionsFromItems,
  slugFromTitle,
  statusItemLabel,
} from "@shared/status-layout";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Link,
  useBlocker,
  useNavigate,
  useParams,
  useSearch,
} from "@tanstack/react-router";
import { motion } from "motion/react";
import { type ReactNode, useId, useRef, useState } from "react";
import { ApiClientError, api } from "../lib/api";
import {
  monitorsQuery,
  type StatusPageDetail,
  statusPageQuery,
} from "../lib/queries";
import { commitServeAtRoot, refreshQueries } from "../lib/query-sync";
import { useToggleLock } from "../lib/toggle-guard";
import { useSubmitGuard } from "../lib/use-submit-guard";
import { useMotionPrefs } from "../motion/page";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { Input } from "../ui/input";
import { PendingButton } from "../ui/pending-button";
import { ContentSkeleton } from "../ui/skeleton";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { controlClass, Field } from "./fields";
import { RootSwitch, rootToggleError } from "./root-switch";
import { StatusLayoutEditor } from "./status-layout-editor";
import { SubscribersPanel } from "./subscribers-panel";

type Draft = {
  title: string;
  slug: string;
  description: string;
  footer: string;
  banner: string;
  published: boolean;
  serveAtRoot: boolean;
  logoUrl: string;
  accent: string;
  displayRange: DisplayRange;
  sections: LayoutSection[];
};

type FieldErrors = {
  title?: string;
  slug?: string;
  logoUrl?: string;
  accent?: string;
  sections?: string;
};

function emptyDraft(): Draft {
  return {
    title: "",
    slug: "",
    description: "",
    footer: "",
    banner: "",
    published: true,
    serveAtRoot: false,
    logoUrl: "",
    accent: "",
    displayRange: "24h",
    sections: [],
  };
}

function draftFromPage(page: StatusPageDetail): Draft {
  return {
    title: page.title,
    slug: page.slug,
    description: page.description,
    footer: page.footer,
    banner: page.banner,
    published: page.published,
    serveAtRoot: page.serveAtRoot,
    logoUrl: page.logoUrl ?? "",
    accent: page.accent ?? "",
    displayRange: page.displayRange ?? "24h",
    sections: sectionsFromItems(page.items),
  };
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function validate(draft: Draft): FieldErrors {
  const errors: FieldErrors = {};
  if (!draft.title.trim()) errors.title = t("page_title_required");
  if (!isStatusSlug(draft.slug.trim().toLowerCase()))
    errors.slug = t("page_slug_invalid");
  if (draft.logoUrl.trim() && !isHttpUrl(draft.logoUrl.trim()))
    errors.logoUrl = t("page_logo_invalid");
  if (draft.accent.trim() && !/^#[0-9a-fA-F]{6}$/.test(draft.accent.trim()))
    errors.accent = t("page_accent_invalid");
  if (duplicateSectionNames(draft.sections))
    errors.sections = t("page_sections_duplicate");
  return errors;
}

function commit(draft: Draft): Draft {
  return {
    ...draft,
    title: draft.title.trim(),
    slug: draft.slug.trim().toLowerCase(),
    logoUrl: draft.logoUrl.trim(),
    accent: draft.accent.trim(),
    sections: draft.sections
      .filter((section) => section.items.length > 0)
      .map((section) => ({
        ...section,
        name: section.name.trim(),
        items: section.items.map((item) => ({
          ...item,
          displayName: item.displayName.trim(),
        })),
      })),
  };
}

function Described({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint: string;
  error?: string;
  children: (describedBy: string) => ReactNode;
}) {
  const hintId = useId();
  const errorId = useId();
  const describedBy = error ? `${hintId} ${errorId}` : hintId;
  return (
    <div className="grid min-w-0 gap-1.5">
      <Field label={label}>{children(describedBy)}</Field>
      <p id={hintId} className="text-xs text-muted-foreground">
        {hint}
      </p>
      {error ? (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function StatusPageForm({
  mode,
  page,
  monitors,
  created,
}: {
  mode: "create" | "edit";
  page?: StatusPageDetail;
  monitors: { id: string; name: string }[];
  created?: boolean;
}) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const motionPrefs = useMotionPrefs();
  const submit = useSubmitGuard();
  const toggles = useToggleLock();
  const skip = useRef(false);
  const slugEdited = useRef(mode === "edit");
  const loaded = useRef(page?.id ?? "");
  const [snapshot, setSnapshot] = useState(() => {
    const draft =
      mode === "create" ? emptyDraft() : page ? draftFromPage(page) : null;
    return { draft, baseline: JSON.stringify(draft) };
  });
  const draft = snapshot.draft;
  const baseline = snapshot.baseline;
  function setDraft(
    next: Draft | null | ((current: Draft | null) => Draft | null),
  ) {
    setSnapshot((current) => {
      const resolved = typeof next === "function" ? next(current.draft) : next;
      return { ...current, draft: resolved };
    });
  }
  function setBaseline(next: string) {
    setSnapshot((current) => ({ ...current, baseline: next }));
  }
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [rootError, setRootError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  if (mode === "edit" && page && loaded.current !== page.id) {
    loaded.current = page.id;
    const next = draftFromPage(page);
    setDraft(next);
    setBaseline(JSON.stringify(next));
  }
  const dirty = JSON.stringify(draft) !== baseline;
  const blocker = useBlocker({
    shouldBlockFn: () => dirty && !skip.current,
    withResolver: true,
    enableBeforeUnload: () => dirty && !skip.current,
  });
  if (!draft) return <ContentSkeleton />;
  const droppedEmpty =
    draft.sections.some((section) => section.items.length === 0) &&
    draft.sections.some((section) => section.items.length > 0);

  function update(patch: Partial<Draft>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
    setNotice("");
  }

  async function save() {
    if (!draft) return;
    const nextErrors = validate(draft);
    setErrors(nextErrors);
    setFormError("");
    if (Object.keys(nextErrors).length > 0 || !draft) return;
    const saved = commit(draft);
    const emptyRemoved = draft.sections.length !== saved.sections.length;
    await submit.run(async () => {
      try {
        const body = {
          slug: saved.slug,
          published: saved.published,
          ...(mode === "create"
            ? { serveAtRoot: saved.published && saved.serveAtRoot }
            : {}),
          title: saved.title,
          description: saved.description,
          footer: saved.footer,
          banner: saved.banner,
          logoUrl: saved.logoUrl,
          accent: saved.accent,
          displayRange: saved.displayRange,
          items: itemsFromSections(saved.sections),
        };
        if (mode === "create") {
          const createdPage = await api<{ id: string }>("/api/status-pages", {
            method: "POST",
            body: JSON.stringify(body),
          });
          skip.current = true;
          await refreshQueries(client, [["pages"]]);
          await navigate({
            to: "/console/status-pages/$id",
            params: { id: createdPage.id },
            search: { created: 1 },
          });
          return;
        }
        if (!page) return;
        await api(`/api/status-pages/${page.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
        setDraft(saved);
        setBaseline(JSON.stringify(saved));
        setNotice(
          emptyRemoved
            ? `${t("saved")} ${t("page_empty_sections")}`
            : t("saved"),
        );
        await refreshQueries(client, [["pages"], ["status-page", page.id]]);
      } catch (cause) {
        if (cause instanceof ApiClientError && cause.status === 409) {
          setErrors((current) => ({
            ...current,
            slug: t("page_slug_conflict"),
          }));
          return;
        }
        setFormError(
          cause instanceof ApiClientError ? cause.message : t("error_generic"),
        );
      }
    });
  }

  async function setRoot(serveAtRoot: boolean) {
    if (!page) return;
    setRootError("");
    await toggles.run("root", async () => {
      try {
        const saved = await api<{ id: string; serveAtRoot: boolean }>(
          `/api/status-pages/${page.id}/root`,
          {
            method: "PUT",
            body: JSON.stringify({ serveAtRoot }),
          },
        );
        commitServeAtRoot(client, saved.id, saved.serveAtRoot);
        await refreshQueries(client, [["pages"], ["status-page", page.id]]);
      } catch (cause) {
        setRootError(rootToggleError(cause));
        await refreshQueries(client, [["pages"], ["status-page", page.id]]);
      }
    });
  }

  const publicHref = page ? (page.serveAtRoot ? "/" : `/s/${page.slug}`) : "";
  const slugDirty = page ? draft.slug.trim() !== page.slug : false;

  return (
    <>
      <AppHeader
        title={
          mode === "create" ? t("page_new") : draft.title || t("page_edit")
        }
        actions={
          <PendingButton
            type="button"
            pending={submit.pending}
            disabled={!dirty}
            onClick={() => void save()}
          >
            {mode === "create" ? t("page_create") : t("action_save")}
          </PendingButton>
        }
      />
      <Link
        to="/console/status-pages"
        className="mb-4 inline-block text-sm text-muted-foreground"
      >
        {t("page_back")}
      </Link>
      <p className="mb-4 max-w-2xl text-sm text-muted-foreground">
        {mode === "create" ? t("page_create_intro") : t("page_edit_intro")}
      </p>
      {created ? (
        <motion.p
          role="status"
          className="mb-4 rounded-lg border border-border bg-card px-3 py-2 text-sm"
          initial={
            motionPrefs.still ? false : { opacity: 0, y: motionPrefs.distance }
          }
          animate={{ opacity: 1, y: 0 }}
          transition={motionPrefs.snappy}
        >
          {t("page_created")}
        </motion.p>
      ) : null}
      <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <form
          className="grid min-w-0 gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <Described
            label={t("page_title")}
            hint={t("page_title_hint")}
            error={errors.title}
          >
            {(describedBy) => (
              <Input
                name="title"
                value={draft.title}
                maxLength={160}
                aria-describedby={describedBy}
                aria-invalid={Boolean(errors.title)}
                onChange={(event) => {
                  const title = event.target.value;
                  const slug =
                    mode === "create" && !slugEdited.current
                      ? slugFromTitle(title)
                      : draft.slug;
                  update({ title, slug });
                  setErrors((current) => ({ ...current, title: undefined }));
                }}
              />
            )}
          </Described>
          <Described
            label={t("page_slug")}
            hint={t("page_slug_hint")}
            error={errors.slug}
          >
            {(describedBy) => (
              <Input
                name="slug"
                value={draft.slug}
                maxLength={60}
                aria-describedby={describedBy}
                aria-invalid={Boolean(errors.slug)}
                onChange={(event) => {
                  slugEdited.current = true;
                  update({ slug: event.target.value });
                  setErrors((current) => ({ ...current, slug: undefined }));
                }}
              />
            )}
          </Described>
          <Described
            label={t("page_description")}
            hint={t("page_description_hint")}
          >
            {(describedBy) => (
              <Textarea
                name="description"
                value={draft.description}
                maxLength={2000}
                aria-describedby={describedBy}
                onChange={(event) =>
                  update({ description: event.target.value })
                }
              />
            )}
          </Described>
          <Described
            label={t("page_announcement")}
            hint={t("page_announcement_hint")}
          >
            {(describedBy) => (
              <Textarea
                name="announcement"
                value={draft.banner}
                maxLength={500}
                aria-describedby={describedBy}
                onChange={(event) => update({ banner: event.target.value })}
              />
            )}
          </Described>
          <Described label={t("page_footer")} hint={t("page_footer_hint")}>
            {(describedBy) => (
              <Textarea
                name="footer"
                value={draft.footer}
                maxLength={2000}
                aria-describedby={describedBy}
                onChange={(event) => update({ footer: event.target.value })}
              />
            )}
          </Described>
          <Described
            label={t("page_logo")}
            hint={t("page_logo_hint")}
            error={errors.logoUrl}
          >
            {(describedBy) => (
              <Input
                name="logoUrl"
                value={draft.logoUrl}
                maxLength={2000}
                placeholder={t("page_logo_placeholder")}
                aria-describedby={describedBy}
                aria-invalid={Boolean(errors.logoUrl)}
                onChange={(event) => {
                  update({ logoUrl: event.target.value });
                  setErrors((current) => ({ ...current, logoUrl: undefined }));
                }}
              />
            )}
          </Described>
          <Described
            label={t("page_accent")}
            hint={t("page_accent_hint")}
            error={errors.accent}
          >
            {(describedBy) => (
              <Input
                name="accent"
                value={draft.accent}
                maxLength={7}
                placeholder={t("page_accent_placeholder")}
                aria-describedby={describedBy}
                aria-invalid={Boolean(errors.accent)}
                onChange={(event) => {
                  update({ accent: event.target.value });
                  setErrors((current) => ({ ...current, accent: undefined }));
                }}
              />
            )}
          </Described>
          <Described label={t("page_range")} hint={t("page_range_hint")}>
            {(describedBy) => (
              <select
                className={controlClass}
                name="displayRange"
                value={draft.displayRange}
                aria-describedby={describedBy}
                disabled={submit.pending}
                onChange={(event) =>
                  update({
                    displayRange: event.target.value as DisplayRange,
                  })
                }
              >
                <option value="24h">{t("range_24h")}</option>
                <option value="7d">{t("range_7d")}</option>
                <option value="30d">{t("range_30d")}</option>
                <option value="90d">{t("range_90d")}</option>
              </select>
            )}
          </Described>
          <div className="grid gap-2 rounded-lg border border-border p-3">
            {/* biome-ignore lint/a11y/noLabelWithoutControl: Switch is the control */}
            <label className="flex items-center gap-3 text-sm">
              <Switch
                checked={draft.published}
                disabled={submit.pending}
                onCheckedChange={(checked) =>
                  update({
                    published: checked,
                    serveAtRoot: checked ? draft.serveAtRoot : false,
                  })
                }
              />
              <span>{t("page_published")}</span>
            </label>
            <p className="text-xs text-muted-foreground">
              {t("page_published_hint")}
            </p>
            {mode === "create" ? (
              <>
                {/* biome-ignore lint/a11y/noLabelWithoutControl: Switch is the control */}
                <label className="mt-2 flex items-center gap-3 text-sm">
                  <Switch
                    checked={draft.serveAtRoot}
                    disabled={submit.pending || !draft.published}
                    onCheckedChange={(checked) =>
                      update({ serveAtRoot: checked })
                    }
                  />
                  <span>{t("page_root_label")}</span>
                </label>
                <p className="text-xs text-muted-foreground">
                  {t("page_root_create_hint")}
                </p>
              </>
            ) : page ? (
              <div className="mt-2 grid gap-2">
                <RootSwitch
                  checked={page.serveAtRoot}
                  pending={toggles.pendingKey === "root"}
                  disabled={
                    submit.pending ||
                    toggles.pending ||
                    !page.published ||
                    !draft.published
                  }
                  onCheckedChange={(checked) => void setRoot(checked)}
                />
                <p className="text-xs text-muted-foreground">
                  {t("page_root_note", { slug: page.slug })}
                </p>
                {!draft.published && page.serveAtRoot ? (
                  <p className="text-xs text-muted-foreground">
                    {t("page_root_unpublish_hint")}
                  </p>
                ) : null}
                {rootError ? (
                  <p role="alert" className="text-sm text-destructive">
                    {rootError}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
          <StatusLayoutEditor
            sections={draft.sections}
            monitors={monitors}
            disabled={submit.pending}
            onChange={(sections) => {
              update({ sections });
              setErrors((current) => ({ ...current, sections: undefined }));
            }}
          />
          {errors.sections ? (
            <p role="alert" className="text-sm text-destructive">
              {errors.sections}
            </p>
          ) : null}
          {droppedEmpty ? (
            <p className="text-xs text-muted-foreground">
              {t("page_empty_sections")}
            </p>
          ) : null}
          {formError ? (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          ) : null}
          {notice ? (
            <p role="status" className="text-sm">
              {notice}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 flex-1 text-sm text-muted-foreground">
              {dirty ? t("page_unsaved") : t("page_saved_clean")}
            </p>
            <PendingButton
              type="submit"
              pending={submit.pending}
              disabled={!dirty}
            >
              {mode === "create" ? t("page_create") : t("action_save")}
            </PendingButton>
            {mode === "edit" && page ? (
              <Button
                type="button"
                variant="outline"
                disabled={submit.pending}
                onClick={() => setConfirmDelete(true)}
              >
                {t("page_delete")}
              </Button>
            ) : null}
          </div>
        </form>
        <aside className="min-w-0 rounded-lg border border-border bg-card p-4 lg:sticky lg:top-20 lg:self-start">
          <h2 className="font-medium">{t("page_preview")}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("page_preview_hint")}
          </p>
          {draft.logoUrl.trim() && isHttpUrl(draft.logoUrl.trim()) ? (
            <img
              src={draft.logoUrl.trim()}
              alt=""
              className="mt-4 h-10 max-w-full object-contain"
            />
          ) : null}
          {/^#[0-9a-fA-F]{6}$/.test(draft.accent.trim()) ? (
            <div
              className="mt-4 h-1 w-16 rounded-full"
              style={{ backgroundColor: draft.accent.trim() }}
            />
          ) : null}
          <h3
            className="mt-4 truncate text-xl font-medium"
            title={draft.title.trim() || t("page_title")}
          >
            {draft.title.trim() || t("page_title")}
          </h3>
          {draft.description.trim() ? (
            <p className="mt-2 break-words text-sm text-muted-foreground">
              {draft.description}
            </p>
          ) : null}
          {draft.banner.trim() ? (
            <p className="mt-3 break-words rounded-lg bg-muted px-3 py-2 text-sm">
              {draft.banner}
            </p>
          ) : null}
          <div className="mt-4 grid gap-3">
            {draft.sections.map((section) => (
              <section key={section.key} className="min-w-0">
                {section.name.trim() ? (
                  <h4
                    className="truncate text-sm font-medium text-muted-foreground"
                    title={section.name.trim()}
                  >
                    {section.name.trim()}
                  </h4>
                ) : null}
                <ol className="mt-1 grid gap-1">
                  {section.items.map((item) => (
                    <li
                      key={item.key}
                      className="truncate text-sm"
                      title={
                        statusItemLabel(item.displayName, item.monitorName) ||
                        t("monitor_fallback_name")
                      }
                    >
                      {statusItemLabel(item.displayName, item.monitorName) ||
                        t("monitor_fallback_name")}
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
          {draft.footer.trim() ? (
            <p className="mt-4 break-words text-xs text-muted-foreground">
              {draft.footer}
            </p>
          ) : null}
          <div className="mt-4">
            {mode === "create" ? (
              <p className="text-sm text-muted-foreground">
                {t("page_public_after_create")}
              </p>
            ) : !page?.published ? (
              <p className="text-sm text-muted-foreground">
                {t("page_public_unpublished")}
              </p>
            ) : (
              <>
                <a className="text-sm" href={publicHref}>
                  {t("page_view_public")}
                </a>
                {slugDirty ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("page_public_slug_dirty")}
                  </p>
                ) : null}
              </>
            )}
          </div>
        </aside>
      </div>
      {mode === "edit" && page ? <SubscribersPanel pageId={page.id} /> : null}
      <ConfirmDialog
        open={blocker.status === "blocked"}
        onOpenChange={(open) => {
          if (!open && blocker.status === "blocked") blocker.reset();
        }}
        title={t("page_leave_title")}
        description={t("page_leave_body")}
        confirmLabel={t("page_leave_confirm")}
        cancelLabel={t("page_stay")}
        onConfirm={() => {
          if (blocker.status === "blocked") blocker.proceed();
        }}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("page_delete_title")}
        description={t("page_delete_body")}
        confirmLabel={t("action_delete")}
        cancelLabel={t("action_cancel")}
        pending={submit.pending}
        onConfirm={() => {
          if (!page) return;
          void submit.run(async () => {
            await api(`/api/status-pages/${page.id}`, { method: "DELETE" });
            skip.current = true;
            await refreshQueries(client, [
              ["pages"],
              ["status-page", page.id],
              ["public"],
            ]);
            await navigate({ to: "/console/status-pages" });
          });
        }}
      />
    </>
  );
}

export function StatusPageCreatePage() {
  const monitors = useQuery(monitorsQuery);
  if (monitors.isPending) return <ContentSkeleton />;
  return (
    <StatusPageForm mode="create" monitors={monitors.data?.monitors ?? []} />
  );
}

export function StatusPageEditPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const search = useSearch({ strict: false }) as { created?: number };
  const detail = useQuery({ ...statusPageQuery(id), enabled: Boolean(id) });
  const monitors = useQuery(monitorsQuery);
  if (detail.isPending || monitors.isPending) return <ContentSkeleton />;
  if (!detail.data) {
    return <p className="text-sm">{t("error_not_found")}</p>;
  }
  return (
    <StatusPageForm
      mode="edit"
      page={detail.data}
      monitors={monitors.data?.monitors ?? []}
      created={search.created === 1}
    />
  );
}
