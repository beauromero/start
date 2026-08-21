import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../public/", import.meta.url));
const MIME = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

const INITIAL_DATA = {
  version: 1,
  updatedAt: "2026-08-21T12:00:00.000Z",
  groups: [{ id: "g-test", name: "Test", links: [] }],
};

const LEGACY_WORKER = String.raw`"use strict";
const KEEP = "startpage-shell-v2-qa";
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(KEEP);
    await cache.put("/legacy", new Response("legacy"));
    await caches.open("startpage-meta-v2");
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("message", (event) => {
  if (event.data !== "clean-legacy-caches") return;
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith("startpage-") && name !== KEEP)
      .map((name) => caches.delete(name)));
    event.ports[0]?.postMessage("done");
  })());
});
`;

export class TestServer {
  constructor() {
    this.httpServer = null;
    this.port = null;
    this.version = "A";
    this.workerMode = "current";
    this.failShell = false;
    this.data = structuredClone(INITIAL_DATA);
    this.putCount = 0;
    this.lastSecret = null;
    this.requestCounts = new Map();
    this.gates = new Map();
  }

  get origin() {
    return `http://127.0.0.1:${this.port}`;
  }

  setVersion(version) {
    this.version = version;
  }

  setWorkerMode(mode) {
    this.workerMode = mode;
  }

  setShellFailure(value) {
    this.failShell = value;
  }

  requestCount(path) {
    return this.requestCounts.get(path) || 0;
  }

  holdNext(path) {
    let markRequested;
    let release;
    const requested = new Promise((resolve) => { markRequested = resolve; });
    const released = new Promise((resolve) => { release = resolve; });
    this.gates.set(path, { markRequested, released });
    return { requested, release };
  }

  async start() {
    if (this.httpServer) return;
    this.httpServer = createServer((request, response) => {
      this.handle(request, response).catch((error) => {
        response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        response.end(error.stack);
      });
    });
    await new Promise((resolve, reject) => {
      this.httpServer.once("error", reject);
      this.httpServer.listen(this.port || 0, "127.0.0.1", resolve);
    });
    this.port ||= this.httpServer.address().port;
  }

  async stop() {
    if (!this.httpServer) return;
    const server = this.httpServer;
    this.httpServer = null;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }

  async handle(request, response) {
    const url = new URL(request.url, this.origin);
    this.requestCounts.set(url.pathname, this.requestCount(url.pathname) + 1);

    const gate = this.gates.get(url.pathname);
    if (gate) {
      this.gates.delete(url.pathname);
      gate.markRequested();
      await gate.released;
    }

    if (url.pathname === "/api/links") {
      await this.handleLinks(request, response);
      return;
    }

    const path = url.pathname === "/" || url.pathname === "/index.html"
      ? "index.html"
      : url.pathname.slice(1);
    if (!["index.html", "style.css", "app.js", "sw.js"].includes(path)) {
      response.writeHead(404);
      response.end();
      return;
    }

    if (this.failShell && ["index.html", "style.css", "app.js"].includes(path)) {
      response.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("intentional shell failure");
      return;
    }

    let body = path === "sw.js" && this.workerMode === "legacy"
      ? LEGACY_WORKER
      : await readFile(join(ROOT, path), "utf8");
    if (path === "index.html") {
      body = body.replace("<title>start</title>", `<title>start-${this.version}</title>`);
    } else if (path === "style.css") {
      body += `\n:root { --qa-shell-version: "${this.version}"; }\n`;
    } else if (path === "app.js") {
      body = `window.__QA_SHELL_VERSION__ = "${this.version}";\n${body}`;
    }

    const headers = {
      "Content-Type": MIME[extname(path)] || "text/plain; charset=utf-8",
      "Cache-Control": path === "sw.js" ? "no-cache, no-store, must-revalidate" : "no-cache",
    };
    response.writeHead(200, headers);
    response.end(body);
  }

  async handleLinks(request, response) {
    if (request.method === "GET") {
      this.json(response, 200, this.data);
      return;
    }
    if (request.method !== "PUT") {
      response.writeHead(405);
      response.end();
      return;
    }

    this.lastSecret = request.headers["x-sync-secret"] || null;
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    this.data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    this.putCount += 1;
    this.json(response, 200, { ok: true });
  }

  json(response, status, value) {
    response.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(JSON.stringify(value));
  }
}
