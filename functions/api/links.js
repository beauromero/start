const KV_KEY = "links:v1";

export async function onRequestGet({ env }) {
  const blob = await env.LINKS.get(KV_KEY);
  if (blob === null) {
    return json({ error: "empty" }, 404);
  }
  return new Response(blob, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export async function onRequestPut({ request, env }) {
  const secret = env.SYNC_SECRET;
  if (!secret) {
    return json({ error: "SYNC_SECRET is not configured" }, 500);
  }
  const provided = request.headers.get("X-Sync-Secret") || "";
  if (!timingSafeEqual(provided, secret)) {
    return json({ error: "unauthorized" }, 401);
  }

  let data;
  try {
    data = await request.json();
  } catch {
    return json({ error: "body must be JSON" }, 400);
  }
  if (!data || !Array.isArray(data.groups)) {
    return json({ error: "expected { groups: [...] }" }, 400);
  }

  // Optimistic concurrency: the client sends the updatedAt its copy was based
  // on. If the stored blob has moved past that, reject with the current copy so
  // the client can merge and retry instead of silently clobbering another
  // window's changes. Header absent = legacy client = old unconditional write.
  // (KV is eventually consistent, so this is best-effort, not a true CAS — but
  // a single user hits the same edge PoP, where reads see their own writes.)
  const baseRev = request.headers.get("X-Base-Rev");
  if (baseRev !== null) {
    const current = await env.LINKS.get(KV_KEY);
    if (current !== null) {
      let currentAt = "";
      try { currentAt = JSON.parse(current).updatedAt || ""; } catch {}
      if (currentAt !== baseRev) {
        return new Response(current, {
          status: 409,
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        });
      }
    }
  }

  await env.LINKS.put(KV_KEY, JSON.stringify(data));
  return json({ ok: true, updatedAt: data.updatedAt ?? null });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}
