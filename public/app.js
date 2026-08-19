"use strict";

const LS_DATA = "startpage:data";
const LS_DIRTY = "startpage:dirty";
const LS_SECRET = "startpage:secret";
const LS_THEME = "startpage:theme";
const LS_LAYOUT = "startpage:layout";
const LS_DENSITY = "startpage:density";
const LS_MODE = "startpage:mode";
const API = "/api/links";
const PUSH_DEBOUNCE_MS = 1500;
const ACCENTS = ["#a78bfa", "#ff7f6e", "#4fd1c5", "#7bd88f", "#f6c177"];
const PALETTE = [
  "#a78bfa", "#ff7f6e", "#4fd1c5", "#7bd88f", "#f6c177",
  "#f472b6", "#60a5fa", "#f87171", "#facc15", "#94a3b8",
];

const DEFAULT_DATA = {
  version: 1,
  updatedAt: "2026-08-18T00:00:00.000Z",
  groups: [
    {
      id: "g-unwind",
      name: "Unwind",
      links: [
        { id: "l-uw-site", title: "Unwind site", url: "https://unwindbehavior.com/" },
        { id: "l-uw-appstore", title: "App Store", url: "https://apps.apple.com/us/app/unwind-dog-behavior-tracker/id6755273686" },
        { id: "l-uw-blog", title: "Pages CMS (blog)", url: "https://app.pagescms.org/identity-mad/unwind-site/main/collection/blog" },
        { id: "l-uw-asc", title: "App Store Connect", url: "https://appstoreconnect.apple.com/login?targetUrl=%2Fapps%2F6755273686%2Fdistribution%2Fios%2Fversion%2Finflight&authResult=FAILED" },
        { id: "l-uw-supa1", title: "Supabase", url: "https://supabase.com/dashboard/project/ypppsmktdiqawcrdfohj" },
        { id: "l-uw-supa2", title: "Supabase (editor)", url: "https://supabase.com/dashboard/project/puaoqrjrjxtphrbtsxre/editor" },
        { id: "l-uw-cf", title: "Cloudflare", url: "https://dash.cloudflare.com/1db0ff326e87972f648534825980ec96/unwindbehavior.com" },
        { id: "l-uw-td", title: "TelemetryDeck", url: "https://dashboard.telemetrydeck.com/o/com.identitymad/apps/D51D7325-6506-47D4-AF83-E3B67088ED6D" },
      ],
    },
    {
      id: "g-im",
      name: "Identity Mad",
      links: [
        { id: "l-im-gh", title: "GitHub repos", url: "https://github.com/orgs/Identity-Mad/repositories" },
        { id: "l-im-mobbin", title: "Mobbin", url: "https://mobbin.com/discover/apps/ios/popular" },
      ],
    },
  ],
};

let data = loadLocal();
let pushTimer = null;

const board = document.getElementById("board");
const filterInput = document.getElementById("filter");
const syncStatus = document.getElementById("sync-status");
const linkDialog = document.getElementById("link-dialog");
const linkForm = document.getElementById("link-form");
const bulkDialog = document.getElementById("bulk-dialog");
const bulkForm = document.getElementById("bulk-form");
const colorDialog = document.getElementById("color-dialog");
const styleDialog = document.getElementById("style-dialog");
const themeSelect = document.getElementById("theme-select");
const layoutSelect = document.getElementById("layout-select");
const densitySelect = document.getElementById("density-select");
const modeToggle = document.getElementById("mode-toggle");

// ---------- persistence ----------

function loadLocal() {
  try {
    const raw = localStorage.getItem(LS_DATA);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.groups)) return parsed;
    }
  } catch {}
  return structuredClone(DEFAULT_DATA);
}

function saveLocal() {
  localStorage.setItem(LS_DATA, JSON.stringify(data));
}

function isDirty() {
  return localStorage.getItem(LS_DIRTY) === "1";
}

function setDirty(v) {
  if (v) localStorage.setItem(LS_DIRTY, "1");
  else localStorage.removeItem(LS_DIRTY);
  updateStatusDot();
}

function mutate(fn) {
  fn(data);
  data.updatedAt = new Date().toISOString();
  saveLocal();
  setDirty(true);
  render();
  schedulePush(true);
}

// ---------- appearance (theme / layout / density / mode) ----------
// All four are per-device preferences (localStorage), not part of the synced
// blob. The inline head script migrates legacy combined values (bold-tight,
// trello-h) before this code runs, so plain reads are safe here.

const lightQuery = matchMedia("(prefers-color-scheme: light)");
const MODES = ["system", "light", "dark"];
const MODE_ICONS = { system: "◐", light: "☀", dark: "☾" };

function getMode() {
  const m = localStorage.getItem(LS_MODE);
  return MODES.includes(m) ? m : "system";
}

function applyAppearance() {
  const mode = getMode();
  const theme = localStorage.getItem(LS_THEME) || "bold";
  const layout = localStorage.getItem(LS_LAYOUT) || "vertical";
  const density = localStorage.getItem(LS_DENSITY) || "comfortable";
  const el = document.documentElement;
  el.dataset.theme = theme;
  el.dataset.layout = layout;
  el.dataset.density = density;
  el.dataset.mode = mode === "system" ? (lightQuery.matches ? "light" : "dark") : mode;
  themeSelect.value = theme;
  layoutSelect.value = layout;
  densitySelect.value = density;
  modeToggle.textContent = MODE_ICONS[mode];
  modeToggle.title = "Appearance: " + mode + " (click to switch)";
  updateMomentum();
}

document.getElementById("style-btn").addEventListener("click", () => {
  styleDialog.showModal();
});

// Changes apply live while the dialog is open
themeSelect.addEventListener("change", () => {
  localStorage.setItem(LS_THEME, themeSelect.value);
  applyAppearance();
});
layoutSelect.addEventListener("change", () => {
  localStorage.setItem(LS_LAYOUT, layoutSelect.value);
  applyAppearance();
});
densitySelect.addEventListener("change", () => {
  localStorage.setItem(LS_DENSITY, densitySelect.value);
  applyAppearance();
});

modeToggle.addEventListener("click", () => {
  const next = MODES[(MODES.indexOf(getMode()) + 1) % MODES.length];
  localStorage.setItem(LS_MODE, next);
  applyAppearance();
});

lightQuery.addEventListener("change", () => {
  if (getMode() === "system") applyAppearance();
});

// ---------- momentum hero ----------
// Unsplash's keyless source.unsplash.com API was retired, so this uses direct
// images.unsplash.com URLs (hotlinking is allowed, no API key) from a curated
// set of scenic shots, rotating daily.
const MOMENTUM_PHOTOS = [
  "https://images.unsplash.com/photo-1506905925346-21bda4d32df4", // mountain peak
  "https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05", // foggy hills
  "https://images.unsplash.com/photo-1441974231531-c6227db76b6e", // forest road
  "https://images.unsplash.com/photo-1469474968028-56623f02e42e", // mountain sunrise
  "https://images.unsplash.com/photo-1433086966358-54859d0ed716", // waterfall
  "https://images.unsplash.com/photo-1519681393784-d120267933ba", // starry mountains
  "https://images.unsplash.com/photo-1475924156734-496f6cac6ec1", // island sunset
  "https://images.unsplash.com/photo-1472214103451-9374bd1c798e", // green field
  "https://images.unsplash.com/photo-1506744038136-46273834b3fb", // lake reflection
  "https://images.unsplash.com/photo-1501594907352-04cda38ebc29", // bay at dusk
].map((u) => u + "?auto=format&fit=crop&w=1920&q=80");

const momentumHero = document.getElementById("momentum-hero");
const momentumClock = document.getElementById("momentum-clock");
const momentumGreeting = document.getElementById("momentum-greeting");

function updateMomentum() {
  const active = document.documentElement.dataset.theme === "momentum";
  momentumHero.hidden = !active;
  if (!active) {
    document.body.style.removeProperty("--momentum-image");
    return;
  }
  const day = Math.floor(Date.now() / 86400000);
  const url = MOMENTUM_PHOTOS[day % MOMENTUM_PHOTOS.length];
  document.body.style.setProperty("--momentum-image", `url("${url}")`);

  const now = new Date();
  const h = now.getHours();
  momentumGreeting.textContent =
    h < 5 ? "Good night." :
    h < 12 ? "Good morning." :
    h < 18 ? "Good afternoon." : "Good evening.";
  momentumClock.textContent =
    (h % 12 || 12) + ":" + String(now.getMinutes()).padStart(2, "0");
}

setInterval(updateMomentum, 20 * 1000);

// ---------- sync ----------

// The old always-on colored dot confused more than it informed; now sync state
// is invisible when healthy and a small "⚠︎ sync" chip appears only on errors.
function updateStatusDot(state) {
  syncStatus.hidden = state !== "error";
}

function getSecret(interactive) {
  let secret = localStorage.getItem(LS_SECRET);
  if (!secret && interactive) {
    secret = window.prompt("Sync secret (stored locally, sent as X-Sync-Secret):");
    if (secret) localStorage.setItem(LS_SECRET, secret.trim());
  }
  return localStorage.getItem(LS_SECRET);
}

function schedulePush(interactive) {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => push(interactive), PUSH_DEBOUNCE_MS);
}

async function push(interactive) {
  const secret = getSecret(interactive);
  if (!secret) return; // stay dirty; will retry on next user edit

  try {
    const res = await fetch(API, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Sync-Secret": secret,
      },
      body: JSON.stringify(data),
    });
    if (res.status === 401) {
      localStorage.removeItem(LS_SECRET);
      updateStatusDot("error");
      syncStatus.title = "Wrong sync secret — edit anything to be re-prompted";
      return;
    }
    if (!res.ok) throw new Error("HTTP " + res.status);
    setDirty(false);
  } catch (err) {
    updateStatusDot("error");
    syncStatus.title = "Sync failed: " + err.message;
  }
}

async function pullAndReconcile() {
  try {
    const res = await fetch(API, { cache: "no-store" });
    if (res.status === 404) {
      // KV never written; push our copy (seed or cache) when a secret exists
      setDirty(true);
      schedulePush(false);
      return;
    }
    if (!res.ok) throw new Error("HTTP " + res.status);
    const server = await res.json();
    if (!server || !Array.isArray(server.groups)) return;

    const serverAt = server.updatedAt || "";
    const localAt = data.updatedAt || "";
    if (serverAt > localAt) {
      if (isDirty()) {
        // Both sides changed; newest wins (last-write-wins by design)
        console.warn("startpage: server copy newer than dirty local copy — server wins");
      }
      data = server;
      saveLocal();
      setDirty(false);
      render();
    } else if (localAt > serverAt || isDirty()) {
      schedulePush(false);
    } else {
      setDirty(false);
    }
  } catch (err) {
    updateStatusDot("error");
    syncStatus.title = "Couldn't reach sync API: " + err.message;
  }
}

// ---------- rendering ----------

function uid(prefix) {
  return prefix + "-" + crypto.randomUUID().slice(0, 8);
}

function faviconUrl(url) {
  try {
    const host = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
  } catch {
    return null;
  }
}

function accentFor(group, gi) {
  return group.color || ACCENTS[gi % ACCENTS.length];
}

function render() {
  board.textContent = "";
  data.groups.forEach((group, gi) => {
    board.appendChild(renderGroup(group, gi));
  });
  applyFilter();
}

function renderGroup(group, gi) {
  const section = document.createElement("section");
  section.className = "group";
  section.dataset.groupId = group.id;
  section.style.setProperty("--group-accent", accentFor(group, gi));

  const header = document.createElement("div");
  header.className = "group-header";

  const name = document.createElement("h2");
  name.className = "group-name";
  name.textContent = group.name;
  name.title = "Click to rename";
  name.addEventListener("click", () => startRename(group, name));
  header.appendChild(name);

  const colorBtn = document.createElement("button");
  colorBtn.type = "button";
  colorBtn.className = "color-btn";
  colorBtn.title = "Group color";
  colorBtn.addEventListener("click", () => openColorDialog(group));

  const controls = document.createElement("div");
  controls.className = "group-controls";
  controls.append(
    iconBtn("+", "Add link", () => openLinkDialog(group.id, null)),
    colorBtn,
    iconBtn("◂", "Move group left", () => moveGroup(group.id, -1)),
    iconBtn("▸", "Move group right", () => moveGroup(group.id, 1)),
    iconBtn("✕", "Delete group", () => deleteGroup(group), "danger"),
  );
  header.appendChild(controls);
  section.appendChild(header);

  const bar = document.createElement("div");
  bar.className = "group-bar";
  bar.title = "Group color";
  bar.style.cursor = "pointer";
  bar.addEventListener("click", () => openColorDialog(group));
  section.appendChild(bar);

  const cards = document.createElement("div");
  cards.className = "cards";
  cards.dataset.groupId = group.id;
  group.links.forEach((link) => cards.appendChild(renderCard(link, group)));

  const add = document.createElement("button");
  add.type = "button";
  add.className = "card-add";
  add.textContent = "+ Add link";
  add.addEventListener("click", () => openLinkDialog(group.id, null));
  cards.appendChild(add);

  wireDropZone(cards);
  section.appendChild(cards);
  return section;
}

function renderCard(link, group) {
  const card = document.createElement("div");
  card.className = "card";
  card.dataset.linkId = link.id;
  card.dataset.search = (link.title + " " + link.url).toLowerCase();
  card.draggable = true;

  const a = document.createElement("a");
  a.className = "card-main";
  a.href = link.url;

  if (link.icon && link.icon.glyph) {
    a.appendChild(glyphTile(link.icon));
  } else {
    const icoUrl = faviconUrl(link.url);
    if (icoUrl) {
      const img = document.createElement("img");
      img.className = "card-favicon";
      img.src = icoUrl;
      img.alt = "";
      img.addEventListener("error", () => img.replaceWith(letterTile(link.title)));
      a.appendChild(img);
    } else {
      a.appendChild(letterTile(link.title));
    }
  }

  const title = document.createElement("span");
  title.className = "card-title";
  title.textContent = link.title;
  a.appendChild(title);
  card.appendChild(a);

  const actions = document.createElement("div");
  actions.className = "card-actions";
  actions.append(
    iconBtn("✎", "Edit link", () => openLinkDialog(group.id, link)),
    iconBtn("✕", "Delete link", () => deleteLink(group.id, link), "danger"),
  );
  card.appendChild(actions);

  card.addEventListener("dragstart", (e) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", link.id);
    card.classList.add("dragging");
    // Hide the source card one frame later — hiding it synchronously would
    // abort the drag in Chrome before it captures the drag image.
    setTimeout(() => {
      if (dragState) card.classList.add("drag-hidden");
    }, 0);
    dragState = { linkId: link.id, fromGroupId: group.id };
  });
  card.addEventListener("dragend", () => {
    card.classList.remove("dragging", "drag-hidden");
    dragState = null;
    removeDropGhost();
  });

  return card;
}

function letterTile(title) {
  const tile = document.createElement("span");
  tile.className = "card-tile";
  tile.textContent = (title.trim()[0] || "?").toUpperCase();
  return tile;
}

// Roughly: does the glyph start with a character outside basic Latin? Then treat
// it as an emoji (no colored background, larger size).
function glyphTile(icon) {
  const tile = document.createElement("span");
  const isEmoji = /^\P{ASCII}/u.test(icon.glyph);
  tile.className = "card-tile" + (isEmoji ? " emoji" : "");
  tile.textContent = icon.glyph;
  if (!isEmoji && icon.color) tile.style.setProperty("--tile-color", icon.color);
  return tile;
}

function iconBtn(label, title, onClick, extraClass) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "icon-btn" + (extraClass ? " " + extraClass : "");
  btn.textContent = label;
  btn.title = title;
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  });
  return btn;
}

// ---------- group ops ----------

document.getElementById("add-group").addEventListener("click", () => {
  const name = window.prompt("Group name:");
  if (!name || !name.trim()) return;
  mutate((d) => d.groups.push({ id: uid("g"), name: name.trim(), links: [] }));
});

function startRename(group, nameEl) {
  const input = document.createElement("input");
  input.className = "group-name";
  input.value = group.name;
  nameEl.replaceWith(input);
  input.focus();
  input.select();

  const commit = () => {
    const v = input.value.trim();
    if (v && v !== group.name) {
      mutate((d) => {
        const g = d.groups.find((g) => g.id === group.id);
        if (g) g.name = v;
      });
    } else {
      render();
    }
  };
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
    if (e.key === "Escape") {
      input.removeEventListener("blur", commit);
      render();
    }
  });
}

function moveGroup(groupId, delta) {
  mutate((d) => {
    const i = d.groups.findIndex((g) => g.id === groupId);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= d.groups.length) return;
    const [g] = d.groups.splice(i, 1);
    d.groups.splice(j, 0, g);
  });
}

function deleteGroup(group) {
  const n = group.links.length;
  const msg = n
    ? `Delete group “${group.name}” and its ${n} link${n === 1 ? "" : "s"}?`
    : `Delete empty group “${group.name}”?`;
  if (!window.confirm(msg)) return;
  mutate((d) => {
    d.groups = d.groups.filter((g) => g.id !== group.id);
  });
}

// ---------- group color ----------

let colorCtx = null; // groupId being edited

function setGroupColor(groupId, color) {
  mutate((d) => {
    const g = d.groups.find((g) => g.id === groupId);
    if (!g) return;
    if (color) g.color = color;
    else delete g.color;
  });
}

function openColorDialog(group) {
  colorCtx = group.id;
  const swatches = document.getElementById("group-swatches");
  swatches.textContent = "";
  PALETTE.forEach((color) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "swatch" + (group.color === color ? " selected" : "");
    b.style.background = color;
    b.title = color;
    b.addEventListener("click", () => {
      setGroupColor(colorCtx, color);
      colorDialog.close();
    });
    swatches.appendChild(b);
  });
  const custom = document.getElementById("group-color-custom");
  custom.value = group.color || "#a78bfa";
  colorDialog.showModal();
}

document.getElementById("group-color-custom").addEventListener("change", (e) => {
  setGroupColor(colorCtx, e.target.value);
  colorDialog.close();
});
colorDialog.querySelector('[data-action="auto"]').addEventListener("click", () => {
  setGroupColor(colorCtx, null);
  colorDialog.close();
});
colorDialog.querySelector('[data-action="cancel"]').addEventListener("click", () => {
  colorDialog.close();
});

// ---------- link ops ----------

let dialogCtx = null; // { groupId, linkId | null }

const iconFields = linkForm.querySelector(".icon-fields");
const customIconCheck = linkForm.elements.customIcon;
customIconCheck.addEventListener("change", () => {
  iconFields.hidden = !customIconCheck.checked;
});

// Preset swatches in the link dialog just set the color input's value.
{
  const row = document.getElementById("icon-swatches");
  PALETTE.forEach((color) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "swatch";
    b.style.background = color;
    b.title = color;
    b.addEventListener("click", () => {
      linkForm.elements.iconColor.value = color;
    });
    row.appendChild(b);
  });
}

function openLinkDialog(groupId, link) {
  dialogCtx = { groupId, linkId: link ? link.id : null };
  document.getElementById("link-dialog-title").textContent = link ? "Edit link" : "Add link";
  linkForm.elements.title.value = link ? link.title : "";
  linkForm.elements.url.value = link ? link.url : "";
  const icon = link && link.icon;
  customIconCheck.checked = Boolean(icon && icon.glyph);
  iconFields.hidden = !customIconCheck.checked;
  linkForm.elements.glyph.value = icon ? icon.glyph || "" : "";
  linkForm.elements.iconColor.value = (icon && icon.color) || "#a78bfa";
  linkDialog.showModal();
}

linkForm.addEventListener("submit", () => {
  const title = linkForm.elements.title.value.trim();
  let url = linkForm.elements.url.value.trim();
  if (!title || !url) return;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = "https://" + url;

  const glyph = linkForm.elements.glyph.value.trim();
  const icon = customIconCheck.checked && glyph
    ? { glyph, color: linkForm.elements.iconColor.value }
    : null;

  const { groupId, linkId } = dialogCtx;
  mutate((d) => {
    const g = d.groups.find((g) => g.id === groupId);
    if (!g) return;
    if (linkId) {
      const l = g.links.find((l) => l.id === linkId);
      if (!l) return;
      Object.assign(l, { title, url });
      if (icon) l.icon = icon;
      else delete l.icon;
    } else {
      const l = { id: uid("l"), title, url };
      if (icon) l.icon = icon;
      g.links.push(l);
    }
  });
});

linkForm.querySelector('[data-action="cancel"]').addEventListener("click", () => {
  linkDialog.close();
});

function deleteLink(groupId, link) {
  if (!window.confirm(`Delete “${link.title}”?`)) return;
  mutate((d) => {
    const g = d.groups.find((g) => g.id === groupId);
    if (g) g.links = g.links.filter((l) => l.id !== link.id);
  });
}

// ---------- bulk add ----------

const TITLE_MAP = {
  "apps.apple.com": "App Store",
  "appstoreconnect.apple.com": "App Store Connect",
  "github.com": "GitHub",
  "supabase.com": "Supabase",
  "dash.cloudflare.com": "Cloudflare",
  "dashboard.cloudflare.com": "Cloudflare",
  "app.pagescms.org": "Pages CMS",
  "dashboard.telemetrydeck.com": "TelemetryDeck",
  "mobbin.com": "Mobbin",
  "open.spotify.com": "Spotify",
  "news.ycombinator.com": "Hacker News",
  "claude.ai": "Claude",
  "youtube.com": "YouTube",
  "www.youtube.com": "YouTube",
  "reddit.com": "Reddit",
  "www.reddit.com": "Reddit",
};

function titleForUrl(url) {
  try {
    const host = new URL(url).hostname;
    if (TITLE_MAP[host]) return TITLE_MAP[host];
    const bare = host.replace(/^www\./, "");
    if (TITLE_MAP[bare]) return TITLE_MAP[bare];
    // Second-level domain, capitalized: dash.cloudflare.com → Cloudflare
    const parts = bare.split(".");
    const name = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
    return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    return url;
  }
}

function looksLikeUrl(line) {
  if (/^https?:\/\//i.test(line)) return true;
  return !line.includes(" ") && /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(line);
}

document.getElementById("bulk-add").addEventListener("click", () => {
  bulkForm.elements.text.value = "";
  bulkDialog.showModal();
});

bulkForm.addEventListener("submit", () => {
  const lines = bulkForm.elements.text.value
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return;

  mutate((d) => {
    let group = null;
    const usedTitles = new Map(); // per-group title → count, for "Supabase 2" dedupe
    const seeded = new Set(); // group ids whose existing titles are already counted

    const groupFor = (name) => {
      const existing = d.groups.find(
        (g) => g.name.toLowerCase() === name.toLowerCase(),
      );
      const g = existing || { id: uid("g"), name, links: [] };
      if (!existing) d.groups.push(g);
      // Seed the dedupe counter with the group's existing titles so a second
      // "Supabase" pasted into a group that already has one becomes "Supabase 2".
      if (!seeded.has(g.id)) {
        seeded.add(g.id);
        for (const l of g.links) {
          const key = g.id + " " + l.title.replace(/ \d+$/, "");
          usedTitles.set(key, (usedTitles.get(key) || 0) + 1);
        }
      }
      return g;
    };

    for (const line of lines) {
      if (!looksLikeUrl(line)) {
        group = groupFor(line);
        continue;
      }
      if (!group) group = groupFor("Imported");
      const url = /^https?:\/\//i.test(line) ? line : "https://" + line;
      let title = titleForUrl(url);
      const key = group.id + " " + title;
      const n = (usedTitles.get(key) || 0) + 1;
      usedTitles.set(key, n);
      if (n > 1) title += " " + n;
      group.links.push({ id: uid("l"), title, url });
    }
  });
});

bulkForm.querySelector('[data-action="cancel"]').addEventListener("click", () => {
  bulkDialog.close();
});

// ---------- drag and drop ----------

let dragState = null; // { linkId, fromGroupId }

// A single placeholder box that moves to the insertion point while dragging,
// so you can see exactly where the card will land.
const dropGhost = document.createElement("div");
dropGhost.className = "drop-ghost";

function removeDropGhost() {
  dropGhost.remove();
}

function findDropTarget(cardsEl, x, y) {
  const cards = [...cardsEl.querySelectorAll(".card:not(.dragging)")];
  for (const card of cards) {
    const r = card.getBoundingClientRect();
    if (y < r.top || y > r.bottom) continue;
    const before = x < r.left + r.width / 2;
    return { card, before };
  }
  return { card: null, before: false };
}

function positionDropGhost(cardsEl, x, y) {
  const { card, before } = findDropTarget(cardsEl, x, y);
  let anchor;
  if (card) {
    anchor = before ? card : card.nextElementSibling;
  } else {
    anchor = cardsEl.querySelector(".card-add"); // append at end
  }
  if (anchor === dropGhost || anchor === dropGhost.nextElementSibling) return;
  cardsEl.insertBefore(dropGhost, anchor);
}

function wireDropZone(cardsEl) {
  cardsEl.addEventListener("dragover", (e) => {
    if (!dragState) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    positionDropGhost(cardsEl, e.clientX, e.clientY);
  });

  cardsEl.addEventListener("dragleave", (e) => {
    // Only clear when actually leaving this container (not entering a child)
    if (e.relatedTarget && cardsEl.contains(e.relatedTarget)) return;
    if (dropGhost.parentElement === cardsEl) removeDropGhost();
  });

  cardsEl.addEventListener("drop", (e) => {
    if (!dragState) return;
    e.preventDefault();
    // The ghost's position in the DOM is exactly where the card should land.
    let next = dropGhost.parentElement === cardsEl ? dropGhost.nextElementSibling : null;
    if (next && next.classList.contains("dragging")) next = next.nextElementSibling;
    const beforeLinkId = next && next.classList.contains("card") ? next.dataset.linkId : null;
    const toGroupId = cardsEl.dataset.groupId;
    const { linkId, fromGroupId } = dragState;
    removeDropGhost();

    mutate((d) => {
      const from = d.groups.find((g) => g.id === fromGroupId);
      const to = d.groups.find((g) => g.id === toGroupId);
      if (!from || !to) return;
      const i = from.links.findIndex((l) => l.id === linkId);
      if (i < 0) return;
      const [link] = from.links.splice(i, 1);

      let j = beforeLinkId ? to.links.findIndex((l) => l.id === beforeLinkId) : -1;
      if (j < 0) j = to.links.length;
      to.links.splice(j, 0, link);
    });
  });
}

// ---------- filter ----------

function fuzzyMatch(needle, haystack) {
  let i = 0;
  for (const ch of haystack) {
    if (ch === needle[i]) i++;
    if (i === needle.length) return true;
  }
  return needle.length === 0;
}

function applyFilter() {
  const q = filterInput.value.trim().toLowerCase();
  let first = null;
  document.querySelectorAll(".card").forEach((card) => {
    card.classList.remove("first-match");
    const hit = !q || fuzzyMatch(q, card.dataset.search);
    card.classList.toggle("filtered-out", !hit);
    if (hit && q && !first) first = card;
  });
  if (first) first.classList.add("first-match");
  document.querySelectorAll(".group").forEach((group) => {
    const any = group.querySelector(".card:not(.filtered-out)");
    group.classList.toggle("filtered-out", Boolean(q) && !any);
  });
}

filterInput.addEventListener("input", applyFilter);

filterInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const first = document.querySelector(".card.first-match a");
    if (first) window.location.href = first.href;
  } else if (e.key === "Escape") {
    filterInput.value = "";
    applyFilter();
    filterInput.blur();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "/") return;
  const t = e.target;
  if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t.isContentEditable) return;
  e.preventDefault();
  filterInput.focus();
  filterInput.select();
});

// ---------- export / import ----------

document.getElementById("export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `startpage-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

const importFile = document.getElementById("import-file");
document.getElementById("import").addEventListener("click", () => importFile.click());
importFile.addEventListener("change", async () => {
  const file = importFile.files[0];
  importFile.value = "";
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (!parsed || !Array.isArray(parsed.groups)) throw new Error("missing groups array");
    if (!window.confirm(`Replace everything with “${file.name}” (${parsed.groups.length} groups)?`)) return;
    mutate((d) => {
      d.version = parsed.version ?? 1;
      d.groups = parsed.groups;
    });
  } catch (err) {
    window.alert("Import failed: " + err.message);
  }
});

// ---------- init ----------

applyAppearance();
render();
updateStatusDot();
pullAndReconcile();
