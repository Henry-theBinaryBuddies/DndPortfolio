# Adventurer Anvil: putting it online

Live at **https://anvil.creaturecauldron.com** since 25 Nov 2026.

```
  https://anvil.creaturecauldron.com     Cloudflare Pages: static files only (free)
            │
            └── the page loads only its own files: the app, the SRD pack, the published schema
                Characters stay in each visitor's browser (localStorage) and in the files they download.
```

There is no server: Anvil is a static site until Milestone 2 (accounts), which is on hold while Anvil folds into
Tome & Tile.

## What's in the repository for it

| File | Job |
|---|---|
| `frontend/public/_headers` | The headers Cloudflare Pages sends: a strict Content-Security-Policy (the page loads only its own files and talks to nothing else; images may be `data:` and `blob:`, for portraits), no framing, no sniffing, no camera, microphone or location; long caching for the hashed scripts and styles, an hour for the pack and the schema; and the schema open to any site (`Access-Control-Allow-Origin: *`) for editors and tools. |
| `frontend/public/404.html`, `404.css` | A real "not found" page. Without it, Cloudflare Pages shows the app for any address. |
| `frontend/public/favicon.svg` | The icon. |
| `frontend/vite.config.ts` | `npm run preview` sends the same headers as `_headers`, so the built site can be checked locally. |
| `frontend/playwright.production.config.ts`, `frontend/e2e-production/` | `npm run test:production`: builds the site, serves it with its real headers, and checks that everything works with no policy violations (saving, a portrait, a download, the Tome & Tile export). |

## Setting it up on Cloudflare Pages (done once)

Cloudflare dashboard, **Workers & Pages**, **Create**, **Pages**, **Connect to Git**, choose the `DndPortfolio`
repository.

| Setting | Value |
|---|---|
| Production branch | `master` |
| Framework preset | none |
| Root directory | `adventurer-anvil/frontend` |
| Build command | `npm ci && npm run build` |
| Build output directory | `dist` |
| Environment variable | `NODE_VERSION` = `22` |
| Build watch paths (Settings, Builds) | Include `adventurer-anvil/*`, so pushes to the portfolio's other projects don't rebuild Anvil |

After the first deploy: **Custom domains**, add `anvil.creaturecauldron.com` (Cloudflare adds the DNS record, since the
`creaturecauldron.com` zone is on Cloudflare).

Every push to `master` that touches `adventurer-anvil/` now rebuilds the site. Branch previews appear on `*.pages.dev`.
Saved characters belong to the address they were made on, so a character made on a preview isn't on the real site:
download it there and open the file on the real site.

## Checking it after a deploy

1. Open https://anvil.creaturecauldron.com, make a character, and look at the browser console: it should be empty.
2. See the headers:

   ```
   curl -sI https://anvil.creaturecauldron.com/
   ```

   The answer should include `content-security-policy: default-src 'self'; ...` and `x-content-type-options: nosniff`.
3. Run the production checks against the live site, which also checks the "not found" page:

   ```
   cd frontend
   PW_BASE_URL=https://anvil.creaturecauldron.com npm run test:production
   ```

   (In PowerShell: `$env:PW_BASE_URL = "https://anvil.creaturecauldron.com"; npm run test:production`.)

## The licence online

Anvil's code is AGPL-3.0, which says people using it over a network must be offered its source. Every screen's footer
links to the source code on GitHub, and the Licences page says so.
