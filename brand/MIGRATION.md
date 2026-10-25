# Brand migrations

## brandApi 1

Current contract:

- `defineBrand` fields: `brandApi`, `name`, `logo.light`, `logo.dark`, `motion` (`calm`, `crisp`, `playful`, `none`), optional `links.home`, `links.source`, and `links.docs`. `defaultLocale` was removed. Delete it from a local config or typecheck fails. The stock config sets `links.source` to the GitHub repository, and the footer shows that link. Omit `links.source` to hide it. The name on screen and in mail is `messages.app_name` in `brand/locale.json`, not `name`.
- `brand/locale.json` is the only copy file. `lang` is a BCP 47 tag. `brand/copy/` and `locales/` are gone. Translate `brand/locale.json` in place. Do not add a second language file.
- `defineMotion` fields: `spring.soft`, `spring.snappy`, optional `spring.drawer`, `page` (`slide-up`, `fade`, `none`), `stagger`, `distance`, optional `sidebarMs`. Omitted `spring.drawer` and `sidebarMs` receive defaults (`420/40` and `180`). `page: "none"` also skips sidebar movement. `brandApi` stays `1`.
- Slot props:
  - `AppHeader({ title, actions })`
  - `AppFooter()` with no props
  - `StatusHero({ title, description, banner, overall })` where `overall` is `operational`, `degraded`, `outage`, or `empty`
  - `EmptyState({ action })`
  - `LoginBackdrop({ children })`
- Token names in `tokens.css` are the shadcn variables plus `--sidebar`, `--sidebar-foreground`, `--sidebar-muted`, and `--status-*-foreground`.

When a future release bumps `brandApi`, this file will list renamed props and tokens. Until then, keep `brandApi` at `1`.
