const API_URL = "/api/worldcup";
const REFRESH_MS = 30_000;
const SLIDE_MS = 12_000;
const LIVE_SLIDE_MS = 18_000;
const GROUP_SLIDE_MS = 17_000;
const GROUP_MS = 6_000;
const HOST_CITIES = 16;
const TOTAL_MATCHES = 104;
const LIVE_WINDOW_MS = 150 * 60 * 1000;
const LIVE_STATUSES = new Set(["IN_PLAY", "PAUSED", "LIVE"]);
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
let slideCycle = 0;
let slideTimer = null;

const els = {
  alertBar: document.querySelector("#alert-bar"),
  lastRefresh: document.querySelector("#last-refresh"),
  liveCards: document.querySelector("#live-cards"),
  liveDetails: document.querySelector("#live-details"),
  liveScoreline: document.querySelector("#live-scoreline"),
  liveScorers: document.querySelector("#live-scorers"),
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
  scheduleNextSlide();
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
  renderLive();
  renderMetrics();
  renderResults();
  renderSchedule();
  renderStandings();
  renderTeams();
  renderTicker();
  syncActiveSlide();
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
  const live = getLiveMatch();
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
  els.spotlightMatch.innerHTML = matchupMarkup(spotlight, { large: true });
  els.spotlightDetails.innerHTML = detailPills(matchDetails(spotlight));
}

function renderLive() {
  const match = getLiveMatch();
  if (!match) {
    els.liveScoreline.innerHTML = "";
    els.liveDetails.innerHTML = "";
    els.liveScorers.innerHTML = "";
    els.liveCards.innerHTML = "";
    return;
  }

  els.liveScoreline.innerHTML = liveScorelineMarkup(match);
  els.liveDetails.innerHTML = detailPills([
    matchClockLabel(match),
    formatLabel(match.group),
    stageLabel(match),
    match.venue,
    refereeLabel(match)
  ].filter(Boolean));
  els.liveScorers.innerHTML = eventListMarkup(goalEvents(match), "Scorer data pending");
  els.liveCards.innerHTML = eventListMarkup(cardEvents(match), "Card data pending");
}

function renderMetrics() {
  const matches = state.matches;
  const complete = matches.filter(isComplete);
  const scheduled = matches.filter((match) => !isComplete(match));
  const live = matches.filter(isLiveMatch);
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
    els.standingsBoard.innerHTML = emptyBlock("Group standings pending", "Tables appear automatically when the API publishes them.");
    return;
  }

  const visibleTables = Array.from({ length: Math.min(4, tables.length) }, (_, offset) => (
    tables[(groupIndex + offset) % tables.length]
  ));

  els.standingsBoard.innerHTML = `
    ${visibleTables.map(groupTableMarkup).join("")}
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

function matchupMarkup(match, options = {}) {
  const large = Boolean(options.large);
  const compact = Boolean(options.compact);
  const home = match.homeTeam || {};
  const away = match.awayTeam || {};
  const homeScore = scoreDisplay(match, "home");
  const awayScore = scoreDisplay(match, "away");

  return `
    <div class="team ${large ? "large" : ""} ${compact ? "compact-code" : ""}">
      ${crestMarkup(home)}
      <span>${escapeHtml(compact ? teamCode(home) : teamName(home))}</span>
    </div>
    <div class="score-block">
      <span>${homeScore}</span>
      <small>${statusLabel(match)}</small>
      <span>${awayScore}</span>
    </div>
    <div class="team ${large ? "large" : ""} ${compact ? "compact-code" : ""}">
      ${crestMarkup(away)}
      <span>${escapeHtml(compact ? teamCode(away) : teamName(away))}</span>
    </div>
  `;
}

function liveScorelineMarkup(match) {
  const home = match.homeTeam || {};
  const away = match.awayTeam || {};
  return `
    <div class="live-team">
      ${crestMarkup(home)}
      <span>${escapeHtml(teamName(home))}</span>
    </div>
    <div class="live-score">
      <strong>${scoreDisplay(match, "home")}</strong>
      <small>${matchClockLabel(match)}</small>
      <strong>${scoreDisplay(match, "away")}</strong>
    </div>
    <div class="live-team">
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
      <div class="compact-matchup">${matchupMarkup(match, { compact: true })}</div>
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
    <div class="group-row" role="row">
      <span class="table-team" role="cell">${crestMarkup(row.team)} ${escapeHtml(teamName(row.team))}</span>
      <span role="cell">${row.playedGames ?? 0}</span>
      <span role="cell">${row.won ?? 0}</span>
      <span role="cell">${row.draw ?? 0}</span>
      <span role="cell">${row.lost ?? 0}</span>
      <span role="cell">${gd > 0 ? `+${gd}` : gd}</span>
      <span role="cell"><strong>${row.points ?? 0}</strong></span>
    </div>
  `;
}

function groupTableMarkup(standing) {
  return `
    <section class="group-panel">
      <div class="group-panel-title">${escapeHtml(formatLabel(standing.group || standing.stage || standing.type || "Standings"))}</div>
      <div class="group-table" role="table">
        <div class="group-row group-head" role="row">
          <span role="columnheader">Team</span>
          <span role="columnheader">MP</span>
          <span role="columnheader">W</span>
          <span role="columnheader">D</span>
          <span role="columnheader">L</span>
          <span role="columnheader">GD</span>
          <span role="columnheader">Pts</span>
        </div>
        ${standing.table.slice(0, 8).map(standingRowMarkup).join("")}
      </div>
    </section>
  `;
}

function teamMarkup(team) {
  return `
    <section class="team-tile">
      ${crestMarkup(team)}
      <span>${escapeHtml(teamCode(team))}</span>
    </section>
  `;
}

function eventListMarkup(events, emptyText) {
  if (!events.length) {
    return `<p class="event-empty">${escapeHtml(emptyText)}</p>`;
  }

  return `
    <div class="event-list ${events.length > 8 ? "is-dense" : ""}">
      ${events.map((event) => `
        <div class="event-row">
          <span>${escapeHtml(event.minute)}</span>
          <strong>${escapeHtml(event.player)}</strong>
          <small>${escapeHtml(event.detail)}</small>
        </div>
      `).join("")}
    </div>
  `;
}

function goalEvents(match) {
  const explicitGoals = Array.isArray(match.goals) ? match.goals : [];
  const events = Array.isArray(match.events) ? match.events : [];
  return [...explicitGoals, ...events.filter(isGoalEvent)].map((event) => eventInfo(event, "Goal"));
}

function cardEvents(match) {
  const explicitCards = [
    ...(Array.isArray(match.cards) ? match.cards : []),
    ...(Array.isArray(match.bookings) ? match.bookings : [])
  ];
  const events = Array.isArray(match.events) ? match.events : [];
  return [...explicitCards, ...events.filter(isCardEvent)].map((event) => eventInfo(event, cardType(event)));
}

function eventInfo(event, fallbackDetail) {
  const player = event.player?.name
    || event.scorer?.name
    || event.playerName
    || event.name
    || "Player";
  const team = event.team?.shortName
    || event.team?.name
    || event.teamName
    || "";
  const detail = [fallbackDetail, team].filter(Boolean).join(" • ");
  return {
    minute: eventMinute(event),
    player,
    detail
  };
}

function isGoalEvent(event) {
  const text = eventTypeText(event);
  return text.includes("GOAL") || text.includes("PENALTY_SCORED") || text.includes("OWN_GOAL");
}

function isCardEvent(event) {
  const text = eventTypeText(event);
  return text.includes("CARD") || text.includes("BOOKING") || text.includes("YELLOW") || text.includes("RED");
}

function cardType(event) {
  const text = eventTypeText(event);
  if (text.includes("RED")) {
    return "Red card";
  }
  if (text.includes("YELLOW")) {
    return "Yellow card";
  }
  return "Card";
}

function eventTypeText(event) {
  return [
    event.type,
    event.detail,
    event.kind,
    event.card,
    event.description
  ].filter(Boolean).join(" ").toUpperCase();
}

function eventMinute(event) {
  const minute = event.minute ?? event.time?.minute ?? event.matchMinute;
  const extra = event.extraTime ?? event.time?.extra ?? event.stoppageTime;
  if (typeof minute === "string" && minute.trim()) {
    return minute.trim();
  }
  if (!Number.isFinite(Number(minute))) {
    return "--";
  }
  return extra ? `${minute}+${extra}'` : `${minute}'`;
}

function refereeLabel(match) {
  const referees = Array.isArray(match.referees) ? match.referees : [];
  const referee = referees.find((official) => (official.type || "").toUpperCase().includes("REFEREE")) || referees[0];
  return referee?.name ? `Referee: ${referee.name}` : "";
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

function scheduleNextSlide() {
  window.clearTimeout(slideTimer);
  slideTimer = window.setTimeout(() => {
    advanceSlide();
    scheduleNextSlide();
  }, currentSlideDuration());
}

function currentSlideDuration() {
  const active = slideEls[activeSlide];
  if (active?.dataset.slide === "live" && getLiveMatch()) {
    return LIVE_SLIDE_MS;
  }
  if (active?.dataset.slide === "groups") {
    return GROUP_SLIDE_MS;
  }
  return SLIDE_MS;
}

function advanceSlide() {
  const eligible = eligibleSlideEls();
  if (!eligible.length) {
    return;
  }

  const current = slideEls[activeSlide];
  const currentPosition = eligible.includes(current) ? eligible.indexOf(current) : -1;
  const next = eligible[(currentPosition + 1) % eligible.length];
  if (currentPosition >= 0 && eligible.indexOf(next) <= currentPosition) {
    slideCycle += 1;
  }
  setActiveSlide(next);
}

function syncActiveSlide() {
  const liveMatch = getLiveMatch();
  slideEls.forEach((slide) => {
    slide.classList.toggle("is-disabled", slide.dataset.slide === "live" && !liveMatch);
  });

  if (!eligibleSlideEls().includes(slideEls[activeSlide])) {
    setActiveSlide(eligibleSlideEls()[0]);
    scheduleNextSlide();
  }
}

function eligibleSlideEls() {
  return slideEls.filter((slide) => {
    if (slide.dataset.slide === "live") {
      return Boolean(getLiveMatch());
    }
    if (slide.dataset.slide === "teams") {
      return slideCycle % 2 === 0;
    }
    return true;
  });
}

function setActiveSlide(next) {
  if (!next) {
    return;
  }
  slideEls[activeSlide]?.classList.remove("active");
  activeSlide = slideEls.indexOf(next);
  next.classList.add("active");
  if (next.dataset.slide === "groups") {
    renderStandings();
  }
}

function advanceGroup() {
  const tables = groupTables();
  if (!tables.length) {
    return;
  }
  groupIndex = (groupIndex + 4) % tables.length;
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

function getLiveMatch() {
  return sortedMatches().find(isLiveMatch);
}

function isLiveMatch(match) {
  if (!match || isComplete(match)) {
    return false;
  }
  return LIVE_STATUSES.has(match.status) || isInLiveClockWindow(match);
}

function isInLiveClockWindow(match) {
  if (!["TIMED", "SCHEDULED"].includes(match.status)) {
    return false;
  }
  const kickoff = new Date(match.utcDate).getTime();
  if (!Number.isFinite(kickoff)) {
    return false;
  }
  const elapsed = Date.now() - kickoff;
  return elapsed >= 0 && elapsed <= LIVE_WINDOW_MS;
}

function isComplete(match) {
  return match.status === "FINISHED" || match.status === "AWARDED";
}

function scoreDisplay(match, side) {
  if (!hasScore(match) && !isLiveMatch(match)) {
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
  if (isLiveMatch(match)) {
    return matchClockLabel(match);
  }
  if (match.status === "TIMED" || match.status === "SCHEDULED") {
    return formatTime(match.utcDate);
  }
  return match.status.replaceAll("_", " ");
}

function matchClockLabel(match) {
  if (match.status === "PAUSED") {
    return "HALF TIME";
  }
  if (typeof match.clock === "string" && match.clock.trim()) {
    return match.clock.trim();
  }
  const apiMinute = match.minute ?? match.score?.minute;
  if (Number.isFinite(Number(apiMinute))) {
    return `${apiMinute}'`;
  }

  const kickoff = new Date(match.utcDate).getTime();
  if (!Number.isFinite(kickoff)) {
    return LIVE_STATUSES.has(match.status) ? "LIVE" : statusLabel(match);
  }

  const elapsedMinutes = Math.max(1, Math.floor((Date.now() - kickoff) / 60_000) + 1);
  if (elapsedMinutes <= 45) {
    return `${elapsedMinutes}'`;
  }
  if (elapsedMinutes <= 60) {
    return "HALF TIME";
  }
  if (elapsedMinutes <= 105) {
    return `${Math.min(90, elapsedMinutes - 15)}'`;
  }
  return "90+'";
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

function teamCode(team = {}) {
  return (team.tla || team.code || team.shortName || team.name || "TBD").slice(0, 3).toUpperCase();
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
      table: sortGroupRows(group, [...teamIds].map((teamId) => rowByTeamId.get(teamId)).filter(Boolean))
    }));
}

function sortGroupRows(group, rows) {
  return rows.sort((a, b) => compareStandingRows(a, b, group));
}

function compareStandingRows(a, b, group) {
  return numberValue(b.points) - numberValue(a.points)
    || numberValue(b.goalDifference) - numberValue(a.goalDifference)
    || numberValue(b.goalsFor) - numberValue(a.goalsFor)
    || compareHeadToHeadRows(a, b, group)
    || teamName(a.team).localeCompare(teamName(b.team), undefined, { sensitivity: "base" });
}

function compareHeadToHeadRows(a, b, group) {
  const aTeamId = a.team?.id;
  const bTeamId = b.team?.id;
  if (!aTeamId || !bTeamId) {
    return 0;
  }

  const headToHead = state.matches
    .filter((match) => match.group === group && isComplete(match))
    .filter((match) => {
      const ids = [match.homeTeam?.id, match.awayTeam?.id];
      return ids.includes(aTeamId) && ids.includes(bTeamId);
    });

  const aRecord = headToHeadRecord(aTeamId, headToHead);
  const bRecord = headToHeadRecord(bTeamId, headToHead);
  return bRecord.points - aRecord.points
    || bRecord.goalDifference - aRecord.goalDifference
    || bRecord.goalsFor - aRecord.goalsFor;
}

function headToHeadRecord(teamId, matches) {
  return matches.reduce((record, match) => {
    const isHome = match.homeTeam?.id === teamId;
    const goalsFor = scoreValue(match, isHome ? "home" : "away");
    const goalsAgainst = scoreValue(match, isHome ? "away" : "home");
    const points = goalsFor > goalsAgainst ? 3 : goalsFor === goalsAgainst ? 1 : 0;
    return {
      points: record.points + points,
      goalsFor: record.goalsFor + goalsFor,
      goalDifference: record.goalDifference + goalsFor - goalsAgainst
    };
  }, { points: 0, goalsFor: 0, goalDifference: 0 });
}

function numberValue(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}
