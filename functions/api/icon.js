// GET /api/icon?url=<link url> — favicon resolver.
//
// Browsers render image bodies even on 404 responses, so the favicon services'
// "unknown site" globe fallbacks are indistinguishable from real icons on the
// client (`onerror` never fires, and CORS blocks reading the status). Here the
// status is visible, so each source is tried in order and only a genuine 200
// image is returned. A miss everywhere returns an empty 404, which *does* fire
// the client's `onerror` (no decodable body), advancing its fallback chain.

// Google product icons are per-path (docs.google.com serves a different icon on
// /spreadsheets vs /document), which no domain-keyed favicon service can see.
const PATH_ICONS = [
  ["docs.google.com", "/spreadsheets", "sheets"],
  ["docs.google.com", "/document", "docs"],
  ["docs.google.com", "/presentation", "slides"],
  ["docs.google.com", "/forms", "forms"],
  ["drive.google.com", "", "drive"],
  ["calendar.google.com", "", "calendar"],
  ["mail.google.com", "", "gmail"],
  ["meet.google.com", "", "meet"],
  ["keep.google.com", "", "keep"],
];

function overrideUrl(u) {
  for (const [host, prefix, name] of PATH_ICONS) {
    if (u.hostname === host && u.pathname.startsWith(prefix)) {
      return `https://www.gstatic.com/images/branding/product/2x/${name}_2020q4_48dp.png`;
    }
  }
  return null;
}

export async function onRequestGet({ request }) {
  let target;
  try {
    target = new URL(new URL(request.url).searchParams.get("url"));
  } catch {
    return new Response("bad url", { status: 400 });
  }
  if (target.protocol !== "https:" && target.protocol !== "http:") {
    return new Response("bad url", { status: 400 });
  }

  const candidates = [
    overrideUrl(target),
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(target.hostname)}&sz=64`,
    `https://icons.duckduckgo.com/ip3/${target.hostname}.ico`,
    `${target.origin}/favicon.ico`,
  ].filter(Boolean);

  for (const url of candidates) {
    let resp;
    try {
      resp = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(4000),
      });
    } catch {
      continue;
    }
    const type = resp.headers.get("Content-Type") || "";
    if (!resp.ok || !type.startsWith("image/")) continue;
    return new Response(resp.body, {
      headers: {
        "Content-Type": type,
        "Cache-Control": "public, max-age=604800",
      },
    });
  }

  return new Response(null, {
    status: 404,
    headers: { "Cache-Control": "public, max-age=86400" },
  });
}
