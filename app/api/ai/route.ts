// app/api/ai/route.ts
import { NextResponse } from "next/server";

import { openOxalphaSession } from "@/lib/oxalphaBrowser";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * AI chat endpoint for the "/ai" chat command.
 *
 * Providers — the first two are chosen automatically, oxalpha only when the
 * UI explicitly picks it:
 *
 *  1) Groq (free tier — recommended, fast, no credit card). Configure with:
 *       AI_API_KEY   – your Groq API key (console.groq.com/keys)
 *       AI_BASE_URL  – optional, defaults to https://api.groq.com/openai/v1
 *       AI_MODEL     – optional, defaults to a free Groq model
 *     When AI_API_KEY is set, requests are sent as OpenAI chat completions
 *     to Groq. Any other OpenAI-compatible provider also works by overriding
 *     AI_BASE_URL / AI_MODEL.
 *
 *  2) Free, no-key fallback via Pollinations' public text API
 *     (https://text.pollinations.ai). No setup required. Note: this free
 *     endpoint is community-run and may be rate-limited or blocked on some
 *     networks, so the UI shows a friendly message if it ever fails.
 *
 *  3) Oxalpha (keyless, https://oxalpha.com) when the UI picks the "oxalpha"
 *     model. Session-authenticated like the /qa window:
 *       OXALPHA_COOKIE / OXALPHA_CSRF_TOKEN  – session (or pass oxcookie/oxcsrf)
 *       OXALPHA_MODEL / OXALPHA_URL          – optional overrides
 *       OXALPHA_TURNSTILE_TOKEN / _FIELD     – optional Turnstile token
 *     With no session cookie it falls back to a real browser (Chrome) when
 *     OXALPHA_BROWSER != "0". ⚡ When "oxalpha" is selected it is AUTHORITATIVE
 *     — never silently swapped for another AI (same rule as the /qa window).
 *     Text-only: it cannot see attached images.
 *
 * Body:
 *   { "message": "string" }                  // the user's question
 *   { "message": "…", "imageDataUrl": "…" }  // question + attached image
 *   { "message": "string", "model": "model-id" }  // …plus a chosen AI model (optional)
 *   // oxalpha-only session credentials (all optional; env vars are preferred):
 *   { "message": "…", "model": "oxalpha", "oxcookie": "…", "oxcsrf": "…",
 *     "oxturnstile": "…", "oxmodel": "model-id" }
 *
 * When "imageDataUrl" (an inline data:image/...;base64 URL ≤ ~6 MB) is sent,
 * a vision-capable model is used so MooNyBot can "see" the attachment.
 *
 * Response:
 *   { "reply": "string" }
 */

const SYSTEM_PROMPT =
  "You are MooNyBot, a friendly, helpful AI assistant running inside the " +
  "MoonyDev portfolio chat. Answer the user's question clearly and concisely. " +
  "Keep answers reasonably short (a few sentences to a short paragraph) unless " +
  "the question needs more detail.";

const FALLBACK_REPLY =
  "⚠️ I couldn't reach a free AI service from this network/deployment — " +
  "public keyless AI endpoints are often rate-limited or blocked. Please try " +
  "again in a moment. (Tip for the site owner: set an AI_API_KEY env var to " +
  "use a reliable free provider like Groq.)";

const IMAGE_FALLBACK_REPLY =
  "⚠️ I received your image but couldn't reach a vision-capable AI service " +
  "from this network/deployment. Please try again in a moment. (Tip for the " +
  "site owner: set AI_API_KEY with a vision-capable model, e.g. Groq's " +
  "meta-llama/llama-4-scout-17b-16e-instruct.)";

const OXALPHA_FALLBACK_REPLY =
  "⚠️ ⚡ oxalpha didn't answer. This keyless provider needs a valid oxalpha.com " +
  "session — set OXALPHA_COOKIE / OXALPHA_CSRF_TOKEN (or paste oxcookie/oxcsrf), " +
  "or run where Chrome is installed so the browser fallback can solve Turnstile. " +
  "It can also be quota / Turnstile limited. Please try again in a moment or pick " +
  "another model.";

const OXALPHA_IMAGE_REPLY =
  "⚡ oxalpha is a text-only provider and can't see attached images. " +
  "Remove the image or choose another model (e.g. Groq's vision model).";

/** Only well-formed inline data URLs like `data:image/png;base64,…` (≤ ~6 MB). */
function isValidImageDataUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 7_000_000 &&
    /^data:image\/(?:png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/i.test(value)
  );
}

/** Multimodal content parts for OpenAI-compatible vision APIs. */
type TextPart = { type: "text"; text: string };
type ImagePart = { type: "image_url"; image_url: { url: string } };

/** Build the "user" message: plain string, or text + image parts with an image. */
function buildUserContent(
  message: string,
  imageDataUrl?: string
): string | (TextPart | ImagePart)[] {
  if (!imageDataUrl) return message;
  return [
    { type: "text", text: message },
    { type: "image_url", image_url: { url: imageDataUrl } },
  ];
}

/** Use the configured provider via an API key (defaults to Groq free tier). */
async function askConfiguredProvider(
  message: string,
  imageDataUrl?: string,
  modelHint?: string
): Promise<string | null> {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) return null;

  const baseUrl = (process.env.AI_BASE_URL || "https://api.groq.com/openai/v1").replace(
    /\/$/,
    ""
  );
  // Let the UI pick the chat model. Images always need a vision-capable model
  // so MooNyBot can "see" the attachment, so the hint is ignored for images and
  // the configured vision model is used instead.
  const resolvedModel = imageDataUrl
    ? process.env.AI_VISION_MODEL || "meta-llama/llama-4-scout-17b-16e-instruct"
    : modelHint && modelHint !== "auto" && !modelHint.startsWith("free:")
      ? modelHint
      : process.env.AI_MODEL || "openai/gpt-oss-120b";

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: resolvedModel,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserContent(message, imageDataUrl) },
      ],
      max_tokens: 2048,
    }),
    signal: AbortSignal.timeout(45000),
  });

  if (!res.ok) throw new Error(`AI provider returned ${res.status}`);
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return data.choices?.[0]?.message?.content?.trim() || null;
}

/** Use free, no-key public endpoints (Pollinations). */
async function askFreeProvider(
  message: string,
  imageDataUrl?: string,
  modelHint?: string
): Promise<string | null> {
  // With an image attached, use the vision-capable Pollinations OpenAI endpoint.
  if (imageDataUrl) {
    try {
      const res = await fetch("https://text.pollinations.ai/openai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "openai",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: buildUserContent(message, imageDataUrl) },
          ],
          private: true,
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          choices?: { message?: { content?: string } }[];
        };
        const reply = data.choices?.[0]?.message?.content?.trim();
        if (reply) return reply;
      }
    } catch {
      // blocked or timed out — fall through
    }
    return null; // image understanding needs a real vision provider
  }

    // Honour a free-model choice from the UI ("free:mistral" prefers mistral;
  // otherwise openai). Both are still tried as a fallback so a single blocked
  // request doesn't kill the whole call.
  const orderedModels =
    modelHint === "free:mistral" ? ["mistral", "openai"] : ["openai", "mistral"];
  const endpoints = orderedModels.map((m) => (q: string) => {
    const url = new URL("https://text.pollinations.ai/" + encodeURIComponent(q));
    url.searchParams.set("model", m);
    url.searchParams.set("system", SYSTEM_PROMPT);
    url.searchParams.set("private", "true");
    return url.toString();
  });

  for (const buildUrl of endpoints) {
    try {
      const res = await fetch(buildUrl(message), {
        method: "GET",
        headers: { Accept: "text/plain" },
        // Short timeout — these endpoints are unreliable, don't hang the user.
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) continue; // blocked/errored — try the next endpoint
      const text = (await res.text()).trim();
      // Upstream may wrap responses in quotes — strip them.
      const cleaned = text.replace(/^["']|["']$/g, "").trim();
      if (cleaned) return cleaned;
    } catch {
      // blocked or timed out — try the next endpoint
    }
  }

  return null;
}

/** Concatenate assistant text out of a text/event-stream reply (the oxalpha
 *  /api/chat endpoint always streams, even without a stream flag). */
function parseSse(text: string): string {
  let out = "";
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.replace(/^data:\s*/, "").trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const obj = JSON.parse(payload) as {
        choices?: { delta?: { content?: string }; message?: { content?: string } }[];
        message?: { content?: string };
      };
      const piece =
        obj.choices?.[0]?.delta?.content ||
        obj.choices?.[0]?.message?.content ||
        obj.message?.content;
      if (typeof piece === "string") out += piece;
    } catch {
      // non-JSON keep-alive / comment line — ignore
    }
  }
  return out;
}

/** Ask the keyless oxalpha.com chat endpoint (same transport as the /qa
 *  window): direct fetch with the browser-session Cookie + XSRF first, then a
 *  real-browser fallback when no session is configured. Text-only. Returns the
 *  raw assistant reply (no JSON extraction — /ai is a plain chat). */
async function askOxalphaProvider(
  message: string,
  creds?: { cookie?: string; csrf?: string; turnstile?: string; model?: string }
): Promise<string | null> {
  const cookie = (creds?.cookie || "").trim() || process.env.OXALPHA_COOKIE || "";
  const csrf = (creds?.csrf || "").trim() || process.env.OXALPHA_CSRF_TOKEN || "";
  const turnstile =
    (creds?.turnstile || "").trim() || process.env.OXALPHA_TURNSTILE_TOKEN || "";
  const turnstileField =
    process.env.OXALPHA_TURNSTILE_FIELD || "cf-turnstile-response";
  const model =
    (creds?.model || "").trim() ||
    process.env.OXALPHA_MODEL ||
    "z-ai/glm-5.3-flash";
  const baseUrl = (process.env.OXALPHA_URL || "https://oxalpha.com").replace(
    /\/+$/,
    ""
  );
  const url = `${baseUrl}/api/chat`;

  // 1) DIRECT FETCH (Postman-proven): a valid session Cookie + XSRF is enough —
  //    no browser, no Turnstile token required. Mirrors the minimal request
  //    captured in DevTools (no Origin/Referer/User-Agent at all).
  if (cookie && csrf) {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      };
      if (csrf) headers["x-csrf-token"] = csrf;
      if (cookie) headers["Cookie"] = cookie;
      // Only attach a Turnstile token when we actually have one (an empty token
      // can itself trigger the verification check).
      if (turnstile && turnstileField === "cf-turnstile-response") {
        headers["cf-turnstile-response"] = turnstile;
      }
      // oxalpha rejects a "system" role (payload format: only user/assistant
      // with plain-string content), so the system prompt is folded into the
      // single user message.
      const reqBody: Record<string, unknown> = {
        model,
        messages: [{ role: "user", content: `${SYSTEM_PROMPT}\n\n${message}` }],
      };
      if (turnstile) reqBody[turnstileField] = turnstile;

      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(reqBody),
        signal: AbortSignal.timeout(45000),
      });
      if (!res.ok) {
        console.error(
          "[api/ai] oxalpha",
          res.status,
          (await res.text()).slice(0, 300)
        );
        return null;
      }
      const content = parseSse(await res.text()).trim();
      return content || null;
    } catch (err) {
      console.error("[api/ai] oxalpha fetch threw:", err);
      return null;
    }
  }

  // 2) BROWSER fallback (same as /api/qa/*): without a session cookie, launch a
  //    real Chrome/Chromium on oxalpha.com/chat so its own Turnstile widget
  //    solves the check for us. Only when not disabled (OXALPHA_BROWSER=0) —
  //    serverless deployments should keep it off / use env session creds.
  if (process.env.OXALPHA_BROWSER !== "0") {
    let session: Awaited<ReturnType<typeof openOxalphaSession>> | null = null;
    try {
      session = await openOxalphaSession({ model });
      const reply = await session.ask(SYSTEM_PROMPT, message, model);
      return typeof reply?.content === "string" && reply.content.trim()
        ? reply.content.trim()
        : null;
    } catch (err) {
      console.error("[api/ai] oxalpha browser failed:", err);
      return null;
    } finally {
      if (session) await session.close().catch(() => {});
    }
  }

  return null;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      message?: string;
      imageDataUrl?: string;
      model?: string;
      // Optional oxalpha.com session credentials (env vars are preferred).
      oxcookie?: string;
      oxcsrf?: string;
      oxturnstile?: string;
      oxmodel?: string;
    };

    // The UI can request a specific model. "free:*" choices (no API key) are
    // routed straight to the keyless Pollinations backend; "oxalpha" is routed
    // to the keyless oxalpha.com chat endpoint; anything else goes to the
    // configured provider (Groq by default) first, then falls back to free if
    // that fails or there is no key.
    const requestedModel =
      typeof body.model === "string" && body.model.trim() !== ""
        ? body.model.trim()
        : undefined;
    const preferFree =
      requestedModel === "free:openai" || requestedModel === "free:mistral";
    const isOxalpha = requestedModel === "oxalpha";

    // Reject malformed/oversized attachments silently (treat as no image).
    const imageDataUrl = isValidImageDataUrl(body.imageDataUrl)
      ? body.imageDataUrl
      : undefined;

    let message = (body.message ?? "").trim();
    if (!message && imageDataUrl) {
      message = "Describe this image and answer helpfully about it.";
    }
    if (!message) {
      return NextResponse.json({ reply: "Please ask a question." }, { status: 200 });
    }

    let reply: string | null = null;

    // ⚡ oxalpha selected — it is authoritative and never silently swapped for
    // another AI (same rule as the /qa window). Text-only: no image support.
    if (isOxalpha) {
      if (imageDataUrl) {
        reply = OXALPHA_IMAGE_REPLY;
      } else {
        try {
          reply = await askOxalphaProvider(message, {
            cookie: body.oxcookie,
            csrf: body.oxcsrf,
            turnstile: body.oxturnstile,
            model: body.oxmodel,
          });
        } catch (err) {
          console.error("Oxalpha provider failed:", err);
          reply = null;
        }
        if (!reply) reply = OXALPHA_FALLBACK_REPLY;
      }
    } else {
      // Prefer the configured (paid/key) provider when available — unless the
      // user explicitly asked for a free model from the UI selector.
      if (!preferFree) {
        try {
          reply = await askConfiguredProvider(message, imageDataUrl, requestedModel);
        } catch (err) {
          console.error("Configured AI provider failed, falling back to free:", err);
          reply = null;
        }
      }

      // …otherwise fall back to the free, no-key endpoint.
      if (!reply) {
        try {
          reply = await askFreeProvider(message, imageDataUrl, requestedModel);
        } catch (err) {
          console.error("Free AI provider failed:", err);
          reply = null;
        }
      }

      // An image was attached but nothing could process it — say so clearly.
      if (!reply && imageDataUrl) reply = IMAGE_FALLBACK_REPLY;
    }

    return NextResponse.json({ reply: reply || FALLBACK_REPLY });
  } catch (err) {
    console.error("AI route error:", err);
    return NextResponse.json({ reply: FALLBACK_REPLY }, { status: 200 });
  }
}

