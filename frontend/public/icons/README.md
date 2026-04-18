# PWA icons

Replace the placeholder SVG icons with real PNGs before shipping:

- `icon-192.png` — 192×192
- `icon-512.png` — 512×512
- `maskable-512.png` — 512×512 with safe zone

You can generate all three from a single square SVG with e.g.:

```bash
npx @vite-pwa/assets-generator --preset minimal public/icons/source.svg
```
