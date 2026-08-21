"use strict";

// This generation deliberately does not start with "startpage-". Older v2
// workers delete every cache with that prefix, including caches created by an
// installing replacement. A disjoint namespace makes the v2 -> v3 migration
// safe; the v3 worker removes legacy caches only after it becomes active.
const CACHE_PREFIX = "startpage3-";
const LEGACY_CACHE_PREFIX = "startpage-";
const META_CACHE = CACHE_PREFIX + "meta";
const RUNTIME_CACHE = CACHE_PREFIX + "runtime";
const SHELL_CACHE_PREFIX = CACHE_PREFIX + "shell-";
const STATE_KEY = "/__startpage_shell_state__";
const SNAPSHOT_PARAM = "__startpage_shell";
const SHELL_REFRESH_MS = 5 * 60 * 1000;
const SHELL_GRACE_MS = 10 * 60 * 1000;
const RUNTIME_LIMIT = 100;

// Keep these absolute paths in sync with the shell references in index.html.
// Cloudflare Pages redirects /index.html to /, so cache the canonical document.
const SHELL_PATHS = ["/", "/style.css", "/app.js"];
const SHELL_ASSET_PATHS = SHELL_PATHS.slice(1);

let refreshPromise = null;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    // A replacement must not mutate caches shared with the active worker.
    // Reuse a valid v3 snapshot when one exists; otherwise stage one without
    // cleaning anything. Cleanup is safe only after activation.
    if (!(await hasCompleteShell())) await createInitialShell();
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    await self.clients.claim();
    await refreshShellIfStale(true);
    await cleanupCaches(await readShellState(), true);
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Synced link data must always go to the network. The page renders its
  // localStorage copy first and already handles an unreachable API as offline.
  if (url.origin === self.location.origin && url.pathname === "/api/links") return;

  if (
    request.mode === "navigate" &&
    url.origin === self.location.origin &&
    (url.pathname === "/" || url.pathname === "/index.html")
  ) {
    event.respondWith(cachedNavigation(request));
    event.waitUntil(refreshShellIfStale());
    return;
  }

  if (url.origin === self.location.origin && SHELL_ASSET_PATHS.includes(url.pathname)) {
    event.respondWith(cachedShellAsset(url, request));
    return;
  }

  // Cache resolved favicons, direct favicon fallbacks, Google Fonts, and the
  // selected Momentum photo after their first successful load.
  if (
    (url.origin === self.location.origin && url.pathname === "/api/icon") ||
    request.destination === "image" ||
    url.hostname === "fonts.googleapis.com" ||
    url.hostname === "fonts.gstatic.com"
  ) {
    event.respondWith(cacheRuntimeAsset(request));
  }
});

async function cachedNavigation(request) {
  const cached = await matchCurrentShell("/");
  if (cached) return cached;

  try {
    return await fetch(request);
  } catch {
    return new Response("Start page is not cached yet.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

async function cachedShellAsset(url, request) {
  const snapshotId = url.searchParams.get(SNAPSHOT_PARAM);
  const cached = snapshotId
    ? await matchPinnedShell(url.pathname, snapshotId)
    : await matchCurrentShell(url.pathname);
  return cached || fetch(request);
}

async function matchCurrentShell(path) {
  const state = await readShellState();
  const name = await findCompleteShell(state);
  if (!name) return null;
  return (await caches.open(name)).match(path);
}

async function matchPinnedShell(path, snapshotId) {
  if (!isSnapshotId(snapshotId)) return null;

  const name = SHELL_CACHE_PREFIX + snapshotId;
  const names = await caches.keys();
  // Check existence before opening so arbitrary query strings cannot create
  // Cache Storage entries. Recently retired snapshots remain readable during
  // a short grace period for documents whose subresources are still loading.
  if (!names.includes(name)) return null;
  if (!(await isCompleteShell(name))) return null;
  return (await caches.open(name)).match(path);
}

async function cacheRuntimeAsset(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok || response.type === "opaque") {
    await cache.put(request, response.clone());
    await trimCache(cache, RUNTIME_LIMIT);
  }
  return response;
}

function refreshShellIfStale(bypassThrottle = false) {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const state = await readShellState();
    const lastAttemptAt = state.lastAttemptAt || state.refreshedAt || 0;
    if (!bypassThrottle && Date.now() - lastAttemptAt < SHELL_REFRESH_MS) return;

    const attemptedState = { ...state, lastAttemptAt: Date.now() };
    await writeShellState(attemptedState);
    await refreshShell(attemptedState, true);
  })().catch(() => {
    // Existing snapshots remain usable while offline.
  }).finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
}

async function createInitialShell() {
  // Preserve any existing pointers until a complete replacement is published.
  // They may still contain a usable fallback even if bootstrap was necessary.
  const state = { ...await readShellState(), lastAttemptAt: Date.now() };
  await writeShellState(state);
  await refreshShell(state, false);
}

async function refreshShell(oldState, cleanupAfterPublish) {
  const snapshotId = Date.now() + "-" + randomId();
  const snapshotName = SHELL_CACHE_PREFIX + snapshotId;
  const snapshot = await caches.open(snapshotName);
  let published = false;

  try {
    const responses = await Promise.all(SHELL_PATHS.map(async (path) => {
      const request = new Request(new URL(path, self.location.origin), { cache: "reload" });
      const response = await fetch(request);
      if (!response.ok) throw new Error(`Couldn't cache ${path}: ${response.status}`);
      return [path, response];
    }));

    // Each cached document points at this snapshot explicitly. If a refresh
    // publishes between the HTML and subresource requests, the page still gets
    // its CSS and JavaScript from the same immutable release.
    const taggedResponses = await Promise.all(responses.map(async ([path, response]) => [
      path,
      await responseForSnapshot(path, response, snapshotId),
    ]));

    // Only this isolated snapshot is mutated. It is invisible to readers until
    // every put succeeds and the single state record publishes it as active.
    await Promise.all(taggedResponses.map(([path, response]) => snapshot.put(path, response)));
    if (!(await isCompleteShell(snapshotName))) {
      throw new Error("New shell snapshot is incomplete");
    }

    const state = {
      active: snapshotName,
      previous: await findCompleteShell(oldState),
      retired: nextRetiredShells(oldState),
      refreshedAt: Date.now(),
      lastAttemptAt: oldState.lastAttemptAt || Date.now(),
    };
    state.retired = state.retired.filter(({ name }) => name !== state.previous);
    await writeShellState(state);
    published = true;
    if (cleanupAfterPublish) {
      try { await cleanupCaches(state, false); } catch {}
    }
  } catch (error) {
    if (!published) await caches.delete(snapshotName);
    throw error;
  }
}

async function responseForSnapshot(path, response, snapshotId) {
  const headers = new Headers(response.headers);
  headers.delete("Content-Encoding");
  headers.delete("Content-Length");
  headers.set("X-Startpage-Shell", snapshotId);

  if (path !== "/") {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  let html = await response.text();
  for (const assetPath of SHELL_ASSET_PATHS) {
    if (!html.includes(assetPath)) {
      throw new Error(`Shell document doesn't reference ${assetPath}`);
    }
    html = html.split(assetPath).join(
      assetPath + "?" + SNAPSHOT_PARAM + "=" + encodeURIComponent(snapshotId),
    );
  }
  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function hasCompleteShell() {
  const state = await readShellState();
  return Boolean(await findCompleteShell(state));
}

async function findCompleteShell(state) {
  for (const name of [state.active, state.previous]) {
    if (name && await isCompleteShell(name)) return name;
  }
  return null;
}

async function isCompleteShell(name) {
  if (!name.startsWith(SHELL_CACHE_PREFIX)) return false;
  const cache = await caches.open(name);
  for (const path of SHELL_PATHS) {
    if (!(await cache.match(path))) return false;
  }
  return true;
}

async function readShellState() {
  const response = await (await caches.open(META_CACHE)).match(STATE_KEY);
  if (!response) return {};
  try {
    const state = await response.json();
    return state && typeof state === "object" ? state : {};
  } catch {
    return {};
  }
}

async function writeShellState(state) {
  const cache = await caches.open(META_CACHE);
  await cache.put(STATE_KEY, new Response(JSON.stringify(state), {
    headers: { "Content-Type": "application/json" },
  }));
}

async function cleanupCaches(state, removeLegacy) {
  const retired = Array.isArray(state.retired)
    ? state.retired.filter(({ retiredAt }) => Date.now() - retiredAt < SHELL_GRACE_MS)
    : [];
  const keep = new Set([
    META_CACHE,
    RUNTIME_CACHE,
    state.active,
    state.previous,
    ...retired.map(({ name }) => name),
  ].filter(Boolean));
  const names = await caches.keys();
  await Promise.all(names
    .filter((name) => (
      (name.startsWith(CACHE_PREFIX) && !keep.has(name)) ||
      (removeLegacy && name.startsWith(LEGACY_CACHE_PREFIX))
    ))
    .map((name) => caches.delete(name)));
}

async function trimCache(cache, maxEntries) {
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - maxEntries))
    .map((key) => cache.delete(key)));
}

function isSnapshotId(value) {
  return /^\d{10,}-[a-z0-9]{6}$/.test(value);
}

function nextRetiredShells(oldState) {
  const now = Date.now();
  const retired = new Map();
  if (Array.isArray(oldState.retired)) {
    for (const entry of oldState.retired) {
      if (
        entry &&
        typeof entry.name === "string" &&
        Number.isFinite(entry.retiredAt) &&
        now - entry.retiredAt < SHELL_GRACE_MS
      ) {
        retired.set(entry.name, entry.retiredAt);
      }
    }
  }
  for (const name of [oldState.active, oldState.previous]) {
    if (name && !retired.has(name)) retired.set(name, now);
  }
  return [...retired].map(([name, retiredAt]) => ({ name, retiredAt }));
}

function randomId() {
  return Math.random().toString(36).slice(2, 8).padEnd(6, "0");
}
