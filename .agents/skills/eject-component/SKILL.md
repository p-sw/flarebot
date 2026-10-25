---

name: eject-component
description: Copy one shadcn-style component from src/ui into brand/ui so a deployer can restyle it. Use when a visual change cannot be done with tokens or a slot.
---

# Eject a component

## Allowed files

- `brand/ui/<name>.tsx` (created by the command)
- Do not edit `src/ui/<name>.tsx` afterwards. That file stays upstream.

## Steps

1. Confirm the component exists: `src/ui/button.tsx`, `input.tsx`, `textarea.tsx`, `label.tsx`, `card.tsx`, `badge.tsx`, `separator.tsx`, `switch.tsx`.
2. Run `pnpm eject <name>`. Example: `pnpm eject button`.
3. Edit `brand/ui/<name>.tsx`. The Vite resolver prefers `brand/ui` over `src/ui` for imports of `@/ui/<name>`.
4. Keep the exported component name and props. You may change classes and structure.
5. Do not import a second copy of the same component from `src/ui` inside the ejected file.

## Verification

```bash
pnpm typecheck
pnpm brand:preview
```

A later `git pull upstream` will not overwrite `brand/ui/<name>.tsx`. Compare it with `brand/ui/<name>.tsx.upstream` if you want to re-apply an upstream fix by hand.
