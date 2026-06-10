# WorldCup Tracker

WorldCup Tracker is an OBS-ready dashboard for FIFA World Cup 2026 fixtures, results, group tables, teams, and rolling broadcast details.

The dashboard is designed to run without interaction during a stream. It rotates through match spotlight, latest results, upcoming fixtures, standings, and qualified teams while a ticker scrolls along the bottom.

## Features

- Live data proxy for football-data.org v4
- Auto-refreshing World Cup 2026 schedule, teams, and standings
- OBS-friendly 1920x1080 broadcast layout
- Auto-rotating slides with no clicks required
- Continuous lower-third ticker
- Deepwater Skyros stream desk branding
- Server-side API token handling so the token is not exposed in browser JavaScript

## Requirements

- Node.js 18 or newer
- A football-data.org API token with FIFA World Cup access
- Docker, if running the containerized setup

## Setup

Create a local environment file:

```bash
cp .env.example .env
```

Add your football-data.org token:

```bash
FOOTBALL_DATA_TOKEN=your_token_here
PORT=4326
```

Start the dashboard:

```bash
npm start
```

Open the dashboard:

```text
http://localhost:4326
```

## Docker

Build and run with Docker:

```bash
docker build -t worldcup-tracker .
docker run -d \
  --name worldcup-tracker \
  --restart unless-stopped \
  -p 4326:4326 \
  --env-file .env \
  worldcup-tracker
```

If you change `PORT` in `.env`, map the container side to that same value.

Or use Docker Compose:

```bash
docker compose up -d --build
```

For Portainer or another stack manager, add these stack environment variables:

```text
FOOTBALL_DATA_TOKEN=your_token_here
PORT=4326
HOST_PORT=4326
```

`FOOTBALL_DATA_TOKEN` is required for live API data. `PORT` is the internal container port and `HOST_PORT` is the host port exposed to OBS. Compose maps `HOST_PORT` to `PORT`; if either value is omitted, it uses `4326`.

## OBS

Add a Browser Source in OBS with:

```text
URL: http://localhost:4326
Width: 1920
Height: 1080
```

The dashboard refreshes API data every 90 seconds and rotates slides every 12 seconds.

## Validation

Run the syntax checks:

```bash
npm run check
node --check public/app.js
```

## API

Data is loaded from football-data.org through the local Node proxy at:

```text
/api/worldcup
```

The proxy caches upstream responses, retries transient failures once, and preserves the last useful payload if a later refresh fails.
