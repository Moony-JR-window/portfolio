/**
 * oxalpha.com headless-browser transport.
 *
 * WHY this exists:
 *   oxalpha.com gates POST /api/chat behind Cloudflare Turnstile. Turnstile
 *   tokens are DOMAIN-BOUND — a widget rendered on any other origin mints a
 *   token oxalpha will reject. Plain server-side fetch can therefore never
 *   clear a "turnstile_required" (428) response (the token must come from
 *   oxalpha.com's own page, in a real browser that passed the check).
 *
 * HOW it works:
 *   We launch the installed Chrome/Chromium, open oxalpha.com/chat, let its
 *   Turnstile widget run, then POST /api/chat from INSIDE that page via
 *   `page.evaluate`. All session cookie / XSRF / Origin / Referer / Turnstile
 *   values are therefore the browser's own — nothing to copy or paste. ONE page
 *   is reused for the whole batch (launching Chrome per row is far too slow for
 *   60+ rows).
 *
 * HONEST LIMITS (read before enabling):
 *   • Needs a machine that has Chrome/Chromium near the server — works for a
 *     local Windows/Mac/Linux box, NOT Netlify/Vercel serverless functions.
 *   • Cloudflare Turnstile sometimes detects automation even with a real
 *     Chrome binary and forces a manual widget, which headless cannot click.
 *   • oxalpha caps messages/day; a full Auto Types run can still hit
 *     "messages_today" even with a valid token.
 *   Enable with OXALPHA_BROWSER=1 (and optionally OXALPHA_BROWSER_PATH below).
 */

import puppeteer, { Browser, Page } from "puppeteer-core";

/** Best-effort absolute path to an installed Chrome/Chromium binary. */
function chromeExecutable(): string {
  const fromEnv = process.env.OXALPHA_BROWSER_PATH;
  if (fromEnv) return fromEnv;
  const candidates =
    process.platform === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Chromium.app/Contents/MacOS/Chromium",
          "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        ]
      : process.platform === "win32"
        ? [
            "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
            "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
            "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
          ]
        : [
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
          ];
  return candidates[0] || "google-chrome";
}

export interface OxalphaBrowserOptions {
  model?: string;
  baseUrl?: string;
  headless?: boolean;
  /** Shared page for the batch — set externally when you want reuse. */
  page?: Page | null;
}

export interface OxalphaBrowserSession {
  browser: Browser;
  page: Page;
  /** Run one chat completion. Returns raw assistant text (SSE-joined). */
  ask: (
    system: string,
    user: string,
    model?: string
  ) => Promise<string | null>;
  close: () => Promise<void>;
}

/**
 * Open oxalpha.com/chat in a real browser and return a reusable session whose
 * `ask()` posts to /api/chat from inside the page (valid Turnstile + cookies).
 */
export async function openOxalphaSession(
  opts: OxalphaBrowserOptions = {}
): Promise<OxalphaBrowserSession> {
  const baseUrl = (
    opts.baseUrl ||
    process.env.OXALPHA_URL ||
    "https://oxalpha.com"
  ).replace(/\/+$/, "");
  const executablePath = chromeExecutable();
  const browser = await puppeteer.launch({
    executablePath,
    headless: opts.headless ?? process.env.OXALPHA_BROWSER_HEADLESS !== "0",
    defaultViewport: { width: 1280, height: 900 },
    args: [
      "--no-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
    ],
    userDataDir: process.env.OXALPHA_USER_DATA_DIR || undefined,
  });

  const page = opts.page || (await browser.newPage());
  await page.goto(`${baseUrl}/chat`, {
    waitUntil: "networkidle2",
    timeout: 60000,
  });

  // Give Turnstile a moment to solve (managed / invisible mode) and capture any
  // token the widget produced. Not fatal if there is none yet.
  await new Promise((r) => setTimeout(r, 3000));

  const ask = async (
    system: string,
    user: string,
    model?: string
  ): Promise<string | null> => {
    const m =
      model || opts.model || process.env.OXALPHA_MODEL || "z-ai/glm-5.3-flash";
    try {
      const content = (await page.evaluate(
        async ({ baseUrl, m, system, user }) => {
          // Extract the Turnstile token from whatever widget the page rendered.
          const w = window as unknown as {
            turnstile?: { getResponse?: () => string };
          };
          const turnstileToken =
            (typeof w.turnstile?.getResponse === "function" &&
              w.turnstile.getResponse()) ||
            "";

          // XSRF from the session cookie jar (matches the Laravel convention).
          const xsrf = document.cookie
            .split(";")
            .map((c) => c.trim().split("="))
            .find(([k]) => k === "XSRF-TOKEN");
          const csrf = xsrf ? decodeURIComponent(xsrf[1] || "") : "";

          const res = await fetch(`${baseUrl}/api/chat`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json, text/event-stream",
              "x-csrf-token": csrf,
              ...(turnstileToken
                ? { "cf-turnstile-response": turnstileToken }
                : {}),
            },
            body: JSON.stringify({
              model: m,
              messages: [{ role: "user", content: `${system}\n\n${user}` }],
            }),
          });
          if (!res.ok) {
            return `<error:${res.status}>${(await res.text()).slice(0, 200)}`;
          }
          const text = await res.text();
          let out = "";
          for (const line of text.split(/\r?\n/)) {
            if (!line.startsWith("data:")) continue;
            const payload = line.replace(/^data:\s*/, "").trim();
            if (!payload || payload === "[DONE]") continue;
            try {
              const obj = JSON.parse(payload) as {
                choices?: {
                  delta?: { content?: string };
                  message?: { content?: string };
                }[];
                message?: { content?: string };
              };
              out +=
                obj.choices?.[0]?.delta?.content ||
                obj.choices?.[0]?.message?.content ||
                obj.message?.content ||
                "";
            } catch {
              /* ignore keep-alives */
            }
          }
          return out;
        },
        { baseUrl, m, system, user } as {
          baseUrl: string;
          m: string;
          system: string;
          user: string;
        }
      ));

      if (typeof content !== "string") return null;
      if (content.startsWith("<error:")) {
        console.error("[oxalphaBrowser]", content);
        return null;
      }
      return content || null;
    } catch (err) {
      console.error("[oxalphaBrowser] ask threw:", err);
      return null;
    }
  };

  return { browser, page, ask, close: async () => browser.close() };
}