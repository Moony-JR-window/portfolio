// app/api/ai/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * AI chat endpoint for the "/ai" chat command.
 *
 * Works with TWO providers, chosen automatically:
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
 * Body:
 *   { "message": "string" }                  // the user's question
 *   { "message": "…", "imageDataUrl": "…" }  // question + attached image
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
  imageDataUrl?: string
): Promise<string | null> {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) return null;

  const baseUrl = (process.env.AI_BASE_URL || "https://api.groq.com/openai/v1").replace(
    /\/$/,
    ""
  );
  // A vision-capable free Groq model when an image is attached, otherwise a
  // widely-available free text model with good quality/speed.
  const model = imageDataUrl
    ? process.env.AI_VISION_MODEL ||
      "meta-llama/llama-4-scout-17b-16e-instruct"
    : process.env.AI_MODEL || "openai/gpt-oss-120b";

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
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
  imageDataUrl?: string
): Promise<string | null> {
  // With an image attached, try Pollinations' OpenAI-compatible endpoint,
  // which accepts multimodal (vision) content parts on some free models.
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

  // Try a couple of keyless endpoint variants so a single block/error
  // doesn't kill the whole request.
  const endpoints = [
    (q: string) => {
      const url = new URL("https://text.pollinations.ai/" + encodeURIComponent(q));
      url.searchParams.set("model", "openai");
      url.searchParams.set("system", SYSTEM_PROMPT);
      url.searchParams.set("private", "true");
      return url.toString();
    },
    (q: string) => {
      const url = new URL("https://text.pollinations.ai/" + encodeURIComponent(q));
      url.searchParams.set("model", "mistral");
      url.searchParams.set("system", SYSTEM_PROMPT);
      url.searchParams.set("private", "true");
      return url.toString();
    },
  ];

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

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      message?: string;
      imageDataUrl?: string;
    };

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

    // Prefer the configured (paid/key) provider when available…
    try {
      reply = await askConfiguredProvider(message, imageDataUrl);
    } catch (err) {
      console.error("Configured AI provider failed, falling back to free:", err);
      reply = null;
    }

    // …otherwise fall back to the free, no-key endpoint.
    if (!reply) {
      try {
        reply = await askFreeProvider(message, imageDataUrl);
      } catch (err) {
        console.error("Free AI provider failed:", err);
        reply = null;
      }
    }

    // An image was attached but nothing could process it — say so clearly.
    if (!reply && imageDataUrl) reply = IMAGE_FALLBACK_REPLY;

    return NextResponse.json({ reply: reply || FALLBACK_REPLY });
  } catch (err) {
    console.error("AI route error:", err);
    return NextResponse.json({ reply: FALLBACK_REPLY }, { status: 200 });
  }
}

