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
 *   { "message": "string" }   // the user's question
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

/** Use the configured provider via an API key (defaults to Groq free tier). */
async function askConfiguredProvider(
  message: string
): Promise<string | null> {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) return null;

  const baseUrl = (process.env.AI_BASE_URL || "https://api.groq.com/openai/v1").replace(
    /\/$/,
    ""
  );
  // A widely-available free Groq model with good quality/speed.
  const model = process.env.AI_MODEL || "llama-3.3-70b-versatile";

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
        { role: "user", content: message },
      ],
      max_tokens: 1024,
    }),
    signal: AbortSignal.timeout(45000),
  });

  if (!res.ok) throw new Error(`AI provider returned ${res.status}`);
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return data.choices?.[0]?.message?.content?.trim() || null;
}

/** Use free, no-key public text endpoints (Pollinations). */
async function askFreeProvider(message: string): Promise<string | null> {
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
    };

    const message = (body.message ?? "").trim();
    if (!message) {
      return NextResponse.json({ reply: "Please ask a question." }, { status: 200 });
    }

    let reply: string | null = null;

    // Prefer the configured (paid/key) provider when available…
    try {
      reply = await askConfiguredProvider(message);
    } catch (err) {
      console.error("Configured AI provider failed, falling back to free:", err);
      reply = null;
    }

    // …otherwise fall back to the free, no-key endpoint.
    if (!reply) {
      try {
        reply = await askFreeProvider(message);
      } catch (err) {
        console.error("Free AI provider failed:", err);
        reply = null;
      }
    }

    return NextResponse.json({ reply: reply || FALLBACK_REPLY });
  } catch (err) {
    console.error("AI route error:", err);
    return NextResponse.json({ reply: FALLBACK_REPLY }, { status: 200 });
  }
}

