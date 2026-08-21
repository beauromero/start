# DECISIONS

## Plan

1. Static site in `public/` (index.html, style.css, app.js) — no build step.
2. Pages Function at `functions/api/links.js` serving `GET`/`PUT /api/links`, backed by a KV
   namespace bound as `LINKS`, writes gated by a shared secret in the `SYNC_SECRET` env var.
3. Client renders instantly from a localStorage cache, fetches KV in the background, and
   reconciles by `updatedAt` timestamp. All mutations save locally first, then debounce a PUT.
4. Seed data ships in the client (`DEFAULT_DATA`); first successful save persists it to KV.

## Data model

One JSON blob under KV key `links:v1`:

```json
{
  "version": 1,
  "updatedAt": "2026-08-18T00:00:00.000Z",
  "groups": [
    {
      "id": "g-unwind",
      "name": "Unwind",
      "links": [
        { "id": "l-abc123", "title": "YouTube", "url": "https://youtube.com" }
      ]
    }
  ]
}
```

- `id`s are random slugs generated client-side (`crypto.randomUUID()` truncated). They exist
  so drag-and-drop and edits address items stably; order is array order.
- `updatedAt` is set by the client on every mutation and is the whole conflict story: last
  write wins, newest timestamp wins on reconcile. Good enough for one person across profiles.
- `version` is a schema escape hatch for future migrations.

## API

- `GET /api/links` → the blob, or `404` if KV is empty (client falls back to seed/cache).
  Reads are unauthenticated per spec — the bookmark list is visible to anyone with the URL.
  If that ever bothers me, the same secret check can be added to GET.
- `PUT /api/links` → requires `X-Sync-Secret` header matching `SYNC_SECRET`; validates the
  body is JSON with a `groups` array; stores verbatim. `401` on bad/missing secret.

## Auth / sync flow

- Secret cached in `localStorage` (`startpage:secret`). Prompted for on the first write (or
  after a `401`), never on read.
- Mutations mark state dirty; a 1.5s debounced PUT flushes. Offline/no-secret keeps working
  locally — the dirty copy pushes next time a save succeeds.
- Reconcile on load: server `updatedAt` newer → adopt server; local newer → push local.
  (Extended 2026-08-20 with focus-triggered pulls, compare-and-swap pushes, and conflict
  merging — see "Multi-window-safe sync & style sync" below.)

## Appearance & customization (added 2026-08-18)

- **Appearance = theme × layout × density × mode**, four orthogonal per-device settings in
  localStorage (not the synced blob), stamped as `data-*` attributes on `<html>` by an
  inline `<head>` script before first paint (no flash). The first three are set in the
  topbar "Style" dialog; mode cycles system → light → dark via the ◐/☀/☾ button.
  - *Themes* (colors + typography only): Bold, Trello, Minimal, Editorial (serif), Momentum
    (photo background + clock/greeting; curated `images.unsplash.com` URLs hotlinked with
    daily rotation, since the keyless source.unsplash.com API was retired).
  - *Layouts* (structure only): vertical (stacked sections), columns (Trello-style
    sideways-scrolling board), rows (full-width rows, cards scroll sideways), grid
    (Toby-style masonry panels via CSS multi-columns + `break-inside: avoid`). Every layout
    except vertical wraps groups in `--panel`-colored panels.
  - *Density*: comfortable | medium | compact. The tighter steps scale group headers
    (`--density-scale`) and shrink cards/icons/gaps via `--card-min`/`--cards-gap` tokens.
  - Legacy combined values (`bold-tight`, `trello-h`) are migrated by the head script into
    theme + layout + density on first load.
- **Group color.** Optional `color` (hex) on a group; absent means the old accent rotation.
  Set via the ● swatch in group controls or by clicking the accent bar; "Auto" deletes the
  override.
- **Custom link icons.** Optional `icon: { glyph, color }` on a link — glyph is an emoji or
  1–2 letters; emoji render bare, letters render on a colored tile. Absent means Google
  favicon with letter-tile fallback, as before. Edited in the link dialog.
- **Bulk add.** Topbar "Bulk" button; textarea parsed line-by-line: non-URL lines start/match
  a group by name, URL lines become links titled by a small known-host map falling back to
  the capitalized second-level domain. Duplicate guessed titles get " 2", " 3" suffixes.
  URLs before any group line land in "Imported".
- **Drag placeholder.** While dragging, a dashed accent-tinted box (`.drop-ghost`) is
  inserted into the grid at the insertion point; on drop, the ghost's DOM position (not a
  recomputed hit test) decides where the link lands, so what you see is what you get. The
  source card is fully hidden one frame after dragstart (hiding synchronously would abort
  Chrome's drag-image capture), so the layout shows the true post-drop arrangement.
- **Sync indicator.** No always-on status dot; a "⚠︎ sync" chip appears only when a push or
  pull fails (hover for the reason). Healthy sync is invisible.

## Chrome bookmark import (added 2026-08-19)

- **One Import button, routed by file type.** The existing topbar Import accepts both our
  JSON backups and browser bookmark exports (`.html`, or any file starting with `<`). JSON
  keeps the replace-everything flow; bookmark HTML opens a selective, additive dialog —
  existing links are never touched.
- **No extension, no API.** Web pages can't read Chrome's bookmarks; the user exports the
  Netscape-format HTML (`chrome://bookmarks` → ⋮ → Export bookmarks). Firefox/Safari/Edge
  exports use the same format and work too.
- **Parsing.** `DOMParser` over the export; each `<DT>` holds either an `<H3>` folder (with
  its child `<DL>` inside the same never-closed `<DT>` — a sibling `<DL>` is also handled
  for stricter exporters) or an `<A>` link. Only `http(s)` URLs survive (drops bookmarklets
  and `chrome://` pages). Untitled links get `titleForUrl()` guesses.
- **Selection UI.** The folder tree is flattened to one section per non-empty folder, in
  document order, headed by its full path ("Bookmarks bar / Dev"). Everything starts
  unchecked — the point is choosing, not bulk-dumping. Each section has a tri-state folder
  checkbox and a destination select: a new group named after the folder (default), or any
  existing group. A group whose name matches the folder is pre-selected for merging.
- **Dupes.** Links whose URL already exists anywhere on the board are marked "already
  added" and skipped by the folder checkbox, but stay individually checkable (you may want
  the same link in a second group). On import, URLs already present in the destination
  group are silently skipped.

## Bulk add links, reworked (2026-08-19)

- **One flow for pasted lists and open tabs.** A separate "Import open tabs" entry
  existed briefly, but it was the same user feature as bulk add, so they merged:
  "Bulk add links" parses everything (group + URL lists, bare/scheme-less URLs,
  markdown `[Title](url)`, "Title — URL" lines, copy-tabs dumps) and routes it through
  a picker instead of adding immediately. Web pages can't enumerate the browser's
  tabs — no web API exposes that, `chrome.tabs` is extension-only — so tab import
  stays paste-driven (copy-tabs extension, or multi-select tabs → right-click → copy
  where the browser offers it).
- **Group lines vs. title lines.** A line that isn't a URL still starts a group for
  the links after it (the original syntax). Exception: when plain lines and URL lines
  alternate one-to-one — exactly the `Title\nURL` shape copy-tabs tools emit — plain
  lines are read as titles instead. The ambiguity is survivable because the picker
  shows the interpretation before anything is added.
- **Picker: checkbox + destination group per link.** Non-duplicate links start
  *checked* (a paste is already a choice; the bookmark import starts unchecked because
  there the point is culling a big export). Row selects default to the link's pasted
  group — matched case-insensitively to an existing group, else a "new group" option —
  falling back to "Imported". A sticky header has a tri-state select-all (skips
  already-added links) and a "Set every group to…" stamp that applies to all rows.
- **Dupes.** URLs already anywhere on the board show "already added"; URLs already in
  the chosen destination group are silently skipped on add; duplicate URLs within one
  paste collapse to the first; duplicate titles within a group get " 2", " 3" suffixes
  as before.

## Momentum background controls (added 2026-08-19)

- The photo already rotated daily (day index into the curated list), but there was no
  way to change it on demand or stop it. Three quiet chips sit bottom-right of the
  hero (inside `#momentum-hero`, so they vanish with the theme): **↻ shuffle** jumps to
  a random different photo, **📌 pin** freezes the current one on this device, and
  **⚙** opens the theme's settings panel.
- **Two preference layers.** Per-device (`startpage:momentum` in localStorage):
  `{ offset, pinned, showClock, showGreeting }` — shuffle stores an `offset` added to
  the day index so rotation *continues from the new photo* rather than snapping back
  tomorrow; pin stores a fixed index; unpinning folds the index back into the offset
  so the photo doesn't jump. Synced (`data.momentum` in the blob):
  `{ pinned, favorites }`, keyed by the stable `photo-…` segment of the Unsplash URL
  (indices would break if the curated list is edited). Precedence: device pin >
  synced pin > rotation.
- **The ⚙ panel** shows all ten photos as thumbnails — click one to show it now, ★ to
  favorite it. Favorites are synced, and when any exist the daily rotation and
  shuffle draw only from them, on every device — a curated sub-rotation. "Pin this
  photo on every device" writes the synced pin (and clears any local pin so the
  change is visible immediately); clock and greeting have show/hide checkboxes
  (per-device). `pullAndReconcile` calls `updateMomentum()` after adopting server
  data so another device's pin applies on load, not at the next 20s tick.

## Momentum daily quote (added 2026-08-19)

- **"Show daily quote" checkbox** in the ⚙ panel (per-device, like clock/greeting);
  renders under the greeting as `“quote” — author`.
- **API: DummyJSON quotes** (`dummyjson.com/quotes/{id}`) — 1454 real quotes with
  stable ids, CORS enabled, no key. The id comes from the day number
  (`day % 1454 + 1`), so every device shows the same quote all day with nothing
  synced, and it's one fetch per day, cached in `startpage:quote`. Alternatives were
  checked and rejected live: quotable.io is dead (expired cert, no response) and
  zenquotes.io sends no CORS headers, so browsers can't call it.
- **Fallback list.** A dozen curated quotes ship in the client, rotated by the same
  day number. The fallback renders immediately while the fetch is in flight (no
  flash of empty), and simply stays if the API is down or the page is offline; a
  failed fetch isn't retried until the next load.
- **Case repair.** ~10% of the DummyJSON set is broken Title Case ("You'Ve Stood
  Up…"); quotes whose long words are ≥70% capitalized get rewritten in sentence
  case (proper nouns in those few lose their caps — better than every word
  shouting).

## Drag links in from outside (added 2026-08-19)

- Dropping a bookmark-bar entry, a link from another page, or the address-bar padlock
  onto any group adds it there — reusing the same drop-ghost placeholder as internal
  card drags, so the insertion point is visible before release. External drags are
  recognized by `text/uri-list` in the dataTransfer types (only when no internal card
  drag is active); internal drags are unaffected since they carry only `text/plain`.
- Titles come from the accompanying `text/html` fragment's anchors when present
  (bookmark and link drags carry one; address-bar drags don't, so those fall back to
  `titleForUrl()`), keyed by browser-normalized URL. Multi-URL drags insert in order
  at the drop position; URLs already in the target group are skipped, and an
  all-duplicate drop writes nothing (no sync churn).
- Tabs themselves can't be dropped — Chrome turns a tab drag into a new window before
  page content ever sees it; dragging the address-bar padlock is the equivalent.

## Bulk edit (added 2026-08-19)

- **One dialog, every link a row** (icon glyph + color, title, URL, group select), grouped
  under sticky group headers with a filter box. Opened from the topbar "Edit" button.
- **Snapshot diffing.** Row values are compared against a snapshot taken at open; the Save
  button live-counts real changes ("Save 3 changes", disabled at zero) and changed rows get
  an accent edge. Reverting a field back to its original drops it from the count. An
  untouched save closes without a mutation, so no pointless sync write.
- **Single mutate() on save.** All edits apply in one pass: field updates in place, then
  moved links are appended to the end of their target group in row order (a missing target
  group falls back to keeping the link where it was). Blanked title/URL fields fall back to
  their original values; URLs get `https://` prepended when scheme-less, same as the link
  form. Empty icon glyph deletes the `icon` key (back to automatic favicon).
- **Group membership only, not group properties.** Group renames/colors/reordering stay in
  their existing inline affordances; this screen is about links.
- **Deleting (added 2026-08-20).** Each row ends in a ✕ toggle that *marks* the link for
  deletion — struck-through with a red edge, undoable by clicking again — rather than
  deleting immediately, matching the screen's stage-everything-then-save-once model. Marks
  count as unsaved changes (backdrop dismiss stays blocked) and the Save button spells out
  the split ("Save 2 changes, delete 1" / "Delete 3 links"). Saving with marks asks one
  confirm for the batch; cancelling it keeps the dialog open with marks intact.

## Decluttered chrome (added 2026-08-19)

- **Topbar collapsed to filter + "+ Group" + a ⋯ menu.** Bulk add, bulk edit, Style,
  appearance mode, Export, and Import are used rarely, so they moved into a static
  dropdown (same element ids, so all existing wiring is untouched). The mode item cycles
  system → light → dark in place without closing the menu; everything else closes it.
- **Group controls collapsed to one ⋯ menu** (add link, color, move left/right, delete),
  leaving the header to the title. Group menus are built on demand and positioned
  `fixed` by JS so they escape the scrolling containers of the columns/rows layouts.
  The ● color swatch is gone from the header; the accent bar still opens the color
  dialog directly. Menus close on outside click, Escape, or any scroll.
- **Link delete lives in the edit dialog.** Cards show a single ✎ on hover; the edit
  dialog grows a left-aligned Delete button (hidden when adding). It still confirms,
  and cancelling the confirm keeps the dialog open.

## Style refinements (added 2026-08-19)

- **Default view.** Style stays per-device, but "Save as default view" (in the Style
  dialog) snapshots the current theme/layout/density/add-link-visibility into the synced
  blob as `data.defaultView`; "Load default view" on any device copies it back into that
  device's localStorage. Loading is local-only (no sync write); the load button is
  disabled until a default has been saved. Deliberately explicit — a fresh device never
  auto-adopts the default, it just has the button.
- **Medium density.** A step between comfortable and compact (`--density-scale: 0.85`,
  21px icons, 205px cards) for screens where comfortable wastes space but compact is
  too cramped.
- **Full-width topbar in columns layout.** The columns board ignores the 1400px
  page max-width and spans the whole screen, so the topbar does too
  (`html[data-layout="columns"] .topbar { max-width: none; }`) — search bar and menu
  align with the leftmost/rightmost columns instead of floating centered above them.
- **Hideable "+ Add link" cards.** A Style-dialog checkbox (per-device,
  `startpage:addlink`, stamped as `data-addlink` by the head script) hides the dashed
  add-card from every group; the group ⋯ menu keeps its Add link entry, so nothing is
  unreachable — the board just gets quieter.

## Interaction fixes (added 2026-08-19)

- **Backdrop click dismisses edit dialogs — only when nothing is unsaved.** The link
  dialog compares the form against a snapshot taken at open; the bulk-edit dialog reuses
  its existing row diffing. With unsaved edits, the backdrop click does nothing (Cancel /
  Escape still discard). The pointer must go down *and* up on the backdrop, so a text
  selection that ends outside the dialog doesn't close it.
- **Hideable search bar.** A topbar-menu toggle (per-device, `startpage:search`, stamped
  as `data-search` by the head script) hides the filter input. Pressing `/` still works:
  it reveals the bar until blur, which then clears the filter and re-hides it. Hiding via
  the toggle also clears any active filter so no links stay invisibly filtered out.
- **Flow-aware drop targeting.** The old insert-position test required the cursor inside
  a card's vertical band and split before/after by horizontal midpoint — wrong axis for
  the columns layout's vertical stacks, and cursor positions in the gaps between cards
  matched nothing (ghost jumped to the end), so the ghost oscillated on every dragover:
  the flicker. Now the cards container's computed style picks the flow (vertical stack,
  horizontal row, or wrapping grid) and the anchor is the first card past the cursor
  along the flow axis, which is stable under the ghost's own layout shifts and has no
  dead zones.

## Favicon resolver (added 2026-08-20)

- **Why not just Google's service.** `s2/favicons` is keyed by hostname only, so every
  `docs.google.com` link gets the same "G" (Sheets/Docs icons are per-path), and sites its
  crawler can't reach (prosebox.net sits behind a Cloudflare bot challenge) get a generic
  globe. Worse, the globe arrives as a valid image body on a 404, and browsers render 404
  images — so `onerror` never fires and the client can't detect the miss (CORS hides the
  status too). Chrome bookmarks don't have this problem because Chrome saves the icon the
  page itself declared when you visited it; a web page can't read that database.
- **`GET /api/icon?url=…`** (Pages Function) resolves icons server-side, where statuses
  *are* visible: a path-aware override table for Google products (their per-path icons
  live at stable `gstatic.com/images/branding` URLs) → Google s2 → DuckDuckGo `ip3`
  (which had prosebox when Google didn't) → the site's own `/favicon.ico`. First genuine
  `200 image/*` wins and is proxied through with a week of cache; a miss everywhere is an
  *empty* 404, which does fire the client's `onerror`.
- **Client chain.** Cards try `/api/icon`, then the site's `/favicon.ico` directly from
  the browser (that request carries the user's cookies and bot-wall clearance, so it can
  succeed where server-side fetches are blocked), then the letter tile as before.

## Multi-window-safe sync & style sync (added 2026-08-20)

Pure last-write-wins lost data in practice: a long-open window that made any edit stamped
its stale copy with the newest `updatedAt` and clobbered links added from another
window/profile. Three fixes, layered:

- **Pull on focus.** `pullAndReconcile()` re-runs on `visibilitychange`/`focus` (throttled
  to 3s), so a returned-to window refreshes before you edit in it. Same-profile windows
  additionally sync instantly through the `storage` event, no network needed. If an edit
  dialog is open when a newer copy arrives, the adopt is deferred until the dialog closes
  (`pendingPull`) so the UI isn't yanked mid-edit.
- **Compare-and-swap push.** Every PUT sends `X-Base-Rev` — the server `updatedAt` this
  window last reconciled against (`startpage:baserev`). The Function rejects a mismatch
  with `409` + the current blob. Header absent = legacy unconditional write. KV is
  eventually consistent so this is best-effort CAS, but a single user hits the same edge
  PoP where reads see their own writes.
- **Union-by-id merge on conflict.** On `409` (or a pull that finds both sides changed),
  `mergeData()` keeps local versions of items existing on both sides and appends
  server-only groups/links, then retries (max 3). Tradeoff accepted: a concurrent delete
  can resurrect once (delete again sticks); that beats silently losing adds. Non-group
  fields (`style`, `momentum`, `defaultView`) take the local side wholesale.
- **Style sync is opt-in per device.** "Sync style across devices" checkbox in the Style
  dialog (`startpage:stylesync`). When on, the five style settings (theme, layout,
  density, add-link, search bar — mode stays per-device) mirror `data.style` in the
  synced blob: any change publishes, any pull applies. Turning it on adopts the existing
  synced style if present, else seeds it from this device. Off = old behavior; the
  one-shot "Save/Load default view" buttons remain for cherry-picking a look without
  live-following it.
- **Momentum's photo choice follows the same toggle.** The separate "Pin this photo on
  every device" button is gone — two pin concepts (device 📌 vs server pin) was the
  confusing part. Now the one 📌 pin and the shuffle/thumbnail choice (pin + rotation
  offset) read/write `data.momentum` when style sync is on (same photo everywhere) and
  localStorage when off. Sync-off devices ignore any synced pin. Favorites still sync
  unconditionally — they're curation, like the links. Lost mixed case, accepted: "same
  theme everywhere, different photo per device."

- **Groups reorder by dragging their header** (added 2026-08-20; the ⋯-menu ◂ ▸ entries
  remain). The header-as-handle sidesteps the nested-drag-target problem that originally
  argued for buttons only: cards drag from the card body, groups drag from the header, and
  the two never overlap. A board-level ghost (`.group-ghost`) marks the insertion point
  using the same greedy flow-aware anchor test as cards, extended with a column-major case
  for the grid layout's CSS multi-columns. `setDragImage(section)` shows the whole group
  while dragging; the source hides a frame later, same as cards.

## Offline app shell (added 2026-08-21)

- **Service-worker shell snapshots.** `public/sw.js` precaches the canonical `/` HTML, CSS,
  and JavaScript, so opening a new tab is served locally and the full UI works without a
  connection after one successful online visit. Pages redirects `/index.html` to `/`, so
  the canonical URL is cached directly rather than relying on a cached redirect response.
  The existing localStorage-first data flow supplies the links immediately.
- **Atomic background refresh.** A refresh downloads the complete shell into a uniquely
  named, immutable snapshot. Only after all files are stored and verified does one metadata
  record make it active; the prior snapshot remains as a fallback until the next successful
  refresh. An installing replacement reuses a valid snapshot without writing; only after it
  becomes the sole active worker may it refresh or clean up, preventing worker generations
  from racing over shared caches. If the active snapshot is damaged but the prior snapshot
  is complete, installation preserves and reuses that fallback; metadata pointers are never
  cleared before a replacement publishes successfully. Each cached HTML document rewrites
  its CSS and JavaScript references with the snapshot id, so a refresh published between the
  document and subresource requests cannot mix two releases. Retired immutable snapshots get
  a ten-minute grace period measured from retirement for in-flight documents, then cleanup
  bounds their lifetime. An
  in-flight promise coalesces overlapping refreshes, and a persisted attempt timestamp
  throttles both successful and failed refresh attempts to once every five minutes.
- **Safe v2 migration.** The v3 caches use the disjoint `startpage3-` prefix. A still-active
  v2 worker cleans every `startpage-` cache it does not recognize, so naming v3 caches under
  that legacy prefix would let the outgoing worker delete an installing worker's snapshot.
  Legacy caches are removed only after v3 activates and claims the clients.
- **Runtime visual cache.** Google Fonts, favicons (`/api/icon` and direct image fallbacks),
  and viewed Momentum photos are cached on first use, capped at 100 entries. A photo must
  have loaded once before it is available offline; the page's built-in typeface and tile
  fallbacks still work when an uncached visual is unavailable.
- **Sync stays network-only.** `/api/links` is never intercepted. The client already treats
  localStorage as the instant/offline copy, while a live GET is needed for multi-window and
  multi-profile reconciliation; caching that response could make an old server blob look
  authoritative. Offline writes remain dirty and an `online` event retries them as soon as
  the browser reports connectivity again, even if the tab stayed focused.
- **Worker freshness.** `public/_headers` makes `/sw.js` non-cacheable and registration uses
  `updateViaCache: "none"`, so browsers reliably discover service-worker logic changes.
- **Browser acceptance is executable.** `tests/offline.spec.mjs` uses a controllable local
  origin to prove dead-origin new-tab/reload, snapshot-pinned updates, complete rollback from
  a damaged active cache, a hostile legacy-worker migration, failed-refresh throttling, and
  connectivity-return retry. It runs serially in Chromium so Cache Storage and service-worker
  lifecycle assertions stay deterministic.
- **HTML5 drag-and-drop, no library.** Insert position computed from pointer x/y against card
  midpoints; works across groups.
- **Favicons via `/api/icon`** (see "Favicon resolver" above; originally bare
  `s2/favicons?sz=64`) with an `onerror` swap to a letter tile colored by the group accent.
- **`wrangler.jsonc`** (not toml) with `pages_build_output_dir` — current wrangler idiom for
  Pages, and the config travels with the repo.
