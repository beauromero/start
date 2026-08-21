"use strict";

const LS_DATA = "startpage:data";
const LS_DIRTY = "startpage:dirty";
const LS_SECRET = "startpage:secret";
const LS_THEME = "startpage:theme";
const LS_LAYOUT = "startpage:layout";
const LS_DENSITY = "startpage:density";
const LS_MODE = "startpage:mode";
const LS_ADDLINK = "startpage:addlink";
const LS_SEARCH = "startpage:search";
const LS_MOMENTUM = "startpage:momentum";
const LS_QUOTE = "startpage:quote";
const LS_BASEREV = "startpage:baserev";
const LS_STYLESYNC = "startpage:stylesync";
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
const searchToggle = document.getElementById("search-toggle");
const addLinkCheck = document.getElementById("addlink-toggle");
const loadDefaultBtn = document.getElementById("load-default");
const saveDefaultBtn = document.getElementById("save-default");
const styleSyncCheck = document.getElementById("stylesync-toggle");

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

// The updatedAt this window's copy was last reconciled against the server at.
// Sent as X-Base-Rev on every push; a mismatch means another window pushed in
// between, and the server answers 409 with its copy so we can merge instead of
// clobbering it.
function getBaseRev() {
  return localStorage.getItem(LS_BASEREV) || "";
}

function setBaseRev(rev) {
  if (rev) localStorage.setItem(LS_BASEREV, rev);
  else localStorage.removeItem(LS_BASEREV);
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
// Style settings live in localStorage per device by default, but the "Sync
// style across devices" toggle mirrors them through the synced blob
// (data.style) — see the style-sync section below. Light/dark mode always
// stays per-device. The inline head script migrates legacy combined values
// (bold-tight, trello-h) before this code runs, so plain reads are safe here.

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
  const addLink = localStorage.getItem(LS_ADDLINK) !== "hidden";
  const search = localStorage.getItem(LS_SEARCH) !== "hidden";
  const el = document.documentElement;
  el.dataset.theme = theme;
  el.dataset.layout = layout;
  el.dataset.density = density;
  el.dataset.addlink = addLink ? "shown" : "hidden";
  el.dataset.search = search ? "shown" : "hidden";
  el.dataset.mode = mode === "system" ? (lightQuery.matches ? "light" : "dark") : mode;
  searchToggle.textContent = search ? "Hide search bar" : "Show search bar";
  themeSelect.value = theme;
  layoutSelect.value = layout;
  densitySelect.value = density;
  addLinkCheck.checked = addLink;
  modeToggle.textContent = MODE_ICONS[mode] + " Appearance: " + mode;
  modeToggle.title = "Cycles system → light → dark";
  updateMomentum();
}

document.getElementById("style-btn").addEventListener("click", () => {
  loadDefaultBtn.disabled = !data.defaultView;
  styleSyncCheck.checked = styleSyncOn();
  styleDialog.showModal();
});

// ---------- style sync ----------
// Opt-in per device: when on, the five style settings (theme, layout, density,
// add-link, search bar) mirror data.style in the synced blob. Any change made
// while on publishes; any pull that brings a different data.style applies it.
// Turning it on adopts the existing synced style if there is one, otherwise
// seeds it from this device. Mode (light/dark/system) stays per-device.

function styleSyncOn() {
  return localStorage.getItem(LS_STYLESYNC) === "1";
}

function currentStyle() {
  return {
    theme: localStorage.getItem(LS_THEME) || "bold",
    layout: localStorage.getItem(LS_LAYOUT) || "vertical",
    density: localStorage.getItem(LS_DENSITY) || "comfortable",
    addLink: localStorage.getItem(LS_ADDLINK) !== "hidden",
    search: localStorage.getItem(LS_SEARCH) !== "hidden",
  };
}

function writeStyleToLocal(s) {
  if (s.theme) localStorage.setItem(LS_THEME, s.theme);
  if (s.layout) localStorage.setItem(LS_LAYOUT, s.layout);
  if (s.density) localStorage.setItem(LS_DENSITY, s.density);
  localStorage.setItem(LS_ADDLINK, s.addLink === false ? "hidden" : "shown");
  localStorage.setItem(LS_SEARCH, s.search === false ? "hidden" : "shown");
}

function publishStyle() {
  if (!styleSyncOn()) return;
  mutate((d) => { d.style = currentStyle(); });
}

function applySyncedStyle() {
  if (!styleSyncOn() || !data.style) return;
  if (JSON.stringify(data.style) === JSON.stringify(currentStyle())) return;
  writeStyleToLocal(data.style);
  applyFilterOnSearchHide();
  applyAppearance(); // also refreshes the dialog controls if it's open
}

// Hiding the search bar clears any active filter so no links stay invisibly
// filtered out (same rule as the manual toggle below).
function applyFilterOnSearchHide() {
  if (localStorage.getItem(LS_SEARCH) === "hidden" && filterInput.value) {
    filterInput.value = "";
    applyFilter();
  }
}

styleSyncCheck.addEventListener("change", () => {
  if (styleSyncCheck.checked) {
    localStorage.setItem(LS_STYLESYNC, "1");
    if (data.style) applySyncedStyle();
    else publishStyle();
  } else {
    localStorage.removeItem(LS_STYLESYNC);
  }
  updateMomentum(); // the toggle also switches the photo pin/rotation scope
});

// ---------- default view ----------
// The style settings are per-device, but "Save as default view" snapshots them
// into the synced blob (data.defaultView) so any other device can pull the
// same look with one click. Loading just writes localStorage — no sync write.

saveDefaultBtn.addEventListener("click", () => {
  mutate((d) => {
    d.defaultView = {
      theme: localStorage.getItem(LS_THEME) || "bold",
      layout: localStorage.getItem(LS_LAYOUT) || "vertical",
      density: localStorage.getItem(LS_DENSITY) || "comfortable",
      addLink: localStorage.getItem(LS_ADDLINK) !== "hidden",
    };
  });
  loadDefaultBtn.disabled = false;
  saveDefaultBtn.textContent = "Saved ✓";
  setTimeout(() => { saveDefaultBtn.textContent = "Save as default view"; }, 1200);
});

loadDefaultBtn.addEventListener("click", () => {
  const v = data.defaultView;
  if (!v) return;
  if (v.theme) localStorage.setItem(LS_THEME, v.theme);
  if (v.layout) localStorage.setItem(LS_LAYOUT, v.layout);
  if (v.density) localStorage.setItem(LS_DENSITY, v.density);
  localStorage.setItem(LS_ADDLINK, v.addLink === false ? "hidden" : "shown");
  applyAppearance();
});

// ---------- menus ----------
// The topbar ⋯ menu is static markup toggled in place; group ⋯ menus are built
// on demand and float over the board (fixed position, so they escape the
// scrolling/overflow containers of the columns and rows layouts). Both close on
// outside click, Escape, or scroll.

const topbarMenu = document.getElementById("topbar-menu");
const topbarMenuBtn = document.getElementById("topbar-menu-btn");

let openMenu = null; // floating group menu element
let openMenuAnchor = null;

function closeMenus() {
  if (openMenu) {
    openMenu.remove();
    openMenuAnchor.classList.remove("menu-open");
    openMenu = null;
    openMenuAnchor = null;
  }
  topbarMenu.hidden = true;
}

function showMenu(anchor, items) {
  if (openMenuAnchor === anchor) {
    closeMenus();
    return;
  }
  closeMenus();
  const menu = document.createElement("div");
  menu.className = "menu floating";
  for (const item of items) {
    if (item === "-") {
      menu.appendChild(document.createElement("hr"));
      continue;
    }
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = item.label;
    if (item.danger) b.className = "danger";
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      closeMenus();
      item.action();
    });
    menu.appendChild(b);
  }
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.top = Math.min(r.bottom + 6, innerHeight - menu.offsetHeight - 8) + "px";
  menu.style.left = Math.max(8, Math.min(r.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 8)) + "px";
  openMenu = menu;
  openMenuAnchor = anchor;
  anchor.classList.add("menu-open");
}

topbarMenuBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  const wasOpen = !topbarMenu.hidden;
  closeMenus();
  topbarMenu.hidden = wasOpen;
});

topbarMenu.addEventListener("click", (e) => {
  e.stopPropagation();
  // Mode toggle cycles in place; every other item closes the menu.
  if (e.target.closest("button") && e.target.id !== "mode-toggle") topbarMenu.hidden = true;
});

document.addEventListener("click", closeMenus);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeMenus();
});
window.addEventListener("scroll", closeMenus, true);

// Changes apply live while the dialog is open
themeSelect.addEventListener("change", () => {
  localStorage.setItem(LS_THEME, themeSelect.value);
  applyAppearance();
  publishStyle();
});
layoutSelect.addEventListener("change", () => {
  localStorage.setItem(LS_LAYOUT, layoutSelect.value);
  applyAppearance();
  publishStyle();
});
densitySelect.addEventListener("change", () => {
  localStorage.setItem(LS_DENSITY, densitySelect.value);
  applyAppearance();
  publishStyle();
});
addLinkCheck.addEventListener("change", () => {
  localStorage.setItem(LS_ADDLINK, addLinkCheck.checked ? "shown" : "hidden");
  applyAppearance();
  publishStyle();
});

modeToggle.addEventListener("click", () => {
  const next = MODES[(MODES.indexOf(getMode()) + 1) % MODES.length];
  localStorage.setItem(LS_MODE, next);
  applyAppearance();
});

// Hiding the search bar clears any active filter so no links stay invisibly
// filtered out. Pressing / still works while hidden (reveals until blur).
searchToggle.addEventListener("click", () => {
  const hidden = localStorage.getItem(LS_SEARCH) === "hidden";
  localStorage.setItem(LS_SEARCH, hidden ? "shown" : "hidden");
  if (!hidden) {
    filterInput.value = "";
    applyFilter();
  }
  applyAppearance();
  publishStyle();
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
const momentumShuffle = document.getElementById("momentum-shuffle");
const momentumPin = document.getElementById("momentum-pin");
const momentumDialog = document.getElementById("momentum-dialog");
const momentumThumbs = document.getElementById("momentum-thumbs");
const momentumClockCheck = document.getElementById("momentum-show-clock");
const momentumGreetingCheck = document.getElementById("momentum-show-greeting");
const momentumQuoteEl = document.getElementById("momentum-quote");
const momentumQuoteCheck = document.getElementById("momentum-show-quote");

// The photo choice (pin + rotation offset) follows the "Sync style across
// devices" toggle: sync on reads/writes the synced blob (data.momentum, pin
// keyed by the stable "photo-…" URL segment since indices would break if the
// curated list is edited), so every device shows the same photo; sync off
// reads/writes localStorage only. "offset" shifts which pool photo today lands
// on (set by shuffle, so rotation carries on from the new photo tomorrow);
// "pinned" freezes one photo. Favorites always sync — they're curation, like
// the links — and when any exist they become the rotation/shuffle pool.
// Clock/greeting/quote visibility stays per-device.
function momentumPref() {
  try { return JSON.parse(localStorage.getItem(LS_MOMENTUM)) || {}; } catch { return {}; }
}

function saveMomentumPref(pref) {
  localStorage.setItem(LS_MOMENTUM, JSON.stringify(pref));
}

function momentumDay() {
  return Math.floor(Date.now() / 86400000);
}

function momentumPhotoId(url) {
  return url.split("/").pop().split("?")[0]; // "photo-1506905925346-21bda4d32df4"
}

function momentumSynced() {
  return (data && data.momentum) || {};
}

// Rotation pool: favorite photos when any are set (and still exist), else all.
function momentumPool() {
  const favs = momentumSynced().favorites;
  const idx = (Array.isArray(favs) ? favs : [])
    .map((id) => MOMENTUM_PHOTOS.findIndex((u) => momentumPhotoId(u) === id))
    .filter((i) => i >= 0);
  return idx.length ? idx : MOMENTUM_PHOTOS.map((_, i) => i);
}

function momentumIndex() {
  const n = MOMENTUM_PHOTOS.length;
  const pool = momentumPool();
  if (styleSyncOn()) {
    const s = momentumSynced();
    if (s.pinned) {
      const i = MOMENTUM_PHOTOS.findIndex((u) => momentumPhotoId(u) === s.pinned);
      if (i >= 0) return i;
    }
    return pool[(momentumDay() + (s.offset || 0)) % pool.length];
  }
  const pref = momentumPref();
  if (Number.isInteger(pref.pinned)) return ((pref.pinned % n) + n) % n;
  return pool[(momentumDay() + (pref.offset || 0)) % pool.length];
}

// The offset that makes today's rotation land on pool photo `next`, so daily
// changes carry on from it tomorrow.
function momentumOffsetFor(next) {
  const pool = momentumPool();
  const pos = Math.max(0, pool.indexOf(next));
  return ((pos - momentumDay()) % pool.length + pool.length) % pool.length;
}

// Write the synced momentum object, dropping it entirely when back to defaults.
function mutateMomentum(fn) {
  mutate((d) => {
    const m = d.momentum || (d.momentum = {});
    fn(m);
    if (!m.offset) delete m.offset; // 0 ≡ default rotation
    if (!m.pinned && m.offset == null && !(Array.isArray(m.favorites) && m.favorites.length)) {
      delete d.momentum;
    }
  });
}

// Show photo `next`: keep it pinned if a pin is active (a shuffle or thumbnail
// click while pinned shouldn't silently unpin), otherwise fold it into the
// rotation offset — in whichever scope the style-sync toggle selects.
function momentumShow(next) {
  if (styleSyncOn()) {
    mutateMomentum((m) => {
      if (m.pinned) m.pinned = momentumPhotoId(MOMENTUM_PHOTOS[next]);
      else m.offset = momentumOffsetFor(next);
    });
  } else {
    const pref = momentumPref();
    if (Number.isInteger(pref.pinned)) pref.pinned = next;
    else pref.offset = momentumOffsetFor(next);
    saveMomentumPref(pref);
  }
  updateMomentum();
}

momentumShuffle.addEventListener("click", () => {
  const choices = momentumPool().filter((i) => i !== momentumIndex());
  if (!choices.length) return;
  momentumShow(choices[Math.floor(Math.random() * choices.length)]);
});

// Unpinning folds the pinned photo into the rotation offset so today's photo
// doesn't change; daily rotation resumes tomorrow.
momentumPin.addEventListener("click", () => {
  const current = momentumIndex();
  if (styleSyncOn()) {
    mutateMomentum((m) => {
      if (m.pinned) {
        m.offset = momentumOffsetFor(current);
        delete m.pinned;
      } else {
        m.pinned = momentumPhotoId(MOMENTUM_PHOTOS[current]);
      }
    });
  } else {
    const pref = momentumPref();
    if (Number.isInteger(pref.pinned)) {
      pref.offset = momentumOffsetFor(current);
      delete pref.pinned;
    } else {
      pref.pinned = current;
    }
    saveMomentumPref(pref);
  }
  updateMomentum();
});

// ----- the ⚙ settings panel -----

function momentumThumbUrl(url) {
  return url.replace("w=1920", "w=320");
}

function refreshMomentumPanel() {
  const synced = momentumSynced();
  const favs = Array.isArray(synced.favorites) ? synced.favorites : [];
  const current = momentumIndex();

  momentumThumbs.textContent = "";
  MOMENTUM_PHOTOS.forEach((url, i) => {
    const id = momentumPhotoId(url);
    const thumb = document.createElement("div");
    thumb.className = "momentum-thumb" + (i === current ? " current" : "");
    thumb.style.backgroundImage = `url("${momentumThumbUrl(url)}")`;
    thumb.title = "Show this photo now";
    thumb.addEventListener("click", () => {
      momentumShow(i);
      refreshMomentumPanel();
    });

    const fav = document.createElement("button");
    fav.type = "button";
    fav.className = "momentum-fav" + (favs.includes(id) ? " faved" : "");
    fav.textContent = favs.includes(id) ? "★" : "☆";
    fav.title = favs.includes(id) ? "Remove from favorites" : "Add to favorites";
    fav.addEventListener("click", (e) => {
      e.stopPropagation();
      mutate((d) => {
        const m = d.momentum || (d.momentum = {});
        const list = Array.isArray(m.favorites) ? m.favorites : (m.favorites = []);
        const j = list.indexOf(id);
        if (j >= 0) list.splice(j, 1); else list.push(id);
        if (!list.length) delete m.favorites;
        if (!m.pinned && !m.favorites) delete d.momentum;
      });
      updateMomentum();
      refreshMomentumPanel();
    });
    thumb.appendChild(fav);
    momentumThumbs.appendChild(thumb);
  });

  const pref = momentumPref();
  momentumClockCheck.checked = pref.showClock !== false;
  momentumGreetingCheck.checked = pref.showGreeting !== false;
  momentumQuoteCheck.checked = pref.showQuote !== false;
}

document.getElementById("momentum-settings").addEventListener("click", () => {
  refreshMomentumPanel();
  momentumDialog.showModal();
});

// ----- daily quote -----
// DummyJSON's quote set: 1454 real quotes with stable ids and CORS enabled, no
// key. Picking the id from the day number means every device shows the same
// quote all day without syncing anything — and one fetch per day, cached in
// localStorage. (quotable.io is dead — expired cert — and zenquotes.io sends
// no CORS headers, so browsers can't call it; both were checked and rejected.)
const QUOTE_API = "https://dummyjson.com/quotes/";
const QUOTE_API_COUNT = 1454;

// Offline / API-down fallback, rotated by the same day number.
const FALLBACK_QUOTES = [
  ["The best way to get started is to quit talking and begin doing.", "Walt Disney"],
  ["It always seems impossible until it's done.", "Nelson Mandela"],
  ["Well begun is half done.", "Aristotle"],
  ["What you do today can improve all your tomorrows.", "Ralph Marston"],
  ["Simplicity is the ultimate sophistication.", "Leonardo da Vinci"],
  ["Action is the foundational key to all success.", "Pablo Picasso"],
  ["The obstacle is the way.", "Marcus Aurelius"],
  ["Whether you think you can or you think you can't, you're right.", "Henry Ford"],
  ["The secret of getting ahead is getting started.", "Mark Twain"],
  ["We are what we repeatedly do. Excellence, then, is not an act, but a habit.", "Will Durant"],
  ["Make each day your masterpiece.", "John Wooden"],
  ["How we spend our days is, of course, how we spend our lives.", "Annie Dillard"],
];

let quoteFetchState = null; // "loading" | "failed" (failed = don't retry until reload)

// ~10% of the DummyJSON set is broken Title Case ("You'Ve Stood Up…"); detect
// mostly-capitalized quotes and rewrite them in sentence case. Proper nouns
// inside those few quotes lose their caps — better than every word shouting.
function normalizeQuote(text) {
  const eligible = text.split(" ").filter((w) => w.length > 3);
  const caps = eligible.filter((w) => /^[A-Z]/.test(w)).length;
  if (!eligible.length || caps <= eligible.length * 0.7) return text;
  return text.toLowerCase()
    .replace(/(^|[.!?]\s+)([a-z])/g, (m, p, c) => p + c.toUpperCase())
    .replace(/\bi\b/g, "I");
}

function renderMomentumQuote(text, author) {
  momentumQuoteEl.textContent = "";
  momentumQuoteEl.append(`“${text}”`);
  if (author) {
    const a = document.createElement("span");
    a.className = "momentum-quote-author";
    a.textContent = " — " + author;
    momentumQuoteEl.appendChild(a);
  }
}

function ensureMomentumQuote() {
  const day = momentumDay();
  try {
    const cached = JSON.parse(localStorage.getItem(LS_QUOTE));
    if (cached && cached.day === day && cached.text) {
      renderMomentumQuote(cached.text, cached.author);
      return;
    }
  } catch {}

  // Fallback renders immediately; a successful fetch swaps it out.
  const [ft, fa] = FALLBACK_QUOTES[day % FALLBACK_QUOTES.length];
  renderMomentumQuote(ft, fa);
  if (quoteFetchState) return;

  quoteFetchState = "loading";
  fetch(QUOTE_API + ((day % QUOTE_API_COUNT) + 1))
    .then((r) => {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then((q) => {
      if (!q || !q.quote) throw new Error("bad payload");
      const text = normalizeQuote(q.quote);
      localStorage.setItem(LS_QUOTE, JSON.stringify({ day, text, author: q.author || "" }));
      quoteFetchState = null;
      renderMomentumQuote(text, q.author);
    })
    .catch(() => {
      quoteFetchState = "failed"; // fallback quote is already showing
    });
}

for (const [check, key] of [[momentumClockCheck, "showClock"], [momentumGreetingCheck, "showGreeting"], [momentumQuoteCheck, "showQuote"]]) {
  check.addEventListener("change", () => {
    const pref = momentumPref();
    pref[key] = check.checked;
    saveMomentumPref(pref);
    updateMomentum();
  });
}

function updateMomentum() {
  const active = document.documentElement.dataset.theme === "momentum";
  momentumHero.hidden = !active;
  if (!active) {
    document.body.style.removeProperty("--momentum-image");
    return;
  }
  const url = MOMENTUM_PHOTOS[momentumIndex()];
  document.body.style.setProperty("--momentum-image", `url("${url}")`);

  const pref = momentumPref();
  const synced = styleSyncOn();
  const pinned = synced ? Boolean(momentumSynced().pinned) : Number.isInteger(pref.pinned);
  const scope = synced ? "every device" : "this device";
  momentumPin.classList.toggle("active", pinned);
  momentumPin.title = pinned
    ? `Background pinned on ${scope} — click to resume rotation`
    : `Pin this background on ${scope}`;

  momentumClock.hidden = pref.showClock === false;
  momentumGreeting.hidden = pref.showGreeting === false;
  momentumQuoteEl.hidden = pref.showQuote === false;
  if (!momentumQuoteEl.hidden) ensureMomentumQuote();

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

// Union-by-id merge for when both sides changed. Local wins for anything that
// exists on both sides (it's this window's current intent); groups/links that
// only exist on the server (added in another window) are appended rather than
// dropped. Tradeoff: a link deleted here while another window still had it can
// come back once — deleting again sticks. That beats silently losing adds.
function mergeData(local, server) {
  const merged = structuredClone(local);
  const groupsById = new Map(merged.groups.map((g) => [g.id, g]));
  for (const sg of server.groups) {
    const lg = groupsById.get(sg.id);
    if (!lg) {
      merged.groups.push(structuredClone(sg));
      continue;
    }
    const linkIds = new Set(lg.links.map((l) => l.id));
    for (const sl of sg.links) {
      if (!linkIds.has(sl.id)) lg.links.push(structuredClone(sl));
    }
  }
  return merged;
}

async function push(interactive, attempt = 0) {
  const secret = getSecret(interactive);
  if (!secret) return; // stay dirty; will retry on next user edit

  try {
    const res = await fetch(API, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Sync-Secret": secret,
        "X-Base-Rev": getBaseRev(),
      },
      body: JSON.stringify(data),
    });
    if (res.status === 401) {
      localStorage.removeItem(LS_SECRET);
      updateStatusDot("error");
      syncStatus.title = "Wrong sync secret — edit anything to be re-prompted";
      return;
    }
    if (res.status === 409) {
      // Another window pushed since we last reconciled. Merge its copy into
      // ours and retry on top of it.
      if (attempt >= 3) throw new Error("sync conflict persisted after retries");
      const server = await res.json();
      if (server && Array.isArray(server.groups)) {
        data = mergeData(data, server);
        data.updatedAt = new Date().toISOString();
        saveLocal();
        setBaseRev(server.updatedAt || "");
        render();
        updateMomentum();
        applySyncedStyle();
      }
      return push(interactive, attempt + 1);
    }
    if (!res.ok) throw new Error("HTTP " + res.status);
    setBaseRev(data.updatedAt || "");
    setDirty(false);
  } catch (err) {
    updateStatusDot("error");
    syncStatus.title = "Sync failed: " + err.message;
  }
}

function anyDialogOpen() {
  return Boolean(document.querySelector("dialog[open]"));
}

let pendingPull = false;

async function pullAndReconcile() {
  lastPullAt = Date.now();
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
      // Don't yank the UI out from under an open edit dialog; re-pull on close.
      if (anyDialogOpen()) {
        pendingPull = true;
        return;
      }
      if (isDirty()) {
        // Both sides changed: merge instead of letting either side clobber
        data = mergeData(data, server);
        data.updatedAt = new Date().toISOString();
        saveLocal();
        setBaseRev(serverAt);
        schedulePush(false);
      } else {
        data = server;
        saveLocal();
        setBaseRev(serverAt);
        setDirty(false);
      }
      render();
      updateMomentum(); // synced momentum pin/favorites may have changed
      applySyncedStyle();
    } else if (localAt > serverAt || isDirty()) {
      setBaseRev(serverAt);
      schedulePush(false);
    } else {
      setBaseRev(serverAt);
      setDirty(false);
    }
  } catch (err) {
    updateStatusDot("error");
    syncStatus.title = "Couldn't reach sync API: " + err.message;
  }
}

// Re-pull whenever this window comes back into view, so a long-open tab
// refreshes itself before you edit in it. Throttled since focus and
// visibilitychange often fire together.
let lastPullAt = 0;

function pullIfStale() {
  if (Date.now() - lastPullAt < 3000) return;
  pullAndReconcile();
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") pullIfStale();
});
window.addEventListener("focus", pullIfStale);

// A failed offline edit stays marked dirty. Retry it as soon as the browser
// reports connectivity again, even if this tab never lost focus; otherwise a
// clean tab pulls immediately to reconcile changes made elsewhere.
window.addEventListener("online", () => {
  clearTimeout(pushTimer);
  pushTimer = null;
  if (isDirty()) push(false);
  else pullAndReconcile();
});

// Same-profile windows share localStorage, so they can sync instantly through
// the storage event without a network round-trip. (Other Chrome profiles have
// separate localStorage and rely on the focus pull above.)
window.addEventListener("storage", (e) => {
  if (e.key !== LS_DATA || !e.newValue) return;
  let incoming;
  try { incoming = JSON.parse(e.newValue); } catch { return; }
  if (!incoming || !Array.isArray(incoming.groups)) return;
  if ((incoming.updatedAt || "") <= (data.updatedAt || "")) return;
  if (anyDialogOpen()) {
    pendingPull = true;
    return;
  }
  data = incoming;
  render();
  updateMomentum();
  applySyncedStyle();
});

// ---------- rendering ----------

function uid(prefix) {
  return prefix + "-" + crypto.randomUUID().slice(0, 8);
}

// The /api/icon resolver checks real HTTP statuses server-side (see
// functions/api/icon.js); if it comes up empty, the browser itself tries the
// site's /favicon.ico — that request carries the user's cookies and bot-wall
// clearance, so it can succeed where server-side fetches are blocked.
function faviconChain(url) {
  try {
    const u = new URL(url);
    return [
      `/api/icon?url=${encodeURIComponent(url)}`,
      `${u.origin}/favicon.ico`,
    ];
  } catch {
    return [];
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

  // The header is the drag handle for reordering whole groups — cards stay
  // draggable inside without nested-target ambiguity.
  header.draggable = true;
  header.addEventListener("dragstart", (e) => {
    if (e.target instanceof HTMLInputElement) {
      e.preventDefault(); // renaming — leave text selection drags alone
      return;
    }
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", group.id);
    const r = section.getBoundingClientRect();
    e.dataTransfer.setDragImage(section, e.clientX - r.left, e.clientY - r.top);
    section.classList.add("dragging");
    setTimeout(() => {
      if (groupDragState) section.classList.add("drag-hidden");
    }, 0);
    groupDragState = { groupId: group.id };
  });
  header.addEventListener("dragend", () => {
    section.classList.remove("dragging", "drag-hidden");
    groupDragState = null;
    groupGhost.remove();
  });

  const controls = document.createElement("div");
  controls.className = "group-controls";
  const menuBtn = iconBtn("⋯", "Group options", () => {
    showMenu(menuBtn, [
      { label: "+ Add link", action: () => openLinkDialog(group.id, null) },
      { label: "● Color…", action: () => openColorDialog(group) },
      "-",
      { label: "◂ Move left", action: () => moveGroup(group.id, -1) },
      { label: "▸ Move right", action: () => moveGroup(group.id, 1) },
      "-",
      { label: "✕ Delete group…", action: () => deleteGroup(group), danger: true },
    ]);
  });
  controls.appendChild(menuBtn);
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
    const chain = faviconChain(link.url);
    if (chain.length) {
      const img = document.createElement("img");
      img.className = "card-favicon";
      img.alt = "";
      let step = 0;
      img.addEventListener("error", () => {
        step += 1;
        if (step < chain.length) img.src = chain[step];
        else img.replaceWith(letterTile(link.title));
      });
      img.src = chain[0];
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

// Built-in icon set: basic shapes and common symbols, stored in the glyph field
// as a ":name:" token so the data model, sync, and bulk edit stay unchanged.
// Stroke-based 24×24 paths (Feather-style).
const ICONS = {
  circle: '<circle cx="12" cy="12" r="8"/>',
  square: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
  triangle: '<path d="M12 4.5 20.5 19.5H3.5z"/>',
  diamond: '<path d="M12 3l8 9-8 9-8-9z"/>',
  star: '<path d="M12 3l2.7 5.8 6.3.8-4.6 4.4 1.2 6.2-5.6-3.1-5.6 3.1 1.2-6.2L3 9.6l6.3-.8z"/>',
  heart: '<path d="M12 20S3.5 14.7 2.6 9.9C2 6.6 4.3 4.5 6.9 4.5c2 0 3.6 1 5.1 3 1.5-2 3.1-3 5.1-3 2.6 0 4.9 2.1 4.3 5.4C20.5 14.7 12 20 12 20z"/>',
  bolt: '<path d="M13 2 4 14h7l-2 8 9-12h-7z"/>',
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 9.5V21h14V9.5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a13.5 13.5 0 010 18M12 3a13.5 13.5 0 000 18"/>',
  code: '<path d="M8 6l-6 6 6 6M16 6l6 6-6 6"/>',
  terminal: '<path d="M4 6l6 6-6 6M13 18h8"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  chat: '<path d="M21 11.5a8.5 8.5 0 01-8.5 8.5H3l2.4-3.1A8.5 8.5 0 1121 11.5z"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  camera: '<path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/>',
  folder: '<path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>',
  chart: '<path d="M18 20V10M12 20V4M6 20v-6"/>',
  cart: '<circle cx="9" cy="21" r="1.5"/><circle cx="19" cy="21" r="1.5"/><path d="M1 1h4l2.7 13.4a2 2 0 002 1.6h9.7a2 2 0 002-1.6L23 6H6"/>',
  gear: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/>',
  doc: '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/>',
  play: '<path d="M7 4l13 8-13 8z"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
};

const ICON_TOKEN = /^:([a-z0-9-]+):$/;

function iconSvg(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

// Roughly: does the glyph start with a character outside basic Latin? Then treat
// it as an emoji (no colored background, larger size). A ":name:" token from the
// built-in set renders as an SVG on the colored tile instead.
function glyphTile(icon) {
  const tile = document.createElement("span");
  const m = ICON_TOKEN.exec(icon.glyph);
  if (m && ICONS[m[1]]) {
    tile.className = "card-tile icon";
    tile.innerHTML = iconSvg(m[1]);
    if (icon.color) tile.style.setProperty("--tile-color", icon.color);
    return tile;
  }
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
    // stopPropagation keeps this click from the document-level menu closer, so
    // close open menus here — unless this button's own menu is open, in which
    // case showMenu's toggle handles it.
    if (openMenuAnchor !== btn) closeMenus();
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

// Clicking the backdrop dismisses an edit dialog, but only when tryDismiss
// decides there's nothing unsaved to lose. A native dialog's backdrop click
// reports the dialog itself as the target with coordinates outside its box;
// requiring the pointer to also go *down* outside keeps a text-selection drag
// that ends on the backdrop from closing the dialog.
function wireBackdropDismiss(dialog, tryDismiss) {
  const outside = (e) => {
    const r = dialog.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };
  let downOutside = false;
  dialog.addEventListener("pointerdown", (e) => {
    downOutside = e.target === dialog && outside(e);
  });
  dialog.addEventListener("click", (e) => {
    if (downOutside && e.target === dialog && outside(e)) tryDismiss();
    downOutside = false;
  });
}

let dialogCtx = null; // { groupId, linkId | null }
let linkDialogOpened = null; // form snapshot at open, for backdrop dismiss

const iconFields = linkForm.querySelector(".icon-fields");
const customIconCheck = linkForm.elements.customIcon;
customIconCheck.addEventListener("change", () => {
  iconFields.hidden = !customIconCheck.checked;
});

// Icon grid in the link dialog: clicking a built-in icon writes its ":name:"
// token into the glyph field (the single source of truth); clicking again
// clears it. Typing an emoji/letters just deselects the grid.
const iconGrid = document.getElementById("icon-grid");
for (const name of Object.keys(ICONS)) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "icon-choice";
  b.title = name;
  b.dataset.icon = name;
  b.innerHTML = iconSvg(name);
  b.addEventListener("click", () => {
    const token = ":" + name + ":";
    const glyph = linkForm.elements.glyph;
    glyph.value = glyph.value.trim() === token ? "" : token;
    syncIconGrid();
  });
  iconGrid.appendChild(b);
}

function syncIconGrid() {
  const v = linkForm.elements.glyph.value.trim();
  for (const b of iconGrid.children) {
    b.classList.toggle("selected", v === ":" + b.dataset.icon + ":");
  }
}

linkForm.elements.glyph.addEventListener("input", syncIconGrid);

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
  linkDeleteBtn.hidden = !link;
  linkForm.elements.title.value = link ? link.title : "";
  linkForm.elements.url.value = link ? link.url : "";
  const icon = link && link.icon;
  customIconCheck.checked = Boolean(icon && icon.glyph);
  iconFields.hidden = !customIconCheck.checked;
  linkForm.elements.glyph.value = icon ? icon.glyph || "" : "";
  linkForm.elements.iconColor.value = (icon && icon.color) || "#a78bfa";
  syncIconGrid();
  linkDialogOpened = linkFormSnapshot();
  linkDialog.showModal();
}

function linkFormSnapshot() {
  return JSON.stringify([
    linkForm.elements.title.value,
    linkForm.elements.url.value,
    customIconCheck.checked,
    linkForm.elements.glyph.value,
    linkForm.elements.iconColor.value,
  ]);
}

wireBackdropDismiss(linkDialog, () => {
  if (linkFormSnapshot() === linkDialogOpened) linkDialog.close();
});

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

// Delete lives in the edit dialog (cards only carry the ✎ icon); it still
// confirms, and cancelling the confirm leaves the dialog open for more edits.
const linkDeleteBtn = linkForm.querySelector('[data-action="delete"]');
linkDeleteBtn.addEventListener("click", () => {
  const { groupId, linkId } = dialogCtx;
  const g = data.groups.find((g) => g.id === groupId);
  const link = g && g.links.find((l) => l.id === linkId);
  if (link && deleteLink(groupId, link)) linkDialog.close();
});

function deleteLink(groupId, link) {
  if (!window.confirm(`Delete “${link.title}”?`)) return false;
  mutate((d) => {
    const g = d.groups.find((g) => g.id === groupId);
    if (g) g.links = g.links.filter((l) => l.id !== link.id);
  });
  return true;
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

bulkForm.addEventListener("submit", (e) => {
  const items = parseBulkText(bulkForm.elements.text.value);
  if (!items.length) {
    e.preventDefault(); // keep the paste dialog open
    window.alert("No links found — paste one URL per line.");
    return;
  }
  openBulkPick(items);
});

bulkForm.querySelector('[data-action="cancel"]').addEventListener("click", () => {
  bulkDialog.close();
});

// ---------- bulk edit ----------
// One screen with every link as an editable row (icon, title, URL, group),
// applied in a single mutate() on save. Rows are compared against a snapshot
// taken when the dialog opens, so the Save button counts real changes and an
// untouched save is a no-op (no pointless sync write).

const editDialog = document.getElementById("edit-dialog");
const editForm = document.getElementById("edit-form");
const editRowsEl = document.getElementById("edit-rows");
const editFilterInput = document.getElementById("edit-filter");
const editSubmit = document.getElementById("edit-submit");
let editState = null; // [{ linkId, row, orig, titleInput, urlInput, glyphInput, colorInput, groupSelect }]
let editHeaders = null; // [{ el, rows }] for filter hiding

function normalizeUrl(url) {
  url = url.trim();
  if (url && !/^[a-z][a-z0-9+.-]*:/i.test(url)) url = "https://" + url;
  return url;
}

function editRowValues(r) {
  const glyph = r.glyphInput.value.trim();
  return {
    title: r.titleInput.value.trim() || r.orig.title,
    url: normalizeUrl(r.urlInput.value) || r.orig.url,
    icon: glyph ? { glyph, color: r.colorInput.value } : null,
    groupId: r.groupSelect.value,
  };
}

function editRowChanged(r) {
  if (r.deleting) return true;
  const v = editRowValues(r);
  return v.title !== r.orig.title
    || v.url !== r.orig.url
    || v.groupId !== r.orig.groupId
    || JSON.stringify(v.icon) !== JSON.stringify(r.orig.icon);
}

function editUpdateCount() {
  if (!editState) return;
  let edits = 0, dels = 0;
  for (const r of editState) {
    const changed = editRowChanged(r);
    r.row.classList.toggle("edited", changed && !r.deleting);
    if (r.deleting) dels++;
    else if (changed) edits++;
  }
  editSubmit.disabled = !edits && !dels;
  const s = (n) => (n === 1 ? "" : "s");
  if (edits && dels) editSubmit.textContent = `Save ${edits} change${s(edits)}, delete ${dels}`;
  else if (dels) editSubmit.textContent = `Delete ${dels} link${s(dels)}`;
  else if (edits) editSubmit.textContent = `Save ${edits} change${s(edits)}`;
  else editSubmit.textContent = "Save";
}

document.getElementById("bulk-edit").addEventListener("click", () => {
  editRowsEl.textContent = "";
  editFilterInput.value = "";
  editState = [];
  editHeaders = [];

  for (const group of data.groups) {
    const header = document.createElement("div");
    header.className = "edit-group-header";
    header.textContent = group.name;
    editRowsEl.appendChild(header);
    const headerEntry = { el: header, rows: [] };
    editHeaders.push(headerEntry);

    for (const link of group.links) {
      const row = document.createElement("div");
      row.className = "edit-row";

      const glyphInput = document.createElement("input");
      glyphInput.type = "text";
      glyphInput.className = "edit-glyph";
      glyphInput.maxLength = 24; // room for ":terminal:"-style icon tokens
      glyphInput.placeholder = "auto";
      glyphInput.spellcheck = false;
      glyphInput.value = (link.icon && link.icon.glyph) || "";

      const colorInput = document.createElement("input");
      colorInput.type = "color";
      colorInput.className = "color-input";
      colorInput.title = "Icon color (used when icon text is set)";
      colorInput.value = (link.icon && link.icon.color) || "#a78bfa";

      const iconCell = document.createElement("span");
      iconCell.className = "edit-icon-cell";
      iconCell.append(glyphInput, colorInput);

      const titleInput = document.createElement("input");
      titleInput.type = "text";
      titleInput.spellcheck = false;
      titleInput.value = link.title;

      const urlInput = document.createElement("input");
      urlInput.type = "text";
      urlInput.spellcheck = false;
      urlInput.value = link.url;

      const groupSelect = document.createElement("select");
      for (const g of data.groups) {
        const opt = document.createElement("option");
        opt.value = g.id;
        opt.textContent = g.name;
        groupSelect.appendChild(opt);
      }
      groupSelect.value = group.id;

      const entry = {
        linkId: link.id,
        row,
        deleting: false,
        orig: {
          title: link.title,
          url: link.url,
          groupId: group.id,
          icon: link.icon && link.icon.glyph
            ? { glyph: link.icon.glyph, color: link.icon.color || "#a78bfa" }
            : null,
        },
        titleInput, urlInput, glyphInput, colorInput, groupSelect,
      };

      const delBtn = iconBtn("✕", "Mark for deletion", () => {
        entry.deleting = !entry.deleting;
        row.classList.toggle("deleting", entry.deleting);
        delBtn.title = entry.deleting ? "Keep this link" : "Mark for deletion";
        editUpdateCount();
      }, "edit-delete");

      row.append(iconCell, titleInput, urlInput, groupSelect, delBtn);
      editRowsEl.appendChild(row);
      headerEntry.rows.push(row);
      editState.push(entry);
    }
  }

  editUpdateCount();
  editDialog.showModal();
});

editRowsEl.addEventListener("input", editUpdateCount);
editRowsEl.addEventListener("change", editUpdateCount);

editFilterInput.addEventListener("input", () => {
  if (!editState) return;
  const q = editFilterInput.value.trim().toLowerCase();
  for (const r of editState) {
    const hay = (r.titleInput.value + " " + r.urlInput.value).toLowerCase();
    r.row.hidden = Boolean(q) && !hay.includes(q);
  }
  for (const h of editHeaders) {
    h.el.hidden = Boolean(q) && h.rows.every((row) => row.hidden);
  }
});

editForm.addEventListener("submit", (e) => {
  const rows = editState;
  const dels = rows.filter((r) => r.deleting).length;
  if (dels && !confirm(`Delete ${dels} link${dels === 1 ? "" : "s"}?`)) {
    e.preventDefault(); // keep the dialog open, marks intact
    return;
  }
  editState = null;
  if (!rows.some(editRowChanged)) return; // untouched — just close

  mutate((d) => {
    const byId = new Map(rows.map((r) => [r.linkId, r]));
    const moved = [];
    for (const g of d.groups) {
      const keep = [];
      for (const link of g.links) {
        const r = byId.get(link.id);
        if (!r) { keep.push(link); continue; }
        if (r.deleting) continue; // marked ✕ — drop the link
        const v = editRowValues(r);
        Object.assign(link, { title: v.title, url: v.url });
        if (v.icon) link.icon = v.icon;
        else delete link.icon;
        if (v.groupId === g.id) keep.push(link);
        else moved.push({ link, to: v.groupId, from: g });
      }
      g.links = keep;
    }
    for (const m of moved) {
      const to = d.groups.find((g) => g.id === m.to);
      (to || m.from).links.push(m.link);
    }
  });
});

editForm.querySelector('[data-action="cancel"]').addEventListener("click", () => {
  editState = null;
  editDialog.close();
});

wireBackdropDismiss(editDialog, () => {
  if (editState && editState.some(editRowChanged)) return; // unsaved edits
  editState = null;
  editDialog.close();
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

// How the cards flow inside this container, per the current layout:
//   vertical   — one card per line (columns layout, or a one-track grid)
//   horizontal — one line of cards scrolling sideways (rows layout)
//   wrap       — row-major wrapping grid (vertical + grid layouts)
// The insertion test must follow the flow axis: measuring the cross axis (or
// requiring the cursor to sit exactly inside a card's band, so gaps between
// cards match nothing) makes the ghost oscillate between spots on every
// dragover — the flicker this replaces.
function cardsFlow(cardsEl) {
  const s = getComputedStyle(cardsEl);
  if (s.display === "flex") return s.flexDirection.startsWith("column") ? "vertical" : "horizontal";
  return s.gridTemplateColumns.trim().includes(" ") ? "wrap" : "vertical";
}

// The card the drop ghost should sit before; the trailing + Add button catches
// the append-at-end case. "Before this card" greedily matches the first card
// past the cursor along the flow axis, so cursor positions in the gaps between
// cards (and rows) resolve to a stable spot instead of falling through.
function findDropAnchor(cardsEl, x, y) {
  const flow = cardsFlow(cardsEl);
  for (const card of cardsEl.querySelectorAll(".card:not(.dragging)")) {
    const r = card.getBoundingClientRect();
    if (flow === "vertical") {
      if (y < r.top + r.height / 2) return card;
    } else if (flow === "horizontal") {
      if (x < r.left + r.width / 2) return card;
    } else if (y < r.top || (y <= r.bottom && x < r.left + r.width / 2)) {
      return card;
    }
  }
  return cardsEl.querySelector(".card-add");
}

function positionDropGhost(cardsEl, x, y) {
  const anchor = findDropAnchor(cardsEl, x, y);
  if (anchor === dropGhost || anchor === dropGhost.nextElementSibling) return;
  cardsEl.insertBefore(dropGhost, anchor);
}

// ---------- group reordering ----------

let groupDragState = null; // { groupId }

const groupGhost = document.createElement("div");
groupGhost.className = "group-ghost";

// How groups flow across the board, per the current layout: columns is a
// sideways flex board, grid is CSS multi-columns (column-major: down each
// column, then rightward), vertical and rows are plain stacks.
function boardFlow() {
  const s = getComputedStyle(board);
  if (s.display === "flex") return "horizontal";
  if (s.columnWidth !== "auto" || s.columnCount !== "auto") return "columns";
  return "vertical";
}

// The group the ghost should sit before (null = append), same greedy
// first-past-the-cursor test as findDropAnchor but along the board's flow.
function findGroupAnchor(x, y) {
  const flow = boardFlow();
  for (const g of board.querySelectorAll(".group:not(.dragging)")) {
    const r = g.getBoundingClientRect();
    if (!r.width && !r.height) continue; // hidden (filtered out)
    if (flow === "vertical") {
      if (y < r.top + r.height / 2) return g;
    } else if (flow === "horizontal") {
      if (x < r.left + r.width / 2) return g;
    } else if (x < r.left || (x <= r.right && y < r.top + r.height / 2)) {
      // column-major: everything in a column right of the cursor comes later;
      // within the cursor's own column, the usual midpoint test.
      return g;
    }
  }
  return null;
}

board.addEventListener("dragover", (e) => {
  if (!groupDragState) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  const anchor = findGroupAnchor(e.clientX, e.clientY);
  if (groupGhost.parentElement === board && groupGhost.nextElementSibling === anchor) return;
  board.insertBefore(groupGhost, anchor);
});

board.addEventListener("dragleave", (e) => {
  if (!groupDragState) return;
  if (e.relatedTarget && board.contains(e.relatedTarget)) return;
  groupGhost.remove();
});

board.addEventListener("drop", (e) => {
  if (!groupDragState) return;
  e.preventDefault();
  let next = groupGhost.parentElement === board ? groupGhost.nextElementSibling : null;
  if (next && next.classList.contains("dragging")) next = next.nextElementSibling;
  const beforeGroupId = next && next.classList.contains("group") ? next.dataset.groupId : null;
  const { groupId } = groupDragState;
  groupGhost.remove();

  mutate((d) => {
    const i = d.groups.findIndex((g) => g.id === groupId);
    if (i < 0) return;
    const [g] = d.groups.splice(i, 1);
    let j = beforeGroupId ? d.groups.findIndex((x) => x.id === beforeGroupId) : -1;
    if (j < 0) j = d.groups.length;
    d.groups.splice(j, 0, g);
  });
});

// A drag from outside the page — a bookmark-bar entry, a link on another page,
// the address bar's padlock — carries text/uri-list. Tabs themselves can't be
// dropped (Chrome turns a tab drag into a new window before the page sees it).
function isExternalLinkDrag(e) {
  return !dragState && e.dataTransfer.types.includes("text/uri-list");
}

function dropExternalLinks(e, toGroupId, beforeLinkId) {
  const urls = e.dataTransfer.getData("text/uri-list")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && /^https?:\/\//i.test(l));

  const target = data.groups.find((g) => g.id === toGroupId);
  if (!target || !urls.length) return;
  const have = new Set(target.links.map((l) => l.url));
  if (!urls.some((u) => !have.has(u))) return; // all dupes — no write

  // Bookmark and link drags usually include an HTML fragment whose anchors
  // carry the titles; address-bar drags don't, so fall back to the guesser.
  const titles = new Map();
  const html = e.dataTransfer.getData("text/html");
  if (html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    for (const a of doc.querySelectorAll("a[href]")) {
      const t = a.textContent.trim();
      if (t) titles.set(a.href, t);
    }
  }
  const titleFor = (url) => {
    try { return titles.get(new URL(url).href); } catch { return null; }
  };

  mutate((d) => {
    const g = d.groups.find((g) => g.id === toGroupId);
    if (!g) return;
    const seen = new Set(g.links.map((l) => l.url));
    let j = beforeLinkId ? g.links.findIndex((l) => l.id === beforeLinkId) : -1;
    if (j < 0) j = g.links.length;
    for (const url of urls) {
      if (seen.has(url)) continue;
      seen.add(url);
      g.links.splice(j++, 0, { id: uid("l"), title: titleFor(url) || titleForUrl(url), url });
    }
  });
}

function wireDropZone(cardsEl) {
  cardsEl.addEventListener("dragover", (e) => {
    const external = isExternalLinkDrag(e);
    if (!dragState && !external) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = external ? "copy" : "move";
    positionDropGhost(cardsEl, e.clientX, e.clientY);
  });

  cardsEl.addEventListener("dragleave", (e) => {
    // Only clear when actually leaving this container (not entering a child)
    if (e.relatedTarget && cardsEl.contains(e.relatedTarget)) return;
    if (dropGhost.parentElement === cardsEl) removeDropGhost();
  });

  cardsEl.addEventListener("drop", (e) => {
    const external = isExternalLinkDrag(e);
    if (!dragState && !external) return;
    e.preventDefault();
    // The ghost's position in the DOM is exactly where the card should land.
    let next = dropGhost.parentElement === cardsEl ? dropGhost.nextElementSibling : null;
    if (next && next.classList.contains("dragging")) next = next.nextElementSibling;
    const beforeLinkId = next && next.classList.contains("card") ? next.dataset.linkId : null;
    const toGroupId = cardsEl.dataset.groupId;
    removeDropGhost();

    if (external) {
      dropExternalLinks(e, toGroupId, beforeLinkId);
      return;
    }
    const { linkId, fromGroupId } = dragState;

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
  // A hidden search bar reveals for the duration of the search; the blur
  // handler below re-hides it (and clears the filter) when it loses focus.
  document.documentElement.dataset.search = "shown";
  filterInput.focus();
  filterInput.select();
});

filterInput.addEventListener("blur", () => {
  if (localStorage.getItem(LS_SEARCH) !== "hidden") return;
  filterInput.value = "";
  applyFilter();
  document.documentElement.dataset.search = "hidden";
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
    const text = await file.text();
    // Browser bookmark exports (Netscape format) get the selective dialog;
    // our own JSON backups keep the replace-everything flow.
    if (/\.html?$/i.test(file.name) || text.trimStart().startsWith("<")) {
      openBookmarkImport(text);
      return;
    }
    const parsed = JSON.parse(text);
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

// ---------- chrome bookmark import ----------
// Chrome (and Firefox/Safari/Edge) export bookmarks as Netscape-format HTML:
// nested <DL>s where each <DT> holds either an <H3> folder (with its child <DL>
// inside the same <DT> — browsers never close the DT) or an <A> link. Parsed
// with DOMParser, flattened to one section per folder, each with its own
// destination group. Additive only — never touches existing links.

const bmDialog = document.getElementById("bm-dialog");
const bmForm = document.getElementById("bm-form");
const bmTree = document.getElementById("bm-tree");
const bmSubmit = document.getElementById("bm-submit");
let bmSections = null; // [{ name, select, rows: [{ check, link }] }]

function parseBookmarksHtml(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const rootDl = doc.querySelector("dl");
  if (!rootDl) throw new Error("no bookmarks found — is this a bookmarks export?");

  const sections = [];
  const walk = (dl, path) => {
    // Register the section before recursing so folders list in document order
    // (parent above its subfolders).
    const section = {
      name: path.length ? path[path.length - 1] : "Imported",
      path: path.join(" / ") || "Loose bookmarks",
      links: [],
    };
    sections.push(section);
    for (const dt of dl.children) {
      if (dt.tagName !== "DT") continue;
      const h3 = dt.querySelector(":scope > h3");
      if (h3) {
        // Child list is inside the DT (unclosed-DT parsing) or, from stricter
        // exporters, the next sibling.
        const sub = dt.querySelector(":scope > dl") ||
          (dt.nextElementSibling && dt.nextElementSibling.tagName === "DL"
            ? dt.nextElementSibling : null);
        if (sub) walk(sub, [...path, h3.textContent.trim() || "Untitled"]);
        continue;
      }
      const a = dt.querySelector(":scope > a");
      const url = a && a.getAttribute("href");
      if (url && /^https?:\/\//i.test(url)) {
        section.links.push({ title: a.textContent.trim() || titleForUrl(url), url });
      }
    }
  };
  walk(rootDl, []);
  return sections.filter((s) => s.links.length);
}

function bmHost(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

function bmUpdateCount() {
  let n = 0;
  for (const s of bmSections) {
    let checked = 0;
    for (const row of s.rows) if (row.check.checked) checked++;
    n += checked;
    s.folderCheck.checked = checked > 0 && checked === s.rows.length;
    s.folderCheck.indeterminate = checked > 0 && checked < s.rows.length;
  }
  bmSubmit.disabled = n === 0;
  bmSubmit.textContent = n ? `Import ${n} link${n === 1 ? "" : "s"}` : "Import";
}

function openBookmarkImport(html) {
  const sections = parseBookmarksHtml(html);
  if (!sections.length) throw new Error("no links found in that file");

  const existingUrls = new Set(
    data.groups.flatMap((g) => g.links.map((l) => l.url)),
  );

  bmTree.textContent = "";
  bmSections = [];

  for (const section of sections) {
    const box = document.createElement("div");
    box.className = "bm-folder";

    const header = document.createElement("div");
    header.className = "bm-folder-header";

    const folderCheck = document.createElement("input");
    folderCheck.type = "checkbox";
    folderCheck.title = "Select folder";

    const name = document.createElement("span");
    name.className = "bm-folder-name";
    name.textContent = section.path;

    const select = document.createElement("select");
    const optNew = document.createElement("option");
    optNew.value = "__new__";
    optNew.textContent = `→ new group “${section.name}”`;
    select.appendChild(optNew);
    for (const g of data.groups) {
      const opt = document.createElement("option");
      opt.value = g.id;
      opt.textContent = `→ ${g.name}`;
      select.appendChild(opt);
    }
    // A group with the folder's name already exists? Default to merging into it.
    const match = data.groups.find(
      (g) => g.name.toLowerCase() === section.name.toLowerCase(),
    );
    if (match) select.value = match.id;

    header.append(folderCheck, name, select);
    box.appendChild(header);

    const rows = [];
    for (const link of section.links) {
      const row = document.createElement("label");
      row.className = "bm-row";

      const check = document.createElement("input");
      check.type = "checkbox";

      const title = document.createElement("span");
      title.className = "bm-title";
      title.textContent = link.title;
      title.title = link.url;

      const host = document.createElement("span");
      host.className = "bm-host";
      host.textContent = bmHost(link.url);

      row.append(check, title, host);
      const dupe = existingUrls.has(link.url);
      if (dupe) {
        row.classList.add("bm-dupe");
        host.textContent = "already added";
      }
      box.appendChild(row);
      rows.push({ check, link, dupe });
    }

    folderCheck.addEventListener("change", () => {
      // Folder toggle skips already-added links; they stay individually checkable.
      for (const row of rows) row.check.checked = folderCheck.checked && !row.dupe;
      bmUpdateCount();
    });

    bmTree.appendChild(box);
    bmSections.push({ name: section.name, select, folderCheck, rows });
  }

  bmUpdateCount();
  bmDialog.showModal();
}

bmTree.addEventListener("change", (e) => {
  if (e.target.matches('.bm-row input[type="checkbox"]')) bmUpdateCount();
});

bmForm.addEventListener("submit", () => {
  const sections = bmSections;
  bmSections = null;
  mutate((d) => {
    for (const s of sections) {
      const chosen = s.rows.filter((r) => r.check.checked).map((r) => r.link);
      if (!chosen.length) continue;

      let group;
      if (s.select.value === "__new__") {
        const existing = d.groups.find(
          (g) => g.name.toLowerCase() === s.name.toLowerCase(),
        );
        group = existing || { id: uid("g"), name: s.name, links: [] };
        if (!existing) d.groups.push(group);
      } else {
        group = d.groups.find((g) => g.id === s.select.value);
        if (!group) continue;
      }

      const have = new Set(group.links.map((l) => l.url));
      for (const link of chosen) {
        if (have.has(link.url)) continue;
        have.add(link.url);
        group.links.push({ id: uid("l"), title: link.title, url: link.url });
      }
    }
  });
});

bmForm.querySelector('[data-action="cancel"]').addEventListener("click", () => {
  bmSections = null;
  bmDialog.close();
});

// ---------- bulk add: parsing + picker ----------
// One paste box covers hand-written group + URL lists (the original bulk-add
// syntax) and open-tab dumps from copy-tabs extensions — web pages can't
// enumerate the browser's tabs, so tab import is paste-driven by design.
// Parsed items flow through a picker (checkbox per link, destination group per
// link), so nothing lands on the board sight unseen. Additive only.

const pickDialog = document.getElementById("pick-dialog");
const pickForm = document.getElementById("pick-form");
const pickTree = document.getElementById("pick-tree");
const pickSubmit = document.getElementById("pick-submit");
let pickRows = null; // [{ check, select, item, dupe }]
let pickAllCheck = null;
let pickNewNames = null; // pasted group names with no existing group

const BULK_URL_RE = /https?:\/\/[^\s"<>]+/i;
const BULK_SEP_LEAD = /^[\s\-–—|:·,()[\]'"“”]+/;
const BULK_SEP_TRAIL = /[\s\-–—|:·,()[\]'"“”]+$/;

// Accepts bare URLs (scheme-less domains too), markdown [Title](url), and lines
// with a URL anywhere in them (the remainder, minus separator punctuation,
// becomes the title). A line that isn't a URL starts a group — unless every one
// of them directly precedes exactly one URL line, the Title/URL pair shape
// copy-tabs tools emit, in which case they're read as titles instead. The
// picker shows the interpretation before anything is added, so the ambiguous
// cases stay correctable. Duplicate URLs within one paste collapse to the first.
function parseBulkText(text) {
  const entries = [];
  for (let line of text.split("\n")) {
    line = line.trim().replace(/^[-*•]\s+/, "");
    if (!line) continue;
    const md = /^\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)$/.exec(line);
    if (md) { entries.push({ title: md[1].trim() || null, url: md[2] }); continue; }
    const m = BULK_URL_RE.exec(line);
    if (m) {
      const around = (line.slice(0, m.index) + " " + line.slice(m.index + m[0].length))
        .replace(BULK_SEP_LEAD, "").replace(BULK_SEP_TRAIL, "").trim();
      entries.push({ title: around || null, url: m[0].replace(/[.,;]+$/, "") });
      continue;
    }
    if (looksLikeUrl(line)) { entries.push({ title: null, url: "https://" + line }); continue; }
    entries.push({ plain: line });
  }

  const plains = entries.filter((e) => e.plain).length;
  const pairMode = plains >= 2 && plains === entries.length - plains &&
    entries.every((e, i) => !e.plain || (entries[i + 1] && entries[i + 1].url));

  const items = [];
  const seen = new Set();
  let groupName = null;
  let pendingTitle = null;
  for (const e of entries) {
    if (e.plain) {
      if (pairMode) pendingTitle = e.plain;
      else groupName = e.plain;
      continue;
    }
    if (seen.has(e.url)) continue;
    seen.add(e.url);
    items.push({ title: e.title || pendingTitle || titleForUrl(e.url), url: e.url, groupName });
    pendingTitle = null;
  }
  return items;
}

function pickGroupSelect() {
  const select = document.createElement("select");
  for (const name of pickNewNames) {
    const opt = document.createElement("option");
    opt.value = "__new__:" + name;
    opt.textContent = `→ new group “${name}”`;
    select.appendChild(opt);
  }
  for (const g of data.groups) {
    const opt = document.createElement("option");
    opt.value = g.id;
    opt.textContent = "→ " + g.name;
    select.appendChild(opt);
  }
  return select;
}

function pickDefaultValue(groupName) {
  const name = groupName || "Imported";
  const match = data.groups.find((g) => g.name.toLowerCase() === name.toLowerCase());
  return match ? match.id : "__new__:" + name;
}

function pickUpdateCount() {
  let n = 0;
  for (const r of pickRows) if (r.check.checked) n++;
  pickAllCheck.checked = n > 0 && n === pickRows.length;
  pickAllCheck.indeterminate = n > 0 && n < pickRows.length;
  pickSubmit.disabled = n === 0;
  pickSubmit.textContent = n ? `Add ${n} link${n === 1 ? "" : "s"}` : "Add";
}

function openBulkPick(items) {
  const existingUrls = new Set(
    data.groups.flatMap((g) => g.links.map((l) => l.url)),
  );

  // Pasted group names (plus the "Imported" fallback) that don't match an
  // existing group become "new group" options, in first-mention order.
  pickNewNames = [];
  for (const item of items) {
    const name = item.groupName || "Imported";
    const known = data.groups.some((g) => g.name.toLowerCase() === name.toLowerCase())
      || pickNewNames.some((n) => n.toLowerCase() === name.toLowerCase());
    if (!known) pickNewNames.push(name);
  }

  pickTree.textContent = "";
  pickRows = [];

  const header = document.createElement("div");
  header.className = "bm-folder-header";

  pickAllCheck = document.createElement("input");
  pickAllCheck.type = "checkbox";
  pickAllCheck.title = "Select all";
  pickAllCheck.addEventListener("change", () => {
    // Select-all skips already-added links; they stay individually checkable.
    for (const r of pickRows) r.check.checked = pickAllCheck.checked && !r.dupe;
    pickUpdateCount();
  });

  const name = document.createElement("span");
  name.className = "bm-folder-name";
  name.textContent = items.length + " link" + (items.length === 1 ? "" : "s");

  // Stamps every row's destination in one go, then snaps back to its label.
  const allSelect = pickGroupSelect();
  const optAll = document.createElement("option");
  optAll.value = "";
  optAll.textContent = "Set every group to…";
  allSelect.insertBefore(optAll, allSelect.firstChild);
  allSelect.value = "";
  allSelect.addEventListener("change", () => {
    if (!allSelect.value) return;
    for (const r of pickRows) r.select.value = allSelect.value;
    allSelect.value = "";
  });

  header.append(pickAllCheck, name, allSelect);
  pickTree.appendChild(header);

  for (const item of items) {
    const row = document.createElement("label");
    row.className = "bm-row";

    const check = document.createElement("input");
    check.type = "checkbox";

    const title = document.createElement("span");
    title.className = "bm-title";
    title.textContent = item.title;
    title.title = item.url;

    const host = document.createElement("span");
    host.className = "bm-host";
    host.textContent = bmHost(item.url);

    const select = pickGroupSelect();
    select.value = pickDefaultValue(item.groupName);

    const dupe = existingUrls.has(item.url);
    if (dupe) {
      row.classList.add("bm-dupe");
      host.textContent = "already added";
    }
    // A paste is already a choice, so non-dupes start checked (the bookmark
    // import starts unchecked; there the point is culling a big export).
    check.checked = !dupe;

    row.append(check, title, host, select);
    pickTree.appendChild(row);
    pickRows.push({ check, select, item, dupe });
  }

  pickUpdateCount();
  pickDialog.showModal();
}

pickTree.addEventListener("change", (e) => {
  if (e.target.matches('.bm-row input[type="checkbox"]')) pickUpdateCount();
});

pickForm.addEventListener("submit", () => {
  const rows = pickRows;
  pickRows = null;
  if (!rows || !rows.some((r) => r.check.checked)) return;

  mutate((d) => {
    const created = new Map(); // lower-cased name → group made this pass
    const usedTitles = new Map(); // per-group title → count, for "Supabase 2" dedupe
    const seeded = new Set(); // group ids whose existing titles are already counted

    const resolveGroup = (val) => {
      if (!val.startsWith("__new__:")) return d.groups.find((g) => g.id === val) || null;
      const groupName = val.slice("__new__:".length);
      const key = groupName.toLowerCase();
      let g = created.get(key)
        || d.groups.find((g) => g.name.toLowerCase() === key);
      if (!g) {
        g = { id: uid("g"), name: groupName, links: [] };
        d.groups.push(g);
      }
      created.set(key, g);
      return g;
    };

    for (const r of rows) {
      if (!r.check.checked) continue;
      const g = resolveGroup(r.select.value);
      if (!g) continue;
      if (g.links.some((l) => l.url === r.item.url)) continue;

      // Seed the dedupe counter with the group's existing titles so a second
      // "Supabase" added to a group that already has one becomes "Supabase 2".
      if (!seeded.has(g.id)) {
        seeded.add(g.id);
        for (const l of g.links) {
          const key = g.id + " " + l.title.replace(/ \d+$/, "");
          usedTitles.set(key, (usedTitles.get(key) || 0) + 1);
        }
      }
      let title = r.item.title;
      const key = g.id + " " + title;
      const n = (usedTitles.get(key) || 0) + 1;
      usedTitles.set(key, n);
      if (n > 1) title += " " + n;

      g.links.push({ id: uid("l"), title, url: r.item.url });
    }
  });
});

pickForm.querySelector('[data-action="cancel"]').addEventListener("click", () => {
  pickRows = null;
  pickDialog.close();
});


// ---------- init ----------

// Cache the app shell and previously loaded visual assets so new tabs start
// locally and the page remains usable offline. The worker refreshes the shell
// periodically in the background; updateViaCache keeps checks for sw.js itself
// from being satisfied by an older HTTP-cache entry.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).catch((error) => {
    console.warn("startpage: service worker registration failed", error);
  });
}

// A newer copy that arrived while an edit dialog was open is fetched fresh
// once the last dialog closes (see pendingPull in the sync section).
for (const dlg of document.querySelectorAll("dialog")) {
  dlg.addEventListener("close", () => {
    if (pendingPull && !anyDialogOpen()) {
      pendingPull = false;
      pullAndReconcile();
    }
  });
}

applyAppearance();
render();
updateStatusDot();
pullAndReconcile();
