/* E2E: reproduce the YouTube-search + sign-in flow in a real browser. */
const puppeteer = require("puppeteer-core");
const fs = require("fs");

const PORT = process.env.PORT || "3210";
const ORIGIN = "http://localhost:" + PORT;
const OUT = "d:/otherProject/portfolio/e2e-result.txt";
const lines = [];
const log = (s) => {
  lines.push(String(s));
};

(async () => {
  const browser = await puppeteer.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--lang=en-US"],
    defaultViewport: { width: 1400, height: 900 },
  });
  const page = await browser.newPage();
  const events = [];
  const mark = (u) =>
    u.includes("/api/proxy") ? "relay" : u.includes("/_next") ? "next" : "ESCAPED";
  const short = (u) =>
    u
      .replace(/aHR0cH[A-Za-z0-9_-]{10,}/g, (m) => m.slice(0, 12) + "…")
      .slice(0, 160);
  page.on("request", (r) => {
    const u = r.url();
    if (u.startsWith("data:") || u.includes("devtools")) return;
    events.push(
      `REQ[${mark(u)}] ${r.method()} ${short(u)} ref=${(r.headers()["referer"] || "-").slice(0, 70)}`
    );
  });
  page.on("response", (r) => {
    const u = r.url();
    if (u.startsWith("data:") || u.includes("devtools")) return;
    events.push(`RES[${mark(u)}] ${r.status()} ${short(u)}`);
  });

  try {
    log("goto /proxy (" + ORIGIN + ")");
    await page.goto(ORIGIN + "/proxy", {
      waitUntil: "networkidle2",
      timeout: 60000,
    });
    await page.waitForSelector("input", { timeout: 30000 });
    await page.type("input", "https://www.youtube.com/", { delay: 5 });
    await page.click('button[type="submit"]');

    let frame = null;
    for (let i = 0; i < 90 && !frame; i++) {
      await new Promise((r) => setTimeout(r, 500));
      frame = page
        .frames()
        .find((f) => f.url().startsWith(ORIGIN + "/api/proxy"));
    }
    log("frame: " + (frame ? frame.url().slice(0, 120) : "NOT FOUND"));
    if (!frame) throw new Error("relayed frame not found");

    /* ---- PART A: search box (the core complaint) ---- */
    const selectors = [
      "input#search",
      "input[name=search_query]",
      "input.ytSearchboxComponentInput",
      "yt-searchbox input",
      "input[aria-label*='Search']",
      "input[type=text]",
    ];
    let box = null;
    let usedSel = null;
    for (let i = 0; i < 90 && !box; i++) {
      await new Promise((r) => setTimeout(r, 500));
      for (const sel of selectors) {
        try {
          box = await frame.$(sel);
          if (box) {
            usedSel = sel;
            break;
          }
        } catch (e) {
          /* keep trying */
        }
      }
    }
    log("search box: " + (box ? usedSel : "NOT FOUND"));
    if (!box) throw new Error("search box not found");

    await box.type("vannda", { delay: 40 });
    await new Promise((r) => setTimeout(r, 400));
    await page.keyboard.press("Enter");
    log("pressed Enter, waiting…");
    await new Promise((r) => setTimeout(r, 18000));

    log("--- frames after search ---");
    for (const f of page.frames()) {
      let title = "";
      let is404 = false;
      let hasResults = false;
      try {
        title = await f.title();
        const c = await f.content();
        is404 = c.includes("This page could not be found");
        hasResults = c.includes("videoRenderer") || c.includes("ytd-video-renderer");
      } catch (e) {
        title = "ERR " + String(e.message).slice(0, 60);
      }
      log(
        `FRAME ${short(f.url())} | title="${title.slice(0, 60)}" | 404=${is404} | results=${hasResults}`
      );
    }

    /* ---- PART B: sign-in (best effort — Google may script-navigate away) ---- */
    log("--- sign-in attempt ---");
    try {
      frame = page
        .frames()
        .find((f) => f.url().startsWith(ORIGIN + "/api/proxy/p/"));
      if (frame) {
        const signInSelectors = [
          'a[aria-label*="Sign in"]',
          'a[aria-label*=\'Sign in\']',
          "tp-yt-paper-button[aria-label*='Sign in']",
          "a#button[aria-label*='Sign in']",
          "button[aria-label*='Sign in']",
        ];
        for (const sel of signInSelectors) {
          try {
            const found = await frame.$(sel);
            if (found) {
              await found.click();
              break;
            }
          } catch (e) {
            /* keep trying */
          }
        }
      }
      await new Promise((r) => setTimeout(r, 5000));
      for (const f of page.frames()) {
        const isAcct =
          f.url().includes("accounts.google.com") || f.url().includes("ServiceLogin");
        if (isAcct) {
          log("accounts/relay frame: " + short(f.url()));
        }
      }
    } catch (e) {
      log("sign-in attempt error: " + (e && e.message));
    }

    log("--- request/response log (last 120) ---");
    for (const e of events.slice(-120)) log(e);
  } catch (e) {
    log("ERROR: " + (e && e.message));
    log("--- request/response log (last 120) ---");
    for (const e2 of events.slice(-120)) log(e2);
  } finally {
    await browser.close().catch(() => {});
    fs.writeFileSync(OUT, lines.join("\n"));
    console.log("WROTE " + OUT);
  }
})();