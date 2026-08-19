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
  - *Density*: comfortable | compact. Compact scales group headers (`--density-scale`),
    shrinks cards/icons/gaps via `--card-min`/`--cards-gap` tokens.
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

## Choices worth noting

- **Groups reorder via ◂ ▸ buttons, cards via drag-and-drop.** Dragging whole groups while
  cards are also draggable is fiddly (nested drag targets); buttons are unambiguous and rare.
- **HTML5 drag-and-drop, no library.** Insert position computed from pointer x/y against card
  midpoints; works across groups.
- **Google favicon service** (`s2/favicons?sz=64`) with an `onerror` swap to a letter tile
  colored by the group accent.
- **`wrangler.jsonc`** (not toml) with `pages_build_output_dir` — current wrangler idiom for
  Pages, and the config travels with the repo.
