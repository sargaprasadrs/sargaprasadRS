/**
 * GitHub Profile Pet — local dev server (zero dependencies).
 *
 *  - Serves the static site (index.html, styles.css, app.js, ...)
 *  - Proxies POST /graphql -> https://api.github.com/graphql using the token
 *    from .env, so your GitHub token NEVER leaves this machine / server.
 *
 * Run:  node server.mjs   (or: npm start)
 * Then: open http://localhost:8787
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8787;
const GITHUB_GRAPHQL = "https://api.github.com/graphql";

/* ---------- .env loading (no dependencies) ---------- */
function loadToken() {
  try {
    process.loadEnvFile(path.join(ROOT, ".env")); // Node >= 20.6
  } catch {
    try {
      const raw = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
      for (const line of raw.split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    } catch {
      /* no .env file — browser-token / demo modes still work */
    }
  }
  return process.env.GITHUB_TOKEN || "";
}
const TOKEN = loadToken();

/* ---------- static file serving ---------- */
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

function serveStatic(req, res, urlPath) {
  let filePath;
  try {
    filePath = decodeURIComponent(urlPath.split("?")[0]);
  } catch {
    return sendJson(res, 400, { ok: false, error: "Bad request" });
  }
  if (filePath === "/") filePath = "/index.html";
  const abs = path.normalize(path.join(ROOT, filePath));
  const rel = path.relative(ROOT, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return sendJson(res, 403, { ok: false, error: "Forbidden" });
  }
  fs.readFile(abs, (err, data) => {
    if (err) return sendJson(res, 404, { ok: false, error: "Not found" });
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(abs).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(data);
  });
}

function sendJson(res, status, obj) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => resolve(body));
    req.on("error", () => resolve(""));
  });
}

/* ---------- GraphQL proxy ---------- */
async function proxyGraphQL(req, res) {
  const body = await readBody(req);
  let parsed;
  try {
    parsed = JSON.parse(body || "{}");
  } catch {
    return sendJson(res, 400, { ok: false, error: "Invalid JSON body" });
  }

  if (!TOKEN) {
    // Proxy exists but no token configured -> tell the page clearly.
    return sendJson(res, 200, { ok: false, code: "NO_TOKEN", message: "No GITHUB_TOKEN in .env" });
  }

  try {
    const upstream = await fetch(GITHUB_GRAPHQL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
        "User-Agent": "github-profile-pet",
      },
      body: JSON.stringify({
        query: parsed.query,
        variables: parsed.variables || {},
      }),
    });
    const data = await upstream.json();
    sendJson(res, upstream.status, { ok: true, ...data });
  } catch (e) {
    sendJson(res, 502, { ok: false, error: "Upstream request failed: " + e.message });
  }
}

/* ---------- server ---------- */
const server = http.createServer(async (req, res) => {
  const url = req.url || "/";
  const method = req.method || "GET";

  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    });
    return res.end();
  }

  if (url.startsWith("/graphql")) {
    if (method === "GET") {
      // Probe endpoint: lets the page detect proxy mode + token presence.
      return sendJson(res, 200, { ok: true, mode: "proxy", hasToken: !!TOKEN });
    }
    if (method === "POST") return proxyGraphQL(req, res);
    return sendJson(res, 405, { ok: false, error: "Method not allowed" });
  }

  serveStatic(req, res, url);
});

server.listen(PORT, () => {
  const tokenState = TOKEN ? "TOKEN LOADED (proxy mode ready)" : "NO TOKEN (.env missing) — use browser-token or demo mode";
  console.log("");
  console.log("  === GITHUB PROFILE PET ===");
  console.log(`  - http://localhost:${PORT}`);
  console.log(`  - ${tokenState}`);
  console.log("");
});
