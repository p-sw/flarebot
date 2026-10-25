# Ejected components

This directory starts empty on purpose. `pnpm eject <component>` copies a file from `src/ui/` to here. The Vite resolver loads `brand/ui/<name>.tsx` instead of `src/ui/<name>.tsx` when the ejected file exists.

Do not add a component here by hand without the eject header. Upstream will not overwrite these files.
