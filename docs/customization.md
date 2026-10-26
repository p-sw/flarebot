# Branding your deployment

Flarebot stays upstream. Your name, colors, type, motion, and copy live in [`brand/`](../brand/). A later `git pull` of Flarebot does not overwrite that directory if you keep your edits there. This guide is for a person using a coding agent (Cursor, Claude Code, or another agent that reads the repo).

The agent should follow [AGENTS.md](../AGENTS.md) and the skills in [`.agents/skills/`](../.agents/skills/). Claude Code reads the same instructions through `CLAUDE.md` and `.claude/skills`.

## 1. Getting started

Fork [p-sw/flarebot](https://github.com/p-sw/flarebot) on GitHub, then clone your fork. You can also start from the Deploy to Cloudflare button in the [README](../README.md). That button deploys the stock app once. Branding still happens in a local checkout of your fork.

```bash
git clone https://github.com/YOUR_USER/flarebot.git
cd flarebot
git remote add upstream https://github.com/p-sw/flarebot
pnpm install
cp .dev.vars.example .dev.vars
pnpm dev
```

Node 22 and pnpm 10. Open http://127.0.0.1:5173. The sample setup secret in `.dev.vars` is `change-me-setup-secret`. Create the owner at `/setup`, then sign in at `/login`. The admin UI is `/console`. `/` redirects to `/login` until a published status page is served at the site root.

Create a branch before you ask the agent to edit anything:

```bash
git checkout -b brand/my-theme
```

Do not commit `.dev.vars`. It is gitignored and holds local secrets.

## 2. Asking your agent

Tell the agent to read `AGENTS.md` and the skill that matches the task. The boundary is `brand/` only:

- A rebrand, a copy change, a motion change, or an ejected component may edit `brand/`.
- Do not change Worker behavior, the database, or `src/` for a visual change. `pnpm brand:check` fails when a dirty tree touches anything else (generated files under `.brand-preview/` are ignored).

| Path                    | What it controls                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| `brand/brand.config.ts` | Logo paths, motion preset (`calm`, `crisp`, `playful`, `none`), and links. Keep `brandApi` at `1`           |
| `brand/locale.json`     | Every user-facing sentence. `messages.app_name` is the name on screen and in mail. `lang` is the BCP 47 tag |
| `brand/tokens.css`      | shadcn color variables, in `oklch()`, including light (`:root`) and dark (`.dark`)                          |
| `brand/motion.ts`       | Springs (`soft`, `snappy`, `drawer`), page transition, stagger, distance, and sidebar duration              |
| `brand/assets/`         | Logo files. Point `logo.light` and `logo.dark` at them                                                      |
| `brand/overrides/`      | Slot components: header, footer, status hero, empty state, login backdrop                                   |
| `brand/ui/`             | A component copied out of `src/ui/` with `pnpm eject`. Empty until you eject                                |
| `brand/MIGRATION.md`    | The brand contract. Read it before merging upstream                                                         |
| `brand/BRAND.md`        | Short map of the same files                                                                                 |

`brand/brand.config.ts` `name` is not what the UI shows. Keep it aligned with `messages.app_name` when you set it. `links.source` defaults to this repository and the footer shows it. Point it at your own repository, or omit the field to hide the link. More detail is in [brand/BRAND.md](../brand/BRAND.md) and [brand/MIGRATION.md](../brand/MIGRATION.md).

### Full rebrand

Ask the agent to follow the `rebrand` skill. A prompt you can paste:

```text
Follow AGENTS.md and the rebrand skill. Edit only brand/.

Set the product name to Harbor in brand/locale.json messages.app_name and
keep brand/brand.config.ts name aligned with it. Put a light logo and a dark
logo in brand/assets/ and point logo.light and logo.dark at those files.
Change the primary color in brand/tokens.css for both light and dark so text
on primary still meets WCAG AA (4.5:1). Set the motion preset to calm.
Point links.source at https://github.com/YOUR_USER/flarebot (or omit it to
hide the footer source link). Update the StatusHero copy in
brand/overrides/StatusHero.tsx and keep its props the same.

Then run pnpm brand:check, pnpm copy:check, and pnpm brand:preview.
Show me the screenshots in .brand-preview/.
```

### Translate the product

One file, one language. There is no language picker and no second catalog. Ask the agent to follow the `translate-ui` skill:

```text
Follow AGENTS.md and the translate-ui skill. Translate brand/locale.json
in place. Keep every key, every {placeholder}, and every plural form.
Set lang to ja. Do not add another locale file or a language selector.
Run pnpm copy:check and pnpm lint:lang.
```

`lang` sets `<html lang>` and `Intl` dates, times, and numbers. Dates render in UTC. `pnpm lint:lang` allows non-Latin text only in `brand/locale.json`.

### Change a slot

Slots are the supported place for layout that tokens cannot express. Keep the exported props the same.

| File                          | Props                                     |
| ----------------------------- | ----------------------------------------- |
| `overrides/AppHeader.tsx`     | `{ title, actions }`                      |
| `overrides/AppFooter.tsx`     | none                                      |
| `overrides/StatusHero.tsx`    | `{ title, description, banner, overall }` |
| `overrides/EmptyState.tsx`    | `{ action }`                              |
| `overrides/LoginBackdrop.tsx` | `{ children }`                            |

`overall` is `operational`, `degraded`, `outage`, `empty`, `paused`, or `maintenance`.

```text
Follow AGENTS.md and the rebrand skill. Edit only brand/overrides/StatusHero.tsx.
Keep the exported props. Make the overall status label larger and show the
banner under the title. Do not change src/. Run pnpm brand:check.
```

### Eject a component

Use this when tokens and slots are not enough. The `eject-component` skill is the checklist. The command copies one file and writes a `.upstream` copy beside it so you can diff later:

```bash
pnpm eject button
```

That copies `src/ui/button.tsx` to `brand/ui/button.tsx`. Imports of `@/ui/button` then resolve to `brand/ui`. The command fails if the source file is missing or the ejected file already exists. The same command works for the other controls under `src/ui/` (`input`, `textarea`, `label`, `card`, `badge`, `separator`, `switch`, and the rest of that directory).

```text
Follow AGENTS.md and the eject-component skill. Run pnpm eject button,
then restyle brand/ui/button.tsx. Keep the exported component name and props.
Do not edit src/ui/button.tsx. Run pnpm typecheck.
```

A later `git pull upstream` does not overwrite `brand/ui/button.tsx`. Compare it with `brand/ui/button.tsx.upstream` if you want to re-apply an upstream fix by hand.

## 3. Reviewing

Run the scope check before you commit, while the tree is still dirty. On a clean tree the scope gate is skipped so upstream CI can pass.

```bash
pnpm exec playwright install chromium
pnpm brand:check
pnpm copy:check
pnpm brand:preview
```

`pnpm brand:check` does four things, in order:

1. Scope. `git status` must show only `brand/` and `.brand-preview/`. Anything else fails. Skip this only on a clean tree.
2. Contrast. Text colors in `brand/tokens.css` need 4.5:1 against their surfaces in both `:root` and `.dark`. The pairs include foreground on background, primary text on primary, muted text, card text, destructive text, status text, and sidebar text.
3. Types. `tsc -p tsconfig.json --noEmit`.
4. Unit tests. `vitest` with `vitest.unit.config.ts`.

`pnpm copy:check` fails when code calls `t()` or `copy()` with a missing key, or when a `.tsx` file hardcodes a new sentence.

`pnpm brand:preview` builds the app and writes three Playwright screenshots to `.brand-preview/` (gitignored):

- `dashboard-light-desktop.png`
- `dashboard-dark-desktop.png`
- `dashboard-dark-mobile.png`

The phone shot is captured after dark mode is turned on. Open those files, then ask the agent to adjust tokens, copy, or motion and run the same commands again. Chromium has to be installed once or `brand:preview` cannot open a browser.

## 4. Deploying

A brand-only change adds no migration. `pnpm deploy` still runs the remote migration step. That step does nothing when the database is already current.

First deploy from your machine:

```bash
pnpm exec wrangler login
```

The Deploy to Cloudflare button provisions D1 from the placeholder id in `wrangler.jsonc` and deploys the stock Worker. It does not commit the new database id back to your fork. Before `pnpm deploy`, put that id in `wrangler.jsonc`. `pnpm exec wrangler d1 list` shows it. A manual first deploy, with no button, creates the database instead:

```bash
pnpm exec wrangler d1 create flarebot
```

Paste the returned id over the placeholder `00000000-0000-0000-0000-000000000000` in `wrangler.jsonc`. The manual path is also in [docs/deployment.md](deployment.md).

Generate secrets and type them yourself. An agent can run the `wrangler secret put` command, but it should not invent or store the secret values. `openssl rand -base64 32` prints a 32-byte key:

```bash
pnpm exec wrangler secret put SETUP_SECRET
pnpm exec wrangler secret put ENCRYPTION_KEY
```

`ENCRYPTION_KEY` encrypts notification credentials, the SMTP password, TOTP secrets, OpenID Connect client secrets, and subscription webhook secrets. Do not rotate it after the first save. Old ciphertext cannot be read with a new key.

Then:

```bash
pnpm deploy
```

That script is `pnpm build`, then `wrangler d1 migrations apply DB --remote`, then `wrangler deploy`. The build removes `.dev.vars` from `dist/` and fails if secret values are left in the Worker or the client assets.

Open the workers.dev or custom hostname:

1. `/setup` creates the owner. It asks for `SETUP_SECRET`. After that, `/setup` redirects to `/login`.
2. `/console` is the admin UI.
3. Create a status page at `/console/status-pages/new`, publish it, and turn on **Serve at the site root**. `/` then serves that page. `/s/<slug>` still works, including for the root page.

Optional mail and bot-check secrets are in [docs/configuration.md](configuration.md). The usual ones are `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`, `MAIL_FROM_NAME`, `TURNSTILE_SITE_KEY`, and `TURNSTILE_SECRET_KEY`. Set them with `pnpm exec wrangler secret put`, or save SMTP in Settings after `ENCRYPTION_KEY` is set. When both Turnstile secrets are set, setup and login require a Turnstile token.

## 5. Staying up to date

Ask the agent to follow the `upgrade-flarebot` skill. It fetches upstream, reads `brand/MIGRATION.md` before the merge, keeps your `brand/` tree, and takes upstream everywhere else unless that file says a prop or token was renamed.

```bash
git fetch upstream
```

Read the incoming `brand/MIGRATION.md`. If `brandApi` in upstream `shared/brand.ts` is greater than `brand/brand.config.ts`, follow the migration note and bump `brandApi` only after the config matches.

```bash
git merge upstream/main
pnpm install
pnpm copy:check
pnpm typecheck
pnpm test
pnpm brand:check
pnpm deploy
```

Keep your `brand/locale.json` when upstream only changes English wording you have already translated. Do not commit `.dev.vars` or `worker-configuration.d.ts`.
