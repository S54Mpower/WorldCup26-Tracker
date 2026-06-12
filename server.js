import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const apiBase = "https://api.football-data.org/v4";
const fifaApiBase = "https://api.fifa.com/api/v3";
const port = Number(process.env.PORT || loadEnv().PORT || 4326);
const token = process.env.FOOTBALL_DATA_TOKEN || loadEnv().FOOTBALL_DATA_TOKEN || "";
const fifaLiveEnabled = (process.env.FIFA_LIVE_ENABLED || loadEnv().FIFA_LIVE_ENABLED || "true") !== "false";
const demoLiveEnabled = isTruthy(process.env.DEMO_LIVE || process.env.demo_live || loadEnv().DEMO_LIVE || loadEnv().demo_live);
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

async function requestFifa(endpoint) {
  const response = await fetchWithRetry(`${fifaApiBase}${endpoint}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "WorldCup26-Tracker/1.0"
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
    const message = body?.Message || body?.message || response.statusText || "FIFA request failed";
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

async function safeFifaLive(matches) {
  if (!fifaLiveEnabled || !matches.length) {
    return { ok: true, matches, error: null };
  }

  try {
    return { ok: true, matches: await enrichMatchesWithFifa(matches), error: null };
  } catch (error) {
    return {
      ok: false,
      matches,
      error: {
        label: "fifa-live",
        error: error.message,
        status: error.status || 500,
        message: error.body?.Message || error.body?.message || null
      }
    };
  }
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

async function getWorldCupData(force = false, demoLive = false) {
  const now = Date.now();
  if (!force && cachedPayload && now - cachedAt < cacheMs) {
    const payload = { ...cachedPayload, cached: true };
    return demoLive ? withDemoLive(payload) : payload;
  }

  if (!inFlight) {
    inFlight = Promise.all([
      safeApi("competition", "/competitions/WC"),
      safeApi("matches", "/competitions/WC/matches?season=2026"),
      safeApi("standings", "/competitions/WC/standings?season=2026"),
      safeApi("teams", "/competitions/WC/teams?season=2026")
    ])
      .then(async (results) => {
        const byLabel = Object.fromEntries(results.map((result) => [result.label, result]));
        const fifaLive = await safeFifaLive(byLabel.matches?.data?.matches || []);
        const payload = {
          source: fifaLiveEnabled ? "football-data.org + FIFA live" : "football-data.org",
          refreshedAt: new Date().toISOString(),
          competition: byLabel.competition?.data || fallbackCompetition(),
          matches: fifaLive.matches,
          standings: byLabel.standings?.data?.standings || [],
          teams: byLabel.teams?.data?.teams || [],
          errors: [
            ...results.filter((result) => !result.ok).map(({ label, error, status, body }) => ({
              label,
              error,
              status,
              message: body?.message || null
            })),
            ...(fifaLive.error ? [fifaLive.error] : [])
          ]
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

  const payload = await inFlight;
  return demoLive ? withDemoLive(payload) : payload;
}

function withDemoLive(payload) {
  const demoMatch = demoLiveMatch();
  const matches = Array.isArray(payload.matches) ? payload.matches : [];
  return {
    ...payload,
    source: `${payload.source || "demo"} + demo live`,
    demo: "live",
    refreshedAt: new Date().toISOString(),
    competition: payload.competition || fallbackCompetition(),
    matches: [demoMatch, ...matches.filter((match) => match.id !== demoMatch.id)],
    errors: []
  };
}

function demoLiveMatch() {
  return {
    id: "demo-live",
    status: "IN_PLAY",
    clock: "76'",
    minute: 76,
    utcDate: new Date(Date.now() - 76 * 60 * 1000).toISOString(),
    stage: "GROUP_STAGE",
    group: "GROUP A",
    venue: "Demo Stadium, OBS Preview",
    homeTeam: { id: "demo-home", name: "Mexico", shortName: "Mexico", tla: "MEX" },
    awayTeam: { id: "demo-away", name: "South Africa", shortName: "South Africa", tla: "RSA" },
    score: {
      winner: null,
      duration: "REGULAR",
      fullTime: { home: 4, away: 3 },
      regularTime: { home: 4, away: 3 },
      halfTime: { home: 2, away: 1 }
    },
    goals: [
      demoEvent("7'", "Julian QUINONES", "Goal", "Mexico"),
      demoEvent("18'", "Hirving LOZANO", "Goal", "Mexico"),
      demoEvent("31'", "Themba ZWANE", "Goal", "South Africa"),
      demoEvent("49'", "Santiago GIMENEZ", "Goal", "Mexico"),
      demoEvent("54'", "Evidence MAKGOPA", "Goal", "South Africa"),
      demoEvent("68'", "Edson ALVAREZ", "Goal", "Mexico"),
      demoEvent("74'", "Teboho MOKOENA", "Penalty", "South Africa")
    ],
    bookings: [
      demoEvent("12'", "Brian GUTIERREZ", "Yellow card", "Mexico"),
      demoEvent("22'", "Aubrey MODIBA", "Yellow card", "South Africa"),
      demoEvent("36'", "Cesar MONTES", "Yellow card", "Mexico"),
      demoEvent("41'", "Mbekezeli MBOKAZI", "Yellow card", "South Africa"),
      demoEvent("55'", "Luis CHAVEZ", "Yellow card", "Mexico"),
      demoEvent("62'", "Ronwen WILLIAMS", "Yellow card", "South Africa"),
      demoEvent("69'", "Johan VASQUEZ", "Yellow card", "Mexico"),
      demoEvent("72'", "Teboho MOKOENA", "Yellow card", "South Africa"),
      demoEvent("78'", "Gerardo ARTEAGA", "Red card", "Mexico"),
      demoEvent("82'", "Khuliso MUDAU", "Yellow card", "South Africa"),
      demoEvent("88'", "Erick SANCHEZ", "Yellow card", "Mexico")
    ],
    referees: [{ name: "Wilton SAMPAIO", type: "Referee", nationality: "BRA" }]
  };
}

function demoEvent(minute, playerName, detail, teamName) {
  return { minute, playerName, detail, teamName };
}

async function enrichMatchesWithFifa(matches) {
  const calendar = await requestFifa("/calendar/matches?language=en&count=500&idCompetition=17&idSeason=285023");
  const fifaMatches = Array.isArray(calendar?.Results) ? calendar.Results : [];
  if (!fifaMatches.length) {
    return matches;
  }

  const detailsById = new Map();
  const liveFifaMatches = fifaMatches.filter(isFifaLiveMatch);
  await Promise.all(liveFifaMatches.map(async (match) => {
    const detail = await requestFifa(`/live/football/${match.IdCompetition}/${match.IdSeason}/${match.IdStage}/${match.IdMatch}?language=en`);
    detailsById.set(match.IdMatch, detail);
  }));

  return matches.map((match) => {
    const fifaMatch = findFifaMatch(match, fifaMatches);
    if (!fifaMatch) {
      return match;
    }

    const fifaDetail = detailsById.get(fifaMatch.IdMatch);
    return mergeFifaMatch(match, fifaDetail || fifaMatch);
  });
}

function findFifaMatch(match, fifaMatches) {
  const kickoff = new Date(match.utcDate).getTime();
  const homeCode = normalizedTeamCode(match.homeTeam);
  const awayCode = normalizedTeamCode(match.awayTeam);
  const homeName = normalizeText(teamDisplayName(match.homeTeam));
  const awayName = normalizeText(teamDisplayName(match.awayTeam));

  return fifaMatches.find((fifaMatch) => {
    const fifaKickoff = new Date(fifaMatch.Date).getTime();
    const sameWindow = Number.isFinite(kickoff)
      && Number.isFinite(fifaKickoff)
      && Math.abs(kickoff - fifaKickoff) < 4 * 60 * 60 * 1000;
    if (!sameWindow) {
      return false;
    }

    const fifaHomeCode = normalizeText(fifaMatch.Home?.Abbreviation || fifaMatch.Home?.IdCountry || "");
    const fifaAwayCode = normalizeText(fifaMatch.Away?.Abbreviation || fifaMatch.Away?.IdCountry || "");
    const fifaHomeName = normalizeText(fifaTeamName(fifaMatch.Home));
    const fifaAwayName = normalizeText(fifaTeamName(fifaMatch.Away));

    return (homeCode && awayCode && homeCode === fifaHomeCode && awayCode === fifaAwayCode)
      || (homeName && awayName && homeName === fifaHomeName && awayName === fifaAwayName);
  });
}

function mergeFifaMatch(match, fifaMatch) {
  const homeScore = fifaMatch.HomeTeam?.Score ?? fifaMatch.Home?.Score;
  const awayScore = fifaMatch.AwayTeam?.Score ?? fifaMatch.Away?.Score;
  const live = isFifaLiveMatch(fifaMatch);
  const minute = minuteFromFifaClock(fifaMatch.MatchTime);
  const status = fifaMatchStatus(fifaMatch) || match.status;

  return {
    ...match,
    source: match.source ? `${match.source}, fifa` : "fifa",
    fifaMatchId: fifaMatch.IdMatch,
    status,
    minute: Number.isFinite(minute) ? minute : match.minute,
    clock: fifaMatch.MatchTime || match.clock,
    venue: fifaVenue(fifaMatch) || match.venue,
    score: mergeScore(match.score, homeScore, awayScore),
    homeTeam: mergeFifaTeam(match.homeTeam, fifaMatch.HomeTeam || fifaMatch.Home),
    awayTeam: mergeFifaTeam(match.awayTeam, fifaMatch.AwayTeam || fifaMatch.Away),
    goals: [
      ...fifaEventsForTeam(fifaMatch.HomeTeam || fifaMatch.Home, "home", "Goal"),
      ...fifaEventsForTeam(fifaMatch.AwayTeam || fifaMatch.Away, "away", "Goal")
    ].sort(compareEventMinute),
    bookings: [
      ...fifaBookingsForTeam(fifaMatch.HomeTeam || fifaMatch.Home, "home"),
      ...fifaBookingsForTeam(fifaMatch.AwayTeam || fifaMatch.Away, "away")
    ].sort(compareEventMinute),
    referees: fifaOfficials(fifaMatch.Officials).length ? fifaOfficials(fifaMatch.Officials) : match.referees
  };
}

function mergeScore(score = {}, homeScore, awayScore) {
  if (!Number.isFinite(homeScore) && !Number.isFinite(awayScore)) {
    return score;
  }

  return {
    ...score,
    fullTime: {
      ...(score.fullTime || {}),
      home: Number.isFinite(homeScore) ? homeScore : score.fullTime?.home,
      away: Number.isFinite(awayScore) ? awayScore : score.fullTime?.away
    },
    regularTime: {
      ...(score.regularTime || {}),
      home: Number.isFinite(homeScore) ? homeScore : score.regularTime?.home,
      away: Number.isFinite(awayScore) ? awayScore : score.regularTime?.away
    }
  };
}

function mergeFifaTeam(team = {}, fifaTeam = {}) {
  fifaTeam = fifaTeam || {};
  const fifaName = fifaTeamName(fifaTeam);
  const code = fifaTeam.Abbreviation || fifaTeam.IdCountry;
  return {
    ...team,
    name: team.name || fifaName,
    shortName: team.shortName || fifaTeam.ShortClubName || fifaName,
    tla: team.tla || code,
    crest: team.crest || fifaFlagUrl(fifaTeam.PictureUrl)
  };
}

function fifaEventsForTeam(team = {}, side, fallbackDetail) {
  team = team || {};
  const players = playerMap(team.Players);
  return (Array.isArray(team.Goals) ? team.Goals : []).map((goal) => ({
    minute: goal.Minute,
    playerName: players.get(goal.IdPlayer) || "Player",
    teamName: fifaTeamName(team),
    side,
    type: "GOAL",
    detail: goal.Type === 4 ? "Own goal" : fallbackDetail
  }));
}

function fifaBookingsForTeam(team = {}, side) {
  team = team || {};
  const players = playerMap(team.Players);
  return (Array.isArray(team.Bookings) ? team.Bookings : []).map((booking) => ({
    minute: booking.Minute,
    playerName: players.get(booking.IdPlayer) || "Player",
    teamName: fifaTeamName(team),
    side,
    type: booking.Card === 2 ? "RED_CARD" : "YELLOW_CARD",
    detail: booking.Card === 2 ? "Red card" : "Yellow card"
  }));
}

function playerMap(players = []) {
  return new Map((Array.isArray(players) ? players : []).map((player) => [
    player.IdPlayer,
    localizedText(player.ShortName) || localizedText(player.PlayerName)
  ]));
}

function fifaOfficials(officials = []) {
  return (Array.isArray(officials) ? officials : []).map((official) => ({
    name: localizedText(official.NameShort) || localizedText(official.Name),
    type: localizedText(official.TypeLocalized) || "Official",
    nationality: official.IdCountry || ""
  }));
}

function compareEventMinute(a, b) {
  return minuteFromFifaClock(a.minute) - minuteFromFifaClock(b.minute);
}

function isFifaLiveMatch(match) {
  return match?.MatchStatus === 3;
}

function fifaMatchStatus(match) {
  if (match?.MatchStatus === 3) {
    return "IN_PLAY";
  }
  if (match?.MatchStatus === 0) {
    return "FINISHED";
  }
  return null;
}

function minuteFromFifaClock(value) {
  const minute = String(value || "").match(/\d+/)?.[0];
  return minute ? Number(minute) : null;
}

function fifaVenue(match) {
  const stadium = localizedText(match?.Stadium?.Name);
  const city = localizedText(match?.Stadium?.CityName);
  return [stadium, city].filter(Boolean).join(", ");
}

function fifaTeamName(team = {}) {
  team = team || {};
  return team.ShortClubName || localizedText(team.TeamName) || "";
}

function fifaFlagUrl(value) {
  return value ? value.replace("{format}", "png").replace("{size}", "4") : "";
}

function localizedText(values = []) {
  if (!Array.isArray(values)) {
    return "";
  }
  return values.find((value) => value.Locale === "en-GB")?.Description
    || values[0]?.Description
    || "";
}

function normalizedTeamCode(team = {}) {
  return normalizeText(team.tla || team.code || "");
}

function teamDisplayName(team = {}) {
  return team.shortName || team.name || team.tla || "";
}

function normalizeText(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isTruthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
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
      const demoLive = demoLiveEnabled || url.searchParams.get("demo") === "live";
      await sendJson(res, 200, await getWorldCupData(force, demoLive));
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
