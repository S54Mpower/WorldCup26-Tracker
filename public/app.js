const API_URL = "/api/worldcup";
const REFRESH_MS = 90_000;
const SLIDE_MS = 12_000;
const GROUP_MS = 6_000;
const HOST_CITIES = 16;
const TOTAL_MATCHES = 104;
const slideEls = [...document.querySelectorAll(".slide")];

let state = {
  competition: null,
  matches: [],
  standings: [],
  teams: [],
  errors: [],
  refreshedAt: null
};
let activeSlide = 0;
let groupIndex = 0;

const els = {
  alertBar: document.querySelector("#alert-bar"),
  groupTitle: document.querySelector("#group-title"),
  lastRefresh: document.querySelector("#last-refresh"),
  localTime: document.querySelector("#local-time"),
  overviewMetrics: document.querySelector("#overview-metrics"),
  resultGrid: document.querySelector("#result-grid"),
  scheduleBoard: document.querySelector("#schedule-board"),
  spotlightDetails: document.querySelector("#spotlight-details"),
  spotlightLabel: document.querySelector("#spotlight-label"),
  spotlightMatch: document.querySelector("#spotlight-match"),
  standingsBoard: document.querySelector("#standings-board"),
  teamWall: document.querySelector("#team-wall"),
  tickerTrack: document.querySelector("#ticker-track")
};

init();

function init() {
  tickClock();
  loadData();
  setInterval(tickClock, 1_000);
  setInterval(loadData, REFRESH_MS);
  setInterval(advanceSlide, SLIDE_MS);
  setInterval(advanceGroup, GROUP_MS);
}

async function loadData() {
  try {
    const response = await fetch(API_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Local API ${response.status}`);
    }
    const data = await response.json();
    state = {
      competition: data.competition || null,
      matches: Array.isArray(data.matches) ? data.matches : [],
      standings: Array.isArray(data.standings) ? data.standings : [],
      teams: Array.isArray(data.teams) ? data.teams : [],
      errors: Array.isArray(data.errors) ? data.errors : [],
      refreshedAt: data.refreshedAt || new Date().toISOString()
    };
  } catch (error) {
    state.errors = [{ label: "local", error: error.message }];
  }

  render();
}

function render() {
  renderStatus();
  renderSpotlight();
  renderMetrics();
  renderResults();
  renderSchedule();
  renderStandings();
  renderTeams();
  renderTicker();
}

function renderStatus() {
  const relevantErrors = state.errors.filter((error) => error.label !== "standings" || !state.standings.length);
  if (relevantErrors.length) {
    const labels = relevantErrors.map((error) => error.label).join(", ");
    els.alertBar.textContent = `API status: ${labels} unavailable. Dashboard is continuing with the latest cached or available data.`;
    els.alertBar.hidden = false;
  } else {
    els.alertBar.hidden = true;
  }

  els.lastRefresh.textContent = state.refreshedAt
    ? `Updated ${formatTime(state.refreshedAt)}`
    : "Waiting for data";
}

function renderSpotlight() {
  const live = sortedMatches().find((match) => ["IN_PLAY", "PAUSED", "LIVE"].includes(match.status));
  const next = sortedMatches().find((match) => !isComplete(match) && new Date(match.utcDate) >= new Date());
  const latest = [...sortedMatches()].reverse().find(isComplete);
  const spotlight = live || next || latest;

  if (!spotlight) {
    els.spotlightLabel.textContent = "Tournament Countdown";
    els.spotlightMatch.innerHTML = emptyBlock("World Cup 2026 data pending", "Live fixtures and results will appear here as soon as the API returns matches.");
    els.spotlightDetails.innerHTML = detailPills([
      `Opening day ${formatDate("2026-06-11")}`,
      `${HOST_CITIES} host cities`,
      `${TOTAL_MATCHES} matches`
    ]);
    return;
  }

  els.spotlightLabel.textContent = live ? "Live Now" : isComplete(spotlight) ? "Latest Result" : "Next Match";
  els.spotlightMatch.innerHTML = matchupMarkup(spotlight, true);
  els.spotlightDetails.innerHTML = detailPills(matchDetails(spotlight));
}

function renderMetrics() {
  const matches = state.matches;
  const complete = matches.filter(isComplete);
  const scheduled = matches.filter((match) => !isComplete(match));
  const live = matches.filter((match) => ["IN_PLAY", "PAUSED", "LIVE"].includes(match.status));
  const goals = complete.reduce((total, match) => total + scoreValue(match, "home") + scoreValue(match, "away"), 0);
  const season = state.competition?.currentSeason || {};

  els.overviewMetrics.innerHTML = [
    metricMarkup("Matches", matches.length || TOTAL_MATCHES, "competition schedule"),
    metricMarkup("Completed", complete.length, `${Math.max(TOTAL_MATCHES - complete.length, 0)} still ahead`),
    metricMarkup("Live", live.length, live.length === 1 ? "match in progress" : "matches in progress"),
    metricMarkup("Goals", goals, complete.length ? `${(goals / complete.length).toFixed(2)} per match` : "awaiting kickoff"),
    metricMarkup("Matchday", season.currentMatchday || 1, `${formatDate(season.startDate || "2026-06-11")} to ${formatDate(season.endDate || "2026-07-19")}`),
    metricMarkup("Hosts", HOST_CITIES, "Canada, Mexico, United States")
  ].join("");
}

function renderResults() {
  const finished = [...sortedMatches()]
    .filter(isComplete)
    .reverse()
    .slice(0, 8);

  els.resultGrid.classList.toggle("is-empty", !finished.length);
  els.resultGrid.innerHTML = finished.length
    ? finished.map((match) => matchCardMarkup(match)).join("")
    : emptyBlock("No completed matches yet", "Results will roll in here throughout the tournament.");
}

function renderSchedule() {
  const upcoming = sortedMatches()
    .filter((match) => !isComplete(match))
    .slice(0, 10);

  els.scheduleBoard.classList.toggle("is-empty", !upcoming.length);
  els.scheduleBoard.innerHTML = upcoming.length
    ? upcoming.map((match, index) => scheduleRowMarkup(match, index)).join("")
    : emptyBlock("No upcoming fixtures returned", "The dashboard will keep checking for schedule updates.");
}

function renderStandings() {
  const tables = groupTables();
  if (!tables.length) {
    els.groupTitle.textContent = "Standings";
    els.standingsBoard.innerHTML = emptyBlock("Group standings pending", "Tables appear automatically when the API publishes them.");
    return;
  }

  const standing = tables[groupIndex % tables.length];
  els.groupTitle.textContent = formatLabel(standing.group || standing.stage || standing.type || "Standings");
  els.standingsBoard.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Team</th>
          <th>MP</th>
          <th>W</th>
          <th>D</th>
          <th>L</th>
          <th>GD</th>
          <th>Pts</th>
        </tr>
      </thead>
      <tbody>
        ${standing.table.slice(0, 8).map(standingRowMarkup).join("")}
      </tbody>
    </table>
  `;
}

function renderTeams() {
  const teams = state.teams.slice(0, 48);
  els.teamWall.classList.toggle("is-empty", !teams.length);
  els.teamWall.innerHTML = teams.length
    ? teams.map(teamMarkup).join("")
    : emptyBlock("Teams loading", "Qualified nations will appear here when available from the API.");
}

function renderTicker() {
  const items = [
    ...sortedMatches().filter(isComplete).reverse().slice(0, 8).map(tickerItem),
    ...sortedMatches().filter((match) => !isComplete(match)).slice(0, 12).map(tickerItem)
  ];

  const fallback = [
    "FIFA World Cup 2026 opens June 11",
    `${TOTAL_MATCHES} matches across ${HOST_CITIES} host cities`,
    "Deepwater Skyros stream desk online"
  ];
  const content = items.length ? items : fallback;
  els.tickerTrack.innerHTML = [...content, ...content].map((item) => `<span>${escapeHtml(item)}</span>`).join("");
}

function matchupMarkup(match, large = false) {
  const home = match.homeTeam || {};
  const away = match.awayTeam || {};
  const homeScore = scoreDisplay(match, "home");
  const awayScore = scoreDisplay(match, "away");

  return `
    <div class="team ${large ? "large" : ""}">
      ${crestMarkup(home)}
      <span>${escapeHtml(teamName(home))}</span>
    </div>
    <div class="score-block">
      <span>${homeScore}</span>
      <small>${statusLabel(match)}</small>
      <span>${awayScore}</span>
    </div>
    <div class="team ${large ? "large" : ""}">
      ${crestMarkup(away)}
      <span>${escapeHtml(teamName(away))}</span>
    </div>
  `;
}

function matchCardMarkup(match) {
  return `
    <section class="result-card">
      <div class="match-meta">
        <span>${formatDate(match.utcDate)}</span>
        <span>${stageLabel(match)}</span>
      </div>
      <div class="compact-matchup">${matchupMarkup(match)}</div>
    </section>
  `;
}

function scheduleRowMarkup(match, index) {
  return `
    <section class="schedule-row">
      <div class="schedule-time">
        <strong>${formatDay(match.utcDate)}</strong>
        <span>${formatTime(match.utcDate)}</span>
      </div>
      <div class="schedule-main">
        <div class="schedule-teams">
          <span>${escapeHtml(teamName(match.homeTeam))}</span>
          <b>vs</b>
          <span>${escapeHtml(teamName(match.awayTeam))}</span>
        </div>
        <small>${[stageLabel(match), formatLabel(match.group), match.venue].filter(Boolean).join(" • ")}</small>
      </div>
      <div class="row-number">${String(index + 1).padStart(2, "0")}</div>
    </section>
  `;
}

function standingRowMarkup(row) {
  const gd = Number(row.goalDifference || 0);
  return `
    <tr>
      <td>
        <span class="table-team">${crestMarkup(row.team)} ${escapeHtml(teamName(row.team))}</span>
      </td>
      <td>${row.playedGames ?? 0}</td>
      <td>${row.won ?? 0}</td>
      <td>${row.draw ?? 0}</td>
      <td>${row.lost ?? 0}</td>
      <td>${gd > 0 ? `+${gd}` : gd}</td>
      <td><strong>${row.points ?? 0}</strong></td>
    </tr>
  `;
}

function teamMarkup(team) {
  return `
    <section class="team-tile">
      ${crestMarkup(team)}
      <span>${escapeHtml(team.tla || shortName(team))}</span>
      <small>${escapeHtml(shortName(team))}</small>
    </section>
  `;
}

function tickerItem(match) {
  const score = isComplete(match)
    ? `${scoreDisplay(match, "home")}-${scoreDisplay(match, "away")}`
    : formatTime(match.utcDate);
  return `${tickerDateLabel(match.utcDate)}: ${teamName(match.homeTeam)} ${score} ${teamName(match.awayTeam)}`;
}

function detailPills(items) {
  return items.map((item) => `<span>${escapeHtml(item)}</span>`).join("");
}

function matchDetails(match) {
  return [
    formatDateTime(match.utcDate),
    stageLabel(match),
    formatLabel(match.group),
    match.venue
  ].filter(Boolean);
}

function metricMarkup(label, value, caption) {
  return `
    <section class="metric">
      <p>${escapeHtml(label)}</p>
      <strong>${escapeHtml(String(value))}</strong>
      <span>${escapeHtml(caption)}</span>
    </section>
  `;
}

function crestMarkup(team = {}) {
  if (team.crest) {
    return `<img src="${escapeAttr(team.crest)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`;
  }
  const initials = (team.tla || team.shortName || team.name || "WC").slice(0, 3).toUpperCase();
  return `<i>${escapeHtml(initials)}</i>`;
}

function emptyBlock(title, detail) {
  return `
    <section class="empty-state">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(detail)}</span>
    </section>
  `;
}

function advanceSlide() {
  slideEls[activeSlide].classList.remove("active");
  activeSlide = (activeSlide + 1) % slideEls.length;
  slideEls[activeSlide].classList.add("active");
}

function advanceGroup() {
  const tables = groupTables();
  if (!tables.length) {
    return;
  }
  groupIndex = (groupIndex + 1) % tables.length;
  if (slideEls[activeSlide]?.dataset.slide === "groups") {
    renderStandings();
  }
}

function tickClock() {
  els.localTime.textContent = new Intl.DateTimeFormat([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date());
}

function sortedMatches() {
  return [...state.matches].sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));
}

function isComplete(match) {
  return match.status === "FINISHED" || match.status === "AWARDED";
}

function scoreDisplay(match, side) {
  if (!hasScore(match) && !["IN_PLAY", "PAUSED", "LIVE"].includes(match.status)) {
    return "-";
  }
  const value = scoreValue(match, side);
  return Number.isFinite(value) ? String(value) : "0";
}

function scoreValue(match, side) {
  const v2Key = side === "home" ? "homeTeam" : "awayTeam";
  const candidates = [
    match.score?.fullTime?.[side],
    match.score?.fullTime?.[v2Key],
    match.score?.regularTime?.[side],
    match.score?.regularTime?.[v2Key]
  ];
  const value = candidates.find((candidate) => Number.isFinite(candidate));
  return Number.isFinite(value) ? value : 0;
}

function hasScore(match) {
  return ["home", "away", "homeTeam", "awayTeam"].some((key) => {
    const value = match.score?.fullTime?.[key] ?? match.score?.regularTime?.[key];
    return Number.isFinite(value);
  });
}

function statusLabel(match) {
  if (!match.status) {
    return "TBD";
  }
  if (match.status === "TIMED" || match.status === "SCHEDULED") {
    return formatTime(match.utcDate);
  }
  return match.status.replaceAll("_", " ");
}

function stageLabel(match) {
  return formatLabel(match.stage || match.matchday || "Match");
}

function formatLabel(value) {
  return value ? value.toString().replaceAll("_", " ") : "";
}

function teamName(team = {}) {
  return team.shortName || team.name || team.tla || "TBD";
}

function shortName(team = {}) {
  return team.shortName || team.name || team.tla || "TBD";
}

function formatDate(value) {
  if (!value) {
    return "TBD";
  }
  return new Intl.DateTimeFormat([], { month: "short", day: "numeric" }).format(new Date(value));
}

function formatDay(value) {
  return new Intl.DateTimeFormat([], { weekday: "short", month: "short", day: "numeric" }).format(new Date(value));
}

function formatTime(value) {
  if (!value) {
    return "--:--";
  }
  return new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatDateTime(value) {
  if (!value) {
    return "TBD";
  }
  return new Intl.DateTimeFormat([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function tickerDateLabel(value) {
  if (!value) {
    return "TBD";
  }

  const matchDate = new Date(value);
  const today = startOfLocalDay(new Date());
  const matchDay = startOfLocalDay(matchDate);
  const dayDiff = Math.round((matchDay - today) / 86_400_000);

  if (dayDiff === 0) {
    return "TODAY";
  }
  if (dayDiff === 1) {
    return "TOMORROW";
  }

  const day = String(matchDate.getDate()).padStart(2, "0");
  const month = String(matchDate.getMonth() + 1).padStart(2, "0");
  return `${day}.${month}`;
}

function startOfLocalDay(value) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function groupTables() {
  const totalStanding = state.standings.find((standing) => standing.type === "TOTAL") || state.standings[0];
  const rows = totalStanding?.table;
  if (!Array.isArray(rows) || !rows.length) {
    return [];
  }

  const rowByTeamId = new Map(rows.map((row) => [row.team?.id, row]));
  const groups = new Map();
  state.matches
    .filter((match) => match.stage === "GROUP_STAGE" && match.group)
    .forEach((match) => {
      if (!groups.has(match.group)) {
        groups.set(match.group, new Set());
      }
      const teams = groups.get(match.group);
      if (match.homeTeam?.id) {
        teams.add(match.homeTeam.id);
      }
      if (match.awayTeam?.id) {
        teams.add(match.awayTeam.id);
      }
    });

  if (!groups.size) {
    return [totalStanding];
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([group, teamIds]) => ({
      stage: "GROUP_STAGE",
      type: "TOTAL",
      group,
      table: [...teamIds].map((teamId) => rowByTeamId.get(teamId)).filter(Boolean)
    }));
}
