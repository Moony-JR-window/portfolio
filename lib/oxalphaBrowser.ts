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

/** Everything needed to log one /api/chat call: URL, request body, status, response. */
export interface OxAlphaReply {
  content: string | null;
  url: string;
  reqBody?: unknown;
  status: number;
  resBody: string;
}

export interface OxalphaBrowserSession {
  browser: Browser;
  page: Page;
  /** Run one chat completion. Returns url + req body + status + response text. */
  ask: (
    system: string,
    user: string,
    model?: string
  ) => Promise<OxAlphaReply | null>;
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

  // Hook into every later /api/chat request oxalpha's own UI makes so we can
  // capture the exact Turnstile token + session it uses (guaranteed valid).
  await page.evaluateOnNewDocument(() => {
    try {
      (window as { __oxTurnstileToken?: string }).__oxTurnstileToken = "";
      const orig = window.fetch.bind(window);
      (window as unknown as { fetch: typeof fetch }).fetch = (
        input: RequestInfo | URL,
        init?: RequestInit
      ) => {
        try {
          if (String(input).includes("/api/chat") && init && init.body) {
            const body = JSON.parse(
              String(init.body ?? init.body)
            ) as Record<string, unknown>;
            const tok =
              (body["cf-turnstile-response"] as string) ||
              (body["turnstile"] as string) ||
              (body["token"] as string) ||
              "";
            if (tok) (window as { __oxTurnstileToken?: string }).__oxTurnstileToken = tok;
          }
        } catch {
          /* ignore */
        }
        return orig(input, init);
      };
    } catch {
      /* ignore */
    }
  });

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
  ): Promise<OxAlphaReply | null> => {
    const m =
      model || opts.model || process.env.OXALPHA_MODEL || "z-ai/glm-5.3-flash";
    try {
      const evaluatePromise = page.evaluate(
        async ({ baseUrl, m, system, user }) => {
          // ---- Get a Turnstile token valid for THIS (oxalpha.com) origin ----
          async function getTurnstileToken(): Promise<string> {
            const w = window as unknown as {
              turnstile?: {
                getResponse?: (id?: string) => string;
                render?: (
                  el: HTMLElement,
                  opts: Record<string, unknown>
                ) => string;
                reset?: (id?: string) => void;
              };
            };
            const turnstile = w.turnstile;
            if (!turnstile) return "";

            // 1) token captured from oxalpha's own /api/chat requests
            const captured = (window as { __oxTurnstileToken?: string })
              .__oxTurnstileToken;
            if (captured) return captured;

            // 2) hidden input value (implicit widget)
            const hiddenInput = document.querySelector<HTMLInputElement>(
              'input[name="cf-turnstile-response"]'
            );
            if (hiddenInput && hiddenInput.value) return hiddenInput.value;

            // 3) getResponse() guarded (throws without implicit widget id)
            if (typeof turnstile.getResponse === "function") {
              try {
                const t = turnstile.getResponse();
                if (t) return t;
              } catch {
                /* explicit widget — fall through to own render */
              }
            }

            // 4) render our OWN widget with oxalpha's sitekey (the page IS
            //    oxalpha.com, so any token minted here is domain-valid).
            let sitekey = "";
            const skEl = document.querySelector("[data-sitekey]");
            if (skEl) sitekey = skEl.getAttribute("data-sitekey") || "";
            if (!sitekey) {
              for (const s of document.scripts) {
                const mm = s.textContent?.match(/0x4AAAA[A-Za-z0-9]{8,}/);
                if (mm) {
                  sitekey = mm[0];
                  break;
                }
              }
            }
            if (!sitekey || typeof turnstile.render !== "function") return "";
            if (document.getElementById("__oxcap")) return ""; // already busy
            const render = turnstile.render;

            const box = document.createElement("div");
            box.id = "__oxcap";
            box.style.position = "absolute";
            box.style.top = "-9999px";
            document.body.appendChild(box);

            let token = "";
            await new Promise<void>((resolve) => {
              try {
                render(box, {
                  sitekey,
                  callback: (t: string) => {
                    token = t;
                    (window as { __oxTurnstileToken?: string }).__oxTurnstileToken = t;
                    resolve();
                  },
                });
                setTimeout(() => resolve(), 8000); // safety timeout
              } catch {
                resolve();
              }
            });
            return token;
          }

          const turnstileToken = await getTurnstileToken();

          // XSRF from the session cookie jar (matches the Laravel convention).
          const xsrf = document.cookie
            .split(";")
            .map((c) => c.trim().split("="))
            .find(([k]) => k === "XSRF-TOKEN");
          const csrf = xsrf ? decodeURIComponent(xsrf[1] || "") : "";

          const url = `${baseUrl}/api/chat`;
          const reqBody = {
            model: m,
            messages: [{ role: "user", content: `${system}\n\n${user}` }],
          };
          const res = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json, text/event-stream",
              "x-csrf-token": csrf,
              ...(turnstileToken
                ? { "cf-turnstile-response": turnstileToken }
                : {}),
            },
            body: JSON.stringify(reqBody),
          });
          const resStatus = res.status;
          const resText = await res.text();
          if (!res.ok) {
            return {
              url,
              reqBody,
              status: resStatus,
              resBody: resText.slice(0, 300),
              content: null,
            };
          }
          let out = "";
          for (const line of resText.split(/\r?\n/)) {
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
          return {
            url,
            reqBody,
            status: resStatus,
            resBody: resText.length > 300 ? resText.slice(0, 300) + "…" : resText,
            content: out || null,
          };
        },
        { baseUrl, m, system, user } as {
          baseUrl: string;
          m: string;
          system: string;
          user: string;
        }
      );
      // Fail fast: never let one row hang the whole run. 45s cap per call.
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("oxalpha call timed out (45s)")), 45000)
      );
      const content = await Promise.race([evaluatePromise, timeoutPromise]);

      // Log the full call: URL, request body, response status, response snippet.
      console.log(
        "[oxalphaBrowser:req]",
        JSON.stringify({
          url: content?.url,
          body: content?.reqBody,
        })
      );
      console.log(
        "[oxalphaBrowser:res]",
        JSON.stringify({
          url: content?.url,
          status: content?.status,
          body: content?.resBody,
        })
      );
      if (typeof content?.content !== "string") {
        console.error("[oxalphaBrowser] non-string / errored reply:", content?.status, content?.resBody);
        return content
          ? { content: null, url: content.url, reqBody: content.reqBody, status: content.status, resBody: content.resBody }
          : null;
      }
      return {
        content: content.content || null,
        url: content.url,
        reqBody: content.reqBody,
        status: content.status,
        resBody: content.resBody,
      };
    } catch (err) {
      console.error("[oxalphaBrowser] ask threw:", err);
      return null;
    }
  };

  return { browser, page, ask, close: async () => browser.close() };
}