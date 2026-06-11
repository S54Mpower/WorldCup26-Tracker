import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const apiBase = "https://api.football-data.org/v4";
const port = Number(process.env.PORT || loadEnv().PORT || 4326);
const token = process.env.FOOTBALL_DATA_TOKEN || loadEnv().FOOTBALL_DATA_TOKEN || "";
const cacheMs = Number(process.env.CACHE_MS || 30_000);

let cachedPayload = null;
let cachedAt = 0;
let inFlight = null;

function loadEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!existsSync(envPath)) {
    return {};
  }

  return readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .reduce((env, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        return env;
      }
      const [key, ...valueParts] = trimmed.split("=");
      env[key] = valueParts.join("=").replace(/^["']|["']$/g, "");
      return env;
    }, {});
}

async function requestFootballData(endpoint) {
  if (!token) {
    throw new Error("Missing FOOTBALL_DATA_TOKEN");
  }

  const response = await fetchWithRetry(`${apiBase}${endpoint}`, {
    headers: {
      "X-Auth-Token": token,
      Accept: "application/json"
    }
  });

  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }

  if (!response.ok) {
    const message = body?.message || response.statusText || "football-data request failed";
    const error = new Error(`${response.status} ${message}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }

  return body;
}

async function fetchWithRetry(url, options) {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await fetch(url, options);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
  }
  throw lastError;
}

async function safeApi(label, endpoint) {
  try {
    return { label, ok: true, data: await requestFootballData(endpoint) };
  } catch (error) {
    return {
      label,
      ok: false,
      error: error.message,
      status: error.status || 500,
      body: error.body || null
    };
  }
}

async function getWorldCupData(force = false) {
  const now = Date.now();
  if (!force && cachedPayload && now - cachedAt < cacheMs) {
    return { ...cachedPayload, cached: true };
  }

  if (!inFlight) {
    inFlight = Promise.all([
      safeApi("competition", "/competitions/WC"),
      safeApi("matches", "/competitions/WC/matches?season=2026"),
      safeApi("standings", "/competitions/WC/standings?season=2026"),
      safeApi("teams", "/competitions/WC/teams?season=2026")
    ])
      .then((results) => {
        const byLabel = Object.fromEntries(results.map((result) => [result.label, result]));
        const payload = {
          source: "football-data.org",
          refreshedAt: new Date().toISOString(),
          competition: byLabel.competition?.data || fallbackCompetition(),
          matches: byLabel.matches?.data?.matches || [],
          standings: byLabel.standings?.data?.standings || [],
          teams: byLabel.teams?.data?.teams || [],
          errors: results.filter((result) => !result.ok).map(({ label, error, status, body }) => ({
            label,
            error,
            status,
            message: body?.message || null
          }))
        };

        const hasUsefulData = payload.matches.length || payload.teams.length || payload.standings.length;
        if (hasUsefulData || !cachedPayload) {
          cachedPayload = payload;
          cachedAt = Date.now();
          return payload;
        }

        return {
          ...cachedPayload,
          cached: true,
          stale: true,
          errors: payload.errors
        };
      })
      .finally(() => {
        inFlight = null;
      });
  }

  return inFlight;
}

function fallbackCompetition() {
  return {
    id: 2000,
    name: "FIFA World Cup",
    code: "WC",
    currentSeason: {
      startDate: "2026-06-11",
      endDate: "2026-07-19",
      currentMatchday: 1,
      winner: null
    }
  };
}

function contentType(filePath) {
  const ext = path.extname(filePath);
  return {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml; charset=utf-8"
  }[ext] || "application/octet-stream";
}

async function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requestedPath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const safePath = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(publicDir, safePath);

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const file = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": contentType(filePath),
      "Cache-Control": "no-store"
    });
    res.end(file);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/api/worldcup") {
      const force = url.searchParams.get("force") === "1";
      await sendJson(res, 200, await getWorldCupData(force));
      return;
    }

    await serveStatic(req, res);
  } catch (error) {
    await sendJson(res, 500, { error: error.message });
  }
});

server.listen(port, () => {
  console.log(`World Cup OBS dashboard: http://localhost:${port}`);
  if (!token) {
    console.log("Set FOOTBALL_DATA_TOKEN in .env or the environment to enable live API data.");
  }
});
