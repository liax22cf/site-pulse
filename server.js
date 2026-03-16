const fs = require("fs");
const path = require("path");
const express = require("express");
const helmet = require("helmet");
const basicAuth = require("basic-auth");
const { chromium } = require("playwright");
require("dotenv").config();

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));

const CONFIG_PATH = path.join(__dirname, "sites.json");
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));

const REFRESH_MS = (config.refreshSeconds ?? 30) * 1000;
const TIMEOUT_MS = config.timeoutMs ?? 8000;

// Visual previews (screenshots)
const SCREENSHOT_DIR = path.join(__dirname, "public", "previews");
const SCREENSHOT_INTERVAL_MS = 60 * 60 * 1000; // every 2 minutes
const SCREENSHOT_TIMEOUT_MS = 20000;
const SCREENSHOT_VIEWPORT = { width: 390, height: 844 }; // iPhone-ish
const SCREENSHOT_QUALITY = 70; // jpg quality 0-100

// ======= Auth (change) =======
const USE_AUTH = (process.env.USE_AUTH ?? "true").toLowerCase() === "true";
const AUTH_USER = process.env.DASH_USER;
const AUTH_PASS = process.env.DASH_PASS;
// =============================

function requireAuth(req, res, next) {
  const user = basicAuth(req);
  const ok = user && user.name === AUTH_USER && user.pass === AUTH_PASS;
  if (!ok) {
    res.set("WWW-Authenticate", 'Basic realm="Dashboard"');
    return res.status(401).send("Auth required");
  }
  next();
}

// Serve preview images WITHOUT auth (fixes Safari/Basic-Auth image loading issues)
app.use("/previews", express.static(path.join(__dirname, "public", "previews")));

// Protect everything else
if (USE_AUTH) app.use(requireAuth);

// Serve dashboard + other static assets
app.use(express.static(path.join(__dirname, "public")));

if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

let lastResults = {
  updatedAt: null,
  refreshSeconds: config.refreshSeconds ?? 30,
  sites: []
};

function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "Local-Status-Dashboard/1.0" }
    });
    const ms = Date.now() - start;
    return { ok: true, status: res.status, ms };
  } catch (e) {
    const ms = Date.now() - start;
    return { ok: false, error: String(e.name || e.message || e), ms };
  } finally {
    clearTimeout(id);
  }
}

async function runChecks() {
  const sites = config.sites ?? [];
  const results = [];

  for (const s of sites) {
    const url = s.url;
    const expect = s.expectStatus ?? [200, 301, 302];
    const name = s.name ?? url ?? "Site";

    if (!url || url === "REPLACE_ME") {
      results.push({
        name,
        url,
        up: false,
        note: "No URL configured",
        checkedAt: new Date().toISOString(),
        preview: null
      });
      continue;
    }

    const r = await fetchWithTimeout(url, TIMEOUT_MS);

    const slug = slugify(url);
    const previewPath = `/previews/${slug}.jpg`;

    if (r.ok) {
      const up = expect.includes(r.status);
      results.push({
        name,
        url,
        up,
        status: r.status,
        ms: r.ms,
        checkedAt: new Date().toISOString(),
        preview: previewPath
      });
    } else {
      results.push({
        name,
        url,
        up: false,
        error: r.error,
        ms: r.ms,
        checkedAt: new Date().toISOString(),
        preview: previewPath
      });
    }
  }

  lastResults = {
    updatedAt: new Date().toISOString(),
    refreshSeconds: config.refreshSeconds ?? 30,
    sites: results
  };
}

// --- Screenshot engine (Playwright) ---
let browser = null;
let screenshotRunning = false;

async function ensureBrowser() {
  if (browser) return browser;
  browser = await chromium.launch({
    headless: true
  });
  return browser;
}

async function screenshotOneSite(site) {
  const url = site.url;
  if (!url || url === "REPLACE_ME") return;

  const slug = slugify(url);
  const outFile = path.join(SCREENSHOT_DIR, `${slug}.jpg`);
  const tmpFile = path.join(SCREENSHOT_DIR, `${slug}.tmp.jpg`);

  const b = await ensureBrowser();
  const context = await b.newContext({
    viewport: SCREENSHOT_VIEWPORT,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1"
  });

  const page = await context.newPage();
  page.setDefaultTimeout(SCREENSHOT_TIMEOUT_MS);

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: SCREENSHOT_TIMEOUT_MS });
    // Give the page a moment for layout/assets
    await page.waitForTimeout(1200);

    await page.screenshot({
      path: tmpFile,
      type: "jpeg",
      quality: SCREENSHOT_QUALITY,
      fullPage: false
    });

    // Atomic replace: write tmp then rename
    if (fs.existsSync(outFile)) fs.unlinkSync(outFile);
    fs.renameSync(tmpFile, outFile);
  } catch (e) {
    // If screenshot fails, keep last good screenshot if it exists.
    // Optional: write a placeholder image later; for now do nothing.
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
}

async function runScreenshots() {
  if (screenshotRunning) return;
  screenshotRunning = true;

  try {
    const sites = config.sites ?? [];
    // Limit concurrency: do one-by-one (stable on weaker servers)
    for (const s of sites) {
      await screenshotOneSite(s);
    }
  } finally {
    screenshotRunning = false;
  }
}

// API
app.get("/api/status", (req, res) => {
  res.json(lastResults);
});

// Trigger immediate check + screenshots (for your Refresh button)
app.post("/api/refresh", express.json(), async (req, res) => {
  try {
    await runChecks();
    await runScreenshots();
    res.json({ ok: true, updatedAt: lastResults.updatedAt });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// Start server
const PORT = 3010;
const HOST = "0.0.0.0";

(async () => {
  await runChecks();
  await runScreenshots();

  setInterval(runChecks, REFRESH_MS);
  setInterval(runScreenshots, SCREENSHOT_INTERVAL_MS);

  app.listen(PORT, HOST, () => {
    console.log(`Dashboard: http://localhost:${PORT}`);
  });
})();

// Clean shutdown
process.on("SIGINT", async () => {
  try {
    if (browser) await browser.close();
  } finally {
    process.exit(0);
  }
});