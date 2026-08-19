# start

A self-hosted new tab page. Groups of links, synced across every browser profile and
device you use, served from Cloudflare Pages for free. No accounts, no framework, no
build step — three static files and one 55-line serverless function.

## Why

Browser bookmarks don't sync across Chrome profiles, and hosted start-page services
come and go (RIP iGoogle, RIP start.me free tier). This is the minimal alternative:
your links live in one JSON blob in Cloudflare KV, every profile points at the same
page, and edits made anywhere show up everywhere.

## Features

- **Groups of links** with drag-and-drop reordering, cross-group drags, and a
  what-you-see-is-what-you-get drop placeholder
- **Sync** across profiles/devices via Cloudflare KV — writes gated by a shared
  secret, reconciled by last-write-wins timestamp
- **Instant loads** — renders from a localStorage cache first, fetches KV in the
  background; keeps working offline and pushes when it can
- **Themes** — Bold, Trello, Minimal, Editorial (serif), and Momentum (daily-rotating
  photo background with clock + greeting, plus a settings panel: shuffle or pin the
  photo per device or across every device, star favorite photos to rotate through
  just those, and show/hide the clock, greeting, and a daily inspirational quote)
- **Layouts** — stacked sections, Trello-style columns, full-width rows, or a
  Toby-style masonry grid; plus comfortable/medium/compact density and
  light/dark/system mode. A "default view" can be saved into the synced data and
  loaded on any other device with one click
- **Customization** — per-group accent colors, custom link icons (emoji or letter
  tiles), automatic favicons with fallback
- **Bulk add** — paste URLs and group names, markdown links, "Title — URL" lines,
  or an open-tab dump from a copy-tabs extension, then pick exactly which links to
  keep and a destination group for each
- **Drag links in** — drop a bookmark-bar entry, a link from any page, or the
  address-bar padlock straight onto a group, right where you want it
- **Bulk edit** — one screen with every link's title, URL, icon, and group editable
  inline; change anything anywhere and save once
- **Import/Export** — one-click JSON backup and restore
- **Chrome bookmark import** — feed it a bookmarks export (`chrome://bookmarks` → ⋮ →
  Export bookmarks) and pick exactly which bookmarks to bring in, folder by folder,
  with each folder routed to a new or existing group

## How it works

- `public/` — plain HTML/CSS/JS, no build step
- `functions/api/links.js` — a Cloudflare Pages Function serving `GET`/`PUT /api/links`,
  backed by a KV namespace
- One JSON blob holds everything; the client saves locally first and debounces a PUT.
  Conflict resolution is "newest `updatedAt` wins" — plenty for one person across
  a handful of profiles.

Design decisions and the data model are documented in [DECISIONS.md](DECISIONS.md).

## Deploy your own

Everything fits comfortably in Cloudflare's free tier.

Prereqs: Node, a Cloudflare account, and `npx wrangler login` done once (or
`CLOUDFLARE_API_TOKEN` set).

### 1. Clone and create the KV namespace

```sh
git clone https://github.com/YOURNAME/start && cd start
npx wrangler kv namespace create LINKS
```

Copy the `id` it prints into `wrangler.jsonc`, replacing the existing id.

> If your Cloudflare login spans multiple accounts, create a `.env` file containing
> `CLOUDFLARE_ACCOUNT_ID=<your account id>` so wrangler can't land in the wrong one.
> (Pages config files don't support `account_id` in `wrangler.jsonc`; the `.env` file
> is the supported mechanism, and wrangler loads it automatically.)

### 2. Create the Pages project and deploy

```sh
npx wrangler pages project create startpage --production-branch main
npx wrangler pages deploy ./public
```

The deploy picks up `wrangler.jsonc`, so the KV binding travels with the repo — no
dashboard setup needed. Note the `*.pages.dev` URL it prints.

### 3. Set the sync secret

Pick any strong string (e.g. `openssl rand -hex 24`) and set it:

```sh
npx wrangler pages secret put SYNC_SECRET --project-name startpage
```

Then deploy again so the function runs with the secret available:

```sh
npx wrangler pages deploy ./public
```

The first time you edit anything on the page, it prompts for this secret and caches it
in that profile's localStorage — you enter it once per browser profile, then never
again.

### 4. Set it as your new tab

Install a new-tab-override extension in each Chrome profile — I use
[Custom New Tab URL](https://chromewebstore.google.com/detail/custom-new-tab-url/mmjbdbjnoablegbkcklggeknkfcjkjia)
— and point it at your `https://startpage-xxx.pages.dev` URL (or a custom domain
attached via the Pages dashboard).

Firefox has [New Tab Override](https://addons.mozilla.org/en-US/firefox/addon/new-tab-override/);
on mobile, just set it as your homepage.

## Local development

```sh
npx wrangler pages dev --kv LINKS
```

This serves the static files and functions locally with a local KV simulation. (The
`--kv LINKS` flag is needed because `pages dev` in wrangler 4.x doesn't materialize
the KV binding from `wrangler.jsonc` locally — deploys do.) For the write secret
locally, create a `.dev.vars` file (gitignored):

```
SYNC_SECRET=dev-secret
```

Redeploying after any change is just `npx wrangler pages deploy ./public`.

## Security notes

- Writes require the `X-Sync-Secret` header; reads (`GET /api/links`) are
  unauthenticated — anyone with your URL can see your bookmark list. If that bothers
  you, add the same secret check to `onRequestGet` in `functions/api/links.js`, or put
  [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/)
  in front of the whole project.
- **Export** (in the topbar ⋯ menu) downloads a full JSON backup; **Import** restores one.

## License

MIT
