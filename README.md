# Site Pulse — Self-Hosted Website Uptime Monitor

A lightweight, self-hosted uptime monitoring dashboard with live screenshots. Tracks whether your websites are up or down, displays response times, and takes automatic screenshots — all in a mobile-optimized grid you can glance at from across the room.

> Built for developers who want a simple, private alternative to services like UptimeRobot or Freshping — running on your own hardware, no subscriptions.

## Features

- **Uptime monitoring** — pings your sites on a configurable interval and flags anything that goes down
- **Automatic screenshots** — takes a fresh screenshot of each site every hour using headless Chrome
- **Color-coded status** — green border = up, red border = down, readable at a glance
- **Mobile-first grid layout** — fits up to 10 sites on one screen, optimized for iPhone SE landscape mode
- **One-tap to open** — tap any site card to open it in your browser
- **Password protected** — HTTP basic auth keeps the dashboard private
- **Manual refresh** — force a fresh check and new screenshots on demand
- **Zero cloud dependency** — runs entirely on your own machine or server

## Requirements

- [Node.js](https://nodejs.org/) v18 or newer
- A machine reachable from your phone (same Wi-Fi, or a VPS with a public IP)

## Setup

**1. Clone and install**

```bash
git clone https://github.com/YOUR_USERNAME/site-pulse.git
cd site-pulse
npm install
npx playwright install chromium
```

**2. Configure your sites**

```bash
cp sites.example.json sites.json
```

Edit `sites.json` with the sites you want to monitor:

```json
{
  "refreshSeconds": 1800,
  "timeoutMs": 8000,
  "sites": [
    {
      "name": "My Site",
      "url": "https://example.com",
      "expectStatus": [200, 301, 302]
    }
  ]
}
```

| Field | Description |
|---|---|
| `refreshSeconds` | Ping interval in seconds — `1800` = every 30 minutes |
| `timeoutMs` | Request timeout in milliseconds |
| `expectStatus` | HTTP status codes that count as "up" |

**3. Set credentials**

```bash
cp .env.example .env
```

```
DASH_USER=your_username
DASH_PASS=your_password
USE_AUTH=true
```

Set `USE_AUTH=false` to disable auth on a private network.

**4. Run**

```bash
node server.js
```

Dashboard runs on port `3010`. Open `http://localhost:3010` in your browser.

## Accessing from your phone

1. Make sure your phone and computer are on the same Wi-Fi
2. Find your local IP: `ipconfig` (Windows) or `ifconfig` (Mac/Linux)
3. Open `http://YOUR_IP:3010` in Safari
4. Tap **Share → Add to Home Screen** for a full-screen app experience

## How it works

- **Pings** are lightweight HTTP GET requests — no browser needed, very low overhead
- **Screenshots** use Playwright (headless Chromium) on a separate hourly schedule
- Screenshots are saved as JPEGs in `public/previews/` and served statically
- `sites.json` and `.env` are gitignored — your site list and credentials stay local

## Stack

- **Node.js + Express** — server and API
- **Playwright** — headless Chrome for screenshots
- **CSS Grid + Vanilla JS** — no framework, loads fast on mobile
