// app/api/ai/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Free AI chat endpoint (no API key required).
 *
 * Proxies the question to Pollinations' free public text-generation API
 * (https://text.pollinations.ai) and returns the plain-text answer. This
 * keeps the upstream call on the server so we avoid CORS and never leak
 * any credentials to the browser.
 *
 * Body:
 *   {
 *     "message": "string"   // the user's question
 *   }
 *
 * Response:
 *   { "reply": "string" }
 */

const FREE_AI_URL = "https://text.pollinations.ai/";

const SYSTEM_PROMPT =
  "You are MooNyBot, a friendly, helpful AI assistant running inside the " +
  "MoonyDev portfolio chat. Answer the user's question clearly and concisely. " +
  "Keep answers reasonably short (a few sentences to a short paragraph) unless " +
  "the question needs more detail.";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      message?: string;
    };

    const message = (body.message ?? "").trim();
    if (!message) {
      return NextResponse.json({ reply: "Please ask a question." }, { status: 200 });
    }

    // Free Pollinations text API — plain text response.
    // Reference: GET https://text.pollinations.ai/{prompt}?model=...&system=...
    const url = new URL(FREE_AI_URL + encodeURIComponent(message));
    url.searchParams.set("model", "openai");
    url.searchParams.set("system", SYSTEM_PROMPT);
    url.searchParams.set("private", "true");

    const res = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "text/plain" },
      signal: AbortSignal.timeout(45000),
    });

    if (!res.ok) {
      throw new Error(`Free AI upstream returned ${res.status}`);
    }

    const text = (await res.text()).trim();
    // Upstream may wrap responses in quotes — strip them.
    const cleaned = text.replace(/^["']|["']$/g, "").trim();
    const reply = cleaned || "I couldn't think of an answer. Try again!";

    return NextResponse.json({ reply });
  } catch (err) {
    console.error("AI route error:", err);
    // Surface a friendly message so the user isn't left hanging.
    return NextResponse.json(
      {
        reply:
          "⚠️ The free AI service is temporarily unavailable. Please try again in a moment.",
      },
      { status: 200 }
    );
  }
}
