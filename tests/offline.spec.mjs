import { expect, test } from "@playwright/test";
import { TestServer } from "./test-server.mjs";

const META_CACHE = "startpage3-meta";
const STATE_KEY = "/__startpage_shell_state__";

test.describe.serial("offline app shell", () => {
  let server;

  test.beforeEach(async () => {
    server = new TestServer();
    await server.start();
  });

  test.afterEach(async () => {
    await server.stop();
  });

  test("opens a new tab and reloads after the origin is fully unavailable", async ({ context, page }) => {
    await installAndControl(page, server.origin);
    await server.stop();

    const offlineTab = await context.newPage();
    await offlineTab.goto(server.origin, { waitUntil: "domcontentloaded" });
    await expect(offlineTab).toHaveTitle("start-A");
    await expect(offlineTab.locator("#board .group")).toHaveCount(1);
    await expect.poll(() => offlineTab.evaluate(() => window.__QA_SHELL_VERSION__)).toBe("A");

    await offlineTab.reload({ waitUntil: "domcontentloaded" });
    await expect(offlineTab).toHaveTitle("start-A");
    await expect(offlineTab.locator("#board .group")).toHaveCount(1);
  });

  test("pins a document's CSS and JavaScript to one immutable release", async ({ page }) => {
    await installAndControl(page, server.origin);
    const captured = await readActiveDocument(page);

    server.setVersion("B");
    await expireRefreshThrottle(page);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect.poll(() => activeCacheName(page)).not.toBe(captured.cacheName);

    const assets = await page.evaluate(async ({ styleUrl, scriptUrl }) => {
      const [style, script] = await Promise.all([fetch(styleUrl), fetch(scriptUrl)]);
      return {
        style: await style.text(),
        styleSnapshot: style.headers.get("X-Startpage-Shell"),
        script: await script.text(),
        scriptSnapshot: script.headers.get("X-Startpage-Shell"),
      };
    }, captured);

    expect(assets.style).toContain('--qa-shell-version: "A"');
    expect(assets.script).toContain('window.__QA_SHELL_VERSION__ = "A"');
    expect(assets.styleSnapshot).toBe(captured.snapshotId);
    expect(assets.scriptSnapshot).toBe(captured.snapshotId);
  });

  test("rolls back as a complete snapshot when the active cache is damaged", async ({ context, page }) => {
    await installAndControl(page, server.origin);
    const releaseACache = await activeCacheName(page);
    server.setVersion("B");
    await expireRefreshThrottle(page);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect.poll(() => activeCacheName(page)).not.toBe(releaseACache);

    await page.evaluate(async ({ metaCache, stateKey }) => {
      const stateResponse = await (await caches.open(metaCache)).match(stateKey);
      const state = await stateResponse.json();
      const active = await caches.open(state.active);
      const documentResponse = await active.match("/");
      const brokenHtml = (await documentResponse.text()).replace(/<title>.*?<\/title>/, "<title>BROKEN</title>");
      await active.put("/", new Response(brokenHtml, {
        headers: documentResponse.headers,
      }));
      await active.delete("/app.js");
    }, { metaCache: META_CACHE, stateKey: STATE_KEY });
    await server.stop();

    const rollbackTab = await context.newPage();
    await rollbackTab.goto(server.origin, { waitUntil: "domcontentloaded" });
    await expect(rollbackTab).toHaveTitle("start-A");
    await expect(rollbackTab.locator("#board .group")).toHaveCount(1);
    await expect.poll(() => rollbackTab.evaluate(() => window.__QA_SHELL_VERSION__)).toBe("A");
  });

  test("retries a dirty offline edit when connectivity returns", async ({ context, page }) => {
    await installAndControl(page, server.origin);
    await page.evaluate(() => localStorage.setItem("startpage:secret", "test-secret"));
    await context.setOffline(true);

    await page.getByTitle("More options").click();
    page.once("dialog", (dialog) => dialog.accept("Offline QA"));
    await page.getByRole("button", { name: "Add group" }).click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem("startpage:dirty"))).toBe("1");
    await expect(page.getByRole("heading", { name: "Offline QA" })).toBeVisible();

    // Observe the debounced PUT fail before firing the online handler under test.
    await expect(page.locator("#sync-status")).toBeVisible();
    expect(server.putCount).toBe(0);
    await context.setOffline(false);

    await expect.poll(() => server.putCount).toBe(1);
    await expect.poll(() => page.evaluate(() => localStorage.getItem("startpage:dirty"))).toBeNull();
    expect(server.lastSecret).toBe("test-secret");
    expect(server.data.groups.some((group) => group.name === "Offline QA")).toBe(true);
  });

  test("migrates from a hostile legacy worker without losing the staged v3 shell", async ({ page }) => {
    server.setWorkerMode("legacy");
    await page.goto(server.origin, { waitUntil: "domcontentloaded" });
    await waitForController(page);
    await expect.poll(() => page.evaluate(async () => (await caches.keys()).includes("startpage-shell-v2-qa"))).toBe(true);

    server.setWorkerMode("current");
    const gate = server.holdNext("/app.js");
    await page.evaluate(() => {
      navigator.serviceWorker.getRegistration().then((registration) => registration.update());
    });
    await gate.requested;

    // The installing v3 worker has opened its snapshot but is blocked fetching
    // app.js. Make the still-active v2 worker run its broad legacy cleanup now.
    await page.evaluate(() => new Promise((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = resolve;
      navigator.serviceWorker.controller.postMessage("clean-legacy-caches", [channel.port2]);
    }));
    const stagedNames = await page.evaluate(() => caches.keys());
    expect(stagedNames.some((name) => name.startsWith("startpage3-shell-"))).toBe(true);

    const controllerChanged = page.evaluate(() => new Promise((resolve) => {
      navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true });
    }));
    gate.release();
    await controllerChanged;
    await expect.poll(() => activeCacheName(page)).toMatch(/^startpage3-shell-/);
    await expect.poll(() => page.evaluate(async () => (
      (await caches.keys()).filter((name) => name.startsWith("startpage-"))
    ))).toEqual([]);
  });

  test("throttles sequential refresh attempts after a shell fetch fails", async ({ page }) => {
    await installAndControl(page, server.origin);
    await expireRefreshThrottle(page);
    server.setShellFailure(true);
    const before = shellRequestCount(server);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect.poll(() => shellRequestCount(server)).toBe(before + 3);
    const afterFailure = shellRequestCount(server);
    const failedAttemptAt = (await currentState(page)).lastAttemptAt;

    await page.reload({ waitUntil: "domcontentloaded" });
    expect(shellRequestCount(server)).toBe(afterFailure);
    const state = await currentState(page);
    expect(state.lastAttemptAt).toBe(failedAttemptAt);
    expect(Date.now() - state.lastAttemptAt).toBeLessThan(5_000);
  });
});

async function installAndControl(page, origin) {
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await waitForController(page);
  await expect.poll(() => page.evaluate(async () => (
    await navigator.serviceWorker.getRegistration()
  )?.active?.state)).toBe("activated");
  await expect.poll(() => activeCacheName(page)).toMatch(/^startpage3-shell-/);
}

async function waitForController(page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
    }
  });
}

async function currentState(page) {
  return page.evaluate(async ({ metaCache, stateKey }) => {
    const response = await (await caches.open(metaCache)).match(stateKey);
    return response ? response.json() : {};
  }, { metaCache: META_CACHE, stateKey: STATE_KEY });
}

async function activeCacheName(page) {
  return (await currentState(page)).active || "";
}

async function expireRefreshThrottle(page) {
  await page.evaluate(async ({ metaCache, stateKey }) => {
    const cache = await caches.open(metaCache);
    const response = await cache.match(stateKey);
    const state = await response.json();
    await cache.put(stateKey, new Response(JSON.stringify({
      ...state,
      refreshedAt: 0,
      lastAttemptAt: 0,
    }), { headers: { "Content-Type": "application/json" } }));
  }, { metaCache: META_CACHE, stateKey: STATE_KEY });
}

async function readActiveDocument(page) {
  return page.evaluate(async ({ metaCache, stateKey }) => {
    const stateResponse = await (await caches.open(metaCache)).match(stateKey);
    const state = await stateResponse.json();
    const response = await (await caches.open(state.active)).match("/");
    const html = await response.text();
    const styleUrl = html.match(/href="(\/style\.css\?__startpage_shell=[^"]+)"/)[1];
    const scriptUrl = html.match(/src="(\/app\.js\?__startpage_shell=[^"]+)"/)[1];
    const snapshotId = new URL(styleUrl, location.origin).searchParams.get("__startpage_shell");
    return { cacheName: state.active, snapshotId, styleUrl, scriptUrl };
  }, { metaCache: META_CACHE, stateKey: STATE_KEY });
}

function shellRequestCount(testServer) {
  return testServer.requestCount("/")
    + testServer.requestCount("/style.css")
    + testServer.requestCount("/app.js");
}
