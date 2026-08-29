/** Debug the AI provider exactly like lib/qaAgent.ts askAiJson does. */
const fs = require("fs");
// Minimal .env.local parser (KEY=VALUE per line, # comments).
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !line.trim().startsWith("#")) process.env[m[1]] = m[2];
}

(async () => {
  const apiKey = process.env.AI_API_KEY;
  const baseUrl = (process.env.AI_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, "");
  const model = process.env.AI_QA_MODEL || process.env.AI_MODEL || "openai/gpt-oss-120b";
  console.log("baseUrl:", baseUrl, "model:", model, "key set:", Boolean(apiKey));
  if (!apiKey) process.exit(1);

  for (const jsonMode of [true, false]) {
    const body = {
      model,
      messages: [
        { role: "system", content: "You are a QA data agent. Answer STRICT JSON: {\"fixes\":[],\"summary\":\"...\"}" },
        { role: "user", content: "Row 1: {\"Service_Name\":\"wingg to wingg\"}. Reply with strict JSON fixing Service_Name to the canonical \"Wing to Wing\" if it matches." },
      ],
      temperature: 0,
      max_tokens: 512,
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    };
    const t0 = Date.now();
    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45000),
      });
      console.log(`jsonMode=${jsonMode} status=${res.status} in ${Date.now() - t0}ms`);
      if (!res.ok) {
        console.log("  body:", (await res.text()).slice(0, 500));
        continue;
      }
      const data = await res.json();
      console.log("  content:", JSON.stringify(data.choices?.[0]?.message?.content ?? "").slice(0, 300));
      break;
    } catch (e) {
      console.log(`jsonMode=${jsonMode} THREW:`, e.name, e.message, `after ${Date.now() - t0}ms`);
    }
  }
})();
