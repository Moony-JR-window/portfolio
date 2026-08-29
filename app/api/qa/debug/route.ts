/**
 * TEMPORARY diagnostic route — replicates askAiJson's exact provider call
 * steps and returns a per-step trace, so we can see why the QA route's AI
 * call fails on the server while /api/ai works. DELETE after debugging.
 */
import { NextRequest, NextResponse } from "next/server";
import { loadReferenceProfile } from "@/lib/qaAgent";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const log: Record<string, unknown>[] = [];
  const push = (step: string, detail: Record<string, unknown>) => {
    log.push({ step, ...detail });
    console.log(`[qa-debug] ${step}`, JSON.stringify(detail).slice(0, 300));
  };

  push("env", {
    hasKey: !!process.env.AI_API_KEY,
    model: process.env.AI_QA_MODEL || process.env.AI_MODEL || "openai/gpt-oss-120b",
    base: process.env.AI_BASE_URL || "https://api.groq.com/openai/v1",
  });

  const profile = await loadReferenceProfile();
  push("profile", { ok: !!profile, services: profile?.serviceKeys.length ?? -1 });

  const apiKey = process.env.AI_API_KEY;
  const baseUrl = (process.env.AI_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, "");
  const model = process.env.AI_QA_MODEL || process.env.AI_MODEL || "openai/gpt-oss-120b";
  const system = "You are a QA agent. Reply STRICTLY with JSON and no prose.";
  const user = "row 1: service=Wing to Wing amount=[] senderType=[]\nReply {\"fixes\":[],\"summary\":\"ok\"}";

  for (const jsonMode of [true, false]) {
    push("attempt", { jsonMode, bytes: JSON.stringify({ model, messages: [{ role: "system", content: system }, { role: "user", content: user }] }).length });
    try {
      let res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          temperature: 0,
          max_tokens: 1024,
          ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
        }),
        signal: AbortSignal.timeout(30000),
      });
      push("groq", {
        jsonMode,
        status: res.status,
        body: (await res.text()).slice(0, 400),
      });
      if (res.status === 429) break;
      if (res.status !== 200) continue;
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content ?? "";
      push("parse", { content: String(content).slice(0, 200) });
      if (content) return NextResponse.json({ ok: true, log });
    } catch (err) {
      push("throw", {
        jsonMode,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  try {
    const res = await fetch("https://text.pollinations.ai/openai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai",
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        private: true,
      }),
      signal: AbortSignal.timeout(15000),
    });
    push("pollinations", { status: res.status, body: (await res.text()).slice(0, 200) });
  } catch (err) {
    push("pollinations-throw", {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  return NextResponse.json({ ok: false, log }, { status: 200 });
}