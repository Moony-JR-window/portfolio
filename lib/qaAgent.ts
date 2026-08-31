import ExcelJS from "exceljs";
import {
  SERVICE_KEYS,
  cellValueToPlainText,
  sheetToAoa,
  detectServiceHeaderRow,
  normalizeTextKey,
} from "./excelLogic";

/**
 * qaAgent.ts — the AI agent behind the "/qa" window's "✨ AI Fix" button.
 *
 * When a user drops their Excel workbook, the deterministic QA pass
 * (unmerge + Service_Name rename, see lib/excelLogic.ts) already runs. This
 * module adds the "use AI again to fix the file" step:
 *
 *   1. `loadReferenceProfile()` reads the CORRECT reference template
 *      `excel_data/Wing Bank Regression Testcase Template
 *      1.5_unmerged_renamed.xlsx` and extracts the vocabulary every row is
 *      checked against: canonical Service_Name keys, valid
 *      Sender/Receiver account types, real account samples (PSP = 8-digit
 *      phone, FC = 9-digit account), class-of-service values, currencies.
 *   2. `aiFixRows()` sends the bounded data rows to the AI agent and asks it
 *      to verify & correct Service_Name, Sender type/account, Amount,
 *      Receiver type/account, plus scenario/description consistency —
 *      replying STRICT JSON. Provider is OpenAI-compatible: Groq by default
 *      (AI_API_KEY / AI_BASE_URL / AI_MODEL); DeepSeek is supported by
 *      overriding AI_QA_API_KEY, AI_QA_BASE_URL and AI_QA_MODEL (see
 *      askAiJson). A free keyless Pollinations call is the last resort.
 *   3. Every suggested fix goes through `sanitizeAiFixes()` guardrails so a
 *      hallucinating model cannot corrupt the workbook: only whitelisted QA
 *      columns may change, Service_Name must land on a canonical key,
 *      account types must exist in the reference vocabulary, amounts must
 *      be numeric.
 *   4. AUTO-INPUT: EMPTY Amount / Sender_Account_Type /
 *      Receiver_Account_Type / Sender_Account / Receiver_Account cells are
 *      filled from per-service statistics extracted from the reference —
 *      every filled value must be one the reference actually uses for that
 *      Service_Name, so nothing is ever invented.
 */

// ---------------------------------------------------------------
// Reference template profile
// ---------------------------------------------------------------

/** Per-Service_Name reference statistics used to ground AUTO-INPUT fills. */
export interface ServiceStat {
  /** Known Amount / Receiver Amount values used by this service. */
  amounts: string[];
  /** Known Sender_Account_Type values (PSP / FC). */
  senderTypes: string[];
  /** Known Receiver_Account_Type values. */
  receiverTypes: string[];
  /** Known Sender_Account values (for filling empty accounts). */
  senderAccounts: string[];
  /** Known Receiver_Account values (for filling empty accounts). */
  receiverAccounts: string[];
}

export interface ReferenceProfile {
  serviceKeys: string[];
  senderAccountTypes: string[];
  senderAccountSamples: string[];
  receiverAccountTypes: string[];
  receiverAccountSamplesByType: Record<string, string[]>;
  senderCoS: string[];
  receiverCoS: string[];
  currencies: string[];
  scenarioSamples: string[];
  /** looseKey(Service_Name) -> statistics from the reference workbook. */
  serviceStats: Record<string, ServiceStat>;
}

/** The correct (gold) workbook that dropped files are compared against. */
const REFERENCE_FILE =
  "excel_data/Wing Bank Regression Testcase Template 1.5_unmerged_renamed.xlsx";

/** Lowercase, strip everything but a-z0-9 — for fuzzy header matching. */
export function headerKey(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** Cap a sample set so the AI prompt stays small. */
function cap(set: Set<string>, n: number, maxLen = 80): string[] {
  return [...set]
    .filter((s) => s.length > 0)
    .slice(0, n)
    .map((s) => (s.length > maxLen ? s.slice(0, maxLen) + "…" : s));
}

/**
 * Like `cap` but validation-grade: over-long values are DROPPED (never
 * truncated with an ellipsis) so every kept entry is an exact value that
 * auto-input fills can be checked against.
 */
function capExact(set: Set<string>, n: number, maxLen: number): string[] {
  return [...set].filter((s) => s.length > 0 && s.length <= maxLen).slice(0, n);
}

let profilePromise: Promise<ReferenceProfile | null> | null = null;

/**
 * Load + cache the reference profile once per server process.
 * Resolves null when the template is missing/unreadable — the caller then
 * reports "AI unavailable" instead of failing the request.
 */
export function loadReferenceProfile(): Promise<ReferenceProfile | null> {
  if (!profilePromise) {
    profilePromise = (async () => {
      try {
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.readFile(REFERENCE_FILE);
        return extractProfile(wb);
      } catch (err) {
        console.error("[qaAgent] Could not load reference template:", err);
        return null;
      }
    })();
  }
  return profilePromise;
}

/**
 * Extract the QA vocabulary + per-service statistics from the reference
 * workbook (first sheet that carries a Service_Name header).
 */
function extractProfile(wb: ExcelJS.Workbook): ReferenceProfile {
  const profile: ReferenceProfile = {
    serviceKeys: [...SERVICE_KEYS],
    senderAccountTypes: [],
    senderAccountSamples: [],
    receiverAccountTypes: [],
    receiverAccountSamplesByType: {},
    senderCoS: [],
    receiverCoS: [],
    currencies: [],
    scenarioSamples: [],
    serviceStats: {},
  };

  for (const ws of wb.worksheets) {
    const aoa = sheetToAoa(ws);
    const headerRowNum = detectServiceHeaderRow(aoa, 1);
    const headerCells = aoa[headerRowNum - 1] || [];
    const keys = headerCells.map((h) => headerKey(h));
    if (!keys.includes("servicename")) continue; // not the testcase sheet

    const idx = (...names: string[]): number => {
      for (const n of names) {
        const i = keys.indexOf(n);
        if (i !== -1) return i;
      }
      return -1;
    };
    const senderTypeIdx = idx("senderaccounttype");
    const senderAcctIdx = idx("senderaccount");
    const senderCoSIdx = idx(
      "sendercosaccountclasss",
      "sendercos",
      "senderclassofservice"
    );
    const currencyIdx = idx("accountcurrency");
    const receiverTypeIdx = idx("recieveraccounttype", "receiveraccounttype");
    const receiverAcctIdx = idx("receiveraccount");
    const receiverCoSIdx = idx("receiverclassofservice", "receivercos");
    const scenarioIdx = idx("scenarios");
    const serviceIdx = idx("servicename");
    const amountIdx = idx("amount");
    const receiverAmountIdx = idx("receiveramount");

    const senderTypes = new Set<string>();
    const senderAccounts = new Set<string>();
    const senderCoS = new Set<string>();
    const currencies = new Set<string>();
    const receiverTypes = new Set<string>();
    const receiverCoS = new Set<string>();
    const scenarios = new Set<string>();
    const receiverByType: Record<string, Set<string>> = {};
    // Per-service statistics for AUTO-INPUT (fill empty Amount / types /
    // accounts with what the reference template uses for that service).
    const statsByService: Record<
      string,
      {
        amounts: Set<string>;
        senderTypes: Set<string>;
        receiverTypes: Set<string>;
        senderAccounts: Set<string>;
        receiverAccounts: Set<string>;
      }
    > = {};

    const text = (v: unknown): string =>
      String(cellValueToPlainText(v) ?? "").trim();

    for (let r = headerRowNum; r < aoa.length; r++) {
      const row = aoa[r] || [];
      const cell = (i: number): unknown =>
        i >= 0 && i < row.length ? row[i] : "";

      if (senderTypeIdx >= 0) senderTypes.add(text(cell(senderTypeIdx)));
      if (senderAcctIdx >= 0) senderAccounts.add(text(cell(senderAcctIdx)));
      if (senderCoSIdx >= 0) senderCoS.add(text(cell(senderCoSIdx)));
      if (currencyIdx >= 0) currencies.add(text(cell(currencyIdx)));
      if (receiverTypeIdx >= 0) receiverTypes.add(text(cell(receiverTypeIdx)));
      if (receiverCoSIdx >= 0) receiverCoS.add(text(cell(receiverCoSIdx)));
      if (scenarioIdx >= 0) scenarios.add(text(cell(scenarioIdx)));
      if (receiverTypeIdx >= 0 && receiverAcctIdx >= 0) {
        const type = text(cell(receiverTypeIdx));
        const acct = text(cell(receiverAcctIdx));
        if (type && acct) {
          (receiverByType[type] ||= new Set()).add(acct);
        }
      }

      const service = serviceIdx >= 0 ? text(cell(serviceIdx)) : "";
      if (service) {
        const stat = (statsByService[looseKey(service)] ||= {
          amounts: new Set<string>(),
          senderTypes: new Set<string>(),
          receiverTypes: new Set<string>(),
          senderAccounts: new Set<string>(),
          receiverAccounts: new Set<string>(),
        });
        if (amountIdx >= 0) {
          const a = text(cell(amountIdx));
          if (a) stat.amounts.add(a);
        }
        if (receiverAmountIdx >= 0) {
          const a = text(cell(receiverAmountIdx));
          if (a) stat.amounts.add(a);
        }
        if (senderTypeIdx >= 0) {
          const t = text(cell(senderTypeIdx));
          if (t) stat.senderTypes.add(t);
        }
        if (receiverTypeIdx >= 0) {
          const t = text(cell(receiverTypeIdx));
          if (t) stat.receiverTypes.add(t);
        }
        if (senderAcctIdx >= 0) {
          const a = text(cell(senderAcctIdx));
          if (a) stat.senderAccounts.add(a);
        }
        if (receiverAcctIdx >= 0) {
          const a = text(cell(receiverAcctIdx));
          if (a) stat.receiverAccounts.add(a);
        }
      }
    }

    profile.senderAccountTypes = cap(senderTypes, 20);
    // Keep the profile compact — free AI tiers enforce small token budgets
    // (e.g. Groq free: 8k TPM), so every list is aggressively capped.
    profile.senderAccountSamples = cap(senderAccounts, 12, 24);
    profile.receiverAccountTypes = cap(receiverTypes, 40);
    profile.senderCoS = cap(senderCoS, 12, 40);
    profile.receiverCoS = cap(receiverCoS, 20, 40);
    profile.currencies = cap(currencies, 10);
    profile.scenarioSamples = cap(scenarios, 8, 60);
    for (const [type, accts] of Object.entries(receiverByType)) {
      profile.receiverAccountSamplesByType[type] = cap(accts, 2, 24);
    }
    for (const [sk, s] of Object.entries(statsByService)) {
      profile.serviceStats[sk] = {
        amounts: capExact(s.amounts, 6, 12),
        senderTypes: capExact(s.senderTypes, 4, 20),
        receiverTypes: capExact(s.receiverTypes, 4, 40),
        senderAccounts: capExact(s.senderAccounts, 3, 24),
        receiverAccounts: capExact(s.receiverAccounts, 2, 60),
      };
    }
    break; // first sheet carrying Service_Name is the testcase sheet
  }

  return profile;
}

// ---------------------------------------------------------------
// AI provider (same stack as /api/ai: Groq key + free fallback)
// ---------------------------------------------------------------

const QA_SYSTEM_PROMPT = `You are the Wing Bank QA test-case data agent. You check regression test-case rows against a CORRECT reference template, correct wrong values and AUTO-INPUT missing ones. Reply ONLY with strict JSON.

Rules:
- "row" in a fix is the data-row number from the payload ("row": 1 = first data row), NOT the Excel row.
- "column" must be the exact header name used in the payload.

AUTO-INPUT (the payload marks empty cells as ""):
- When Amount, Receiver Amount, Sender_Account_Type, Reciever_Account_Type, Sender_Account or Receiver_Account is "" (empty), fill it from the PER-SERVICE REFERENCE block for that row's Service_Name:
  * Amount / Receiver Amount: use one of the exact amounts listed for that service (write it as a plain number).
  * Sender_Account_Type: "PSP" or "FC" — the value(s) the reference uses for that service; when both occur, match the sender account shape (8-digit phone => PSP, 9-digit => FC).
  * Reciever_Account_Type: one of the exact receiver types listed for that service.
  * Sender_Account / Receiver_Account: only an exact account value listed for that service. Never invent account numbers, KHQR strings or bill codes.
- If the per-service reference has no usable value for a column, leave it empty (do not suggest a fix for it).

CORRECTIONS (non-empty cells):
- Service_Name must be exactly one of the canonical service keys. Map typos, casing, spacing, garbage prefixes/suffixes and near-matches to the canonical key. If you cannot confidently map it, do not change it.
- Sender_Account_Type is "PSP" (Wing app / phone wallet) or "FC" (Wing customer full account). PSP sender accounts are 8-digit phone numbers starting with 0 (e.g. 07782083). FC sender accounts are 9-digit numbers (e.g. 103634567). When the account shape and the type contradict each other, fix the TYPE — never alter an account number.
- Amount and Receiver Amount must be plain positive numbers. Convert text amounts like "120,000" or "12O,000" into 120000. If the text cannot be read as a number, do not change it.
- Receiver_Account_Type must come from the allowed receiver types list. Only fix the type when it clearly contradicts the account value or the scenario. Never invent account numbers.
- Scenarios and Test_Case_Description read like "Perform from PSP KHR to FC USD": the PSP/FC words must agree with Sender_Account_Type / Receiver_Account_Type, and the currency words must agree with Account_Currency / Reciever_Currency. Rewrite that text when it contradicts the row data.
- Never invent data that is not in the reference; skip anything you are not sure about.

Answer STRICTLY with JSON and no prose:
{"fixes":[{"row":1,"column":"Service_Name","from":"old value","to":"new value","reason":"short reason"}],"summary":"one sentence overall verdict"}
When nothing needs changing or filling, return {"fixes":[],"summary":"..."} .`;

/** Pull the first JSON object out of an LLM reply (handles code fences). */
function extractJsonObject(text: string): Record<string, unknown> | null {
  if (!text) return null;
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(t.slice(start, end + 1));
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

interface ChatChoice {
  choices?: { message?: { content?: string } }[];
}

/** Ask the AI agent for a JSON verdict. Returns null when every provider fails. */
async function askAiJson(
  system: string,
  user: string
): Promise<Record<string, unknown> | null> {
  const apiKey = process.env.AI_QA_API_KEY || process.env.AI_API_KEY;
  if (apiKey) {
    const baseUrl = (
      process.env.AI_QA_BASE_URL ||
      process.env.AI_BASE_URL ||
      "https://api.groq.com/openai/v1"
    ).replace(/\/$/, "");
    const model =
      process.env.AI_QA_MODEL ||
      process.env.AI_MODEL ||
      "openai/gpt-oss-120b";
    // DeepSeek V4 defaults to thinking mode, which is slow and can exceed the
    // serverless function timeout. This strict-JSON QA job does not need it —
    // force non-thinking so requests stay fast and cheap.
    const isDeepSeek = /deepseek\.com/i.test(baseUrl);
    const thinking = isDeepSeek ? { type: "disabled" } : undefined;

    // First try strict JSON mode; some models reject response_format, so
    // retry once without it before giving up on this provider. A 429
    // (rolling TPM window) gets one timed wait-and-retry, because the batch
    // retry in aiFixRows would otherwise burn the same budget immediately.
    for (const jsonMode of [true, false]) {
      try {
        const body: Record<string, unknown> = {
          model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          temperature: 0,
          max_tokens: 2048,
          ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
          ...(thinking ? { thinking } : {}),
        };
        let res = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(45000),
        });
        if (res.status === 429 || res.status === 413) {
          const errText = await res.text().catch(() => "");
          const m = errText.match(/try again in\s*([\d.]+)\s*s/i);
          const waitSec = m
            ? Math.min(25, Math.ceil(parseFloat(m[1]) + 1))
            : 10;
          console.log(
            `[qaAgent] ${res.status} (TPM/request limit) — waiting ${waitSec}s`
          );
          await new Promise((r) => setTimeout(r, waitSec * 1000));
          res = await fetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(45000),
          });
        }
        if (!res.ok) {
          console.error(
            `[qaAgent] Provider ${res.status}:`,
            (await res.text()).slice(0, 300)
          );
          continue;
        }
        const data = (await res.json()) as ChatChoice;
        const parsed = extractJsonObject(
          data.choices?.[0]?.message?.content ?? ""
        );
        if (parsed) return parsed;
      } catch (err) {
        console.error("[qaAgent] Provider fetch threw:", err);
        // provider hiccup — try the next mode / provider
      }
    }
  }

  // Free, keyless fallback (Pollinations, OpenAI-compatible POST).
  try {
    const res = await fetch("https://text.pollinations.ai/openai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        private: true,
      }),
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) {
      console.error(
        "[qaAgent] Pollinations",
        res.status,
        (await res.text()).slice(0, 200)
      );
    } else {
      const data = (await res.json()) as ChatChoice;
      const parsed = extractJsonObject(
        data.choices?.[0]?.message?.content ?? ""
      );
      if (parsed) return parsed;
    }
  } catch (err) {
    console.error("[qaAgent] Pollinations fetch threw:", err);
    // fall through
  }

  return null;
}

// ---------------------------------------------------------------
// AI fix generation + guardrails
// ---------------------------------------------------------------

export interface AiFix {
  /** 1-based data-row number (1 = first row under the header). */
  row: number;
  /** Exact header name of the column being corrected. */
  column: string;
  /** Current value (informational). */
  from: string;
  /** Corrected value to write. */
  to: string;
  /** Short explanation from the agent. */
  reason: string;
  /** True when this fix AUTO-INPUTS an empty cell from the reference. */
  fill?: boolean;
}

export interface AiAgentResult {
  available: boolean;
  summary: string;
  fixes: AiFix[];
  checkedRows: number;
}

/** Normalized header keys the agent is allowed to correct. */
const QA_FOCUS_KEYS = new Set([
  "servicename",
  "channels",
  "scenarios",
  "testcasetype",
  "testcasedescription",
  "senderaccounttype",
  "senderaccount",
  "sendercosaccountclasss",
  "sendercos",
  "accountcurrency",
  "amount",
  "receiveramount",
  "recieveraccounttype",
  "receiveraccounttype",
  "receiveraccount",
  "receiverclassofservice",
  "receivercos",
  "recievercurrency",
  "receivercurrency",
]);

/** Canonical Service_Name lookup (loose key -> canonical key). */
const SERVICE_LOOKUP: Record<string, string> = Object.create(null);
for (const key of SERVICE_KEYS) {
  SERVICE_LOOKUP[looseKey(key)] = key;
}

/**
 * Punctuation-insensitive matching key: "wing-to-wing", "wing to wing" and
 * "Wing.To.Wing" all collapse to "wing to wing". Looser than
 * normalizeTextKey so AI-suggested canonical names with different
 * punctuation still land on the exact SERVICE_KEYS spelling.
 */
function looseKey(value: unknown): string {
  return normalizeTextKey(value)
    .replace(/[^0-9a-z]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Case/punctuation-insensitive lookup over a reference vocabulary list. */
function canonicalFromList(list: string[], value: string): string | null {
  const key = looseKey(value);
  for (const item of list) {
    if (looseKey(item) === key) return item;
  }
  return null;
}

/** Parse a money-ish string into a plain non-negative number. */
function parseAmount(value: string): number | null {
  const cleaned = value.replace(/[,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Rough token estimate (~3.5 chars/token) used to size AI batches. */
function estimateTokens(text: string): number {
  return Math.ceil((text || "").length / 3.5);
}

/**
 * Run the AI agent over the sheet's data rows and return validated fixes.
 *
 * `rows` are the data rows under the header (strings), `headers` the exact
 * header names. Rows beyond `maxRows` are not AI-checked (the summary says
 * so). Every raw fix is run through `sanitizeAiFixes` before it is returned.
 */
export async function aiFixRows(
  headers: string[],
  rows: string[][],
  profile: ReferenceProfile,
  maxRows = 25
): Promise<AiAgentResult> {
  const base: AiAgentResult = {
    available: false,
    summary: "",
    fixes: [],
    checkedRows: 0,
  };
  if (!rows.length) return base;

  // Only ship the QA-relevant columns to the agent.
  const focusIdx: number[] = [];
  headers.forEach((h, i) => {
    const k = headerKey(h);
    if (k && QA_FOCUS_KEYS.has(k)) focusIdx.push(i);
  });
  if (!focusIdx.length) return base;

  const buildPayload = (count: number): Record<string, string>[] => {
    const payloadRows: Record<string, string>[] = [];
    for (let r = 0; r < count; r++) {
      const entry: Record<string, string> = { row: String(r + 1) };
      for (const ci of focusIdx) {
        const text = String(rows[r]?.[ci] ?? "")
          .replace(/\s+/g, " ")
          .trim();
        entry[headers[ci]] = text.length > 80 ? text.slice(0, 80) : text;
      }
      payloadRows.push(entry);
    }
    return payloadRows;
  };

  const buildUser = (payloadRows: Record<string, string>[]): string => {
    // Only ship per-service stats for the services that actually appear in
    // this batch — keeps the prompt inside the free-tier token budget.
    const serviceCol = headers.findIndex((h) => headerKey(h) === "servicename");
    const used = new Set<string>();
    for (const r of payloadRows) {
      const s =
        serviceCol >= 0 ? looseKey(r[headers[serviceCol]] ?? "") : "";
      if (s) used.add(s);
    }
    const perServiceRef: Record<string, ServiceStat> = {};
    for (const s of used) {
      const stat = profile.serviceStats[s];
      if (stat) perServiceRef[s] = stat;
    }
    return (
    "REFERENCE TEMPLATE PROFILE (the correct values):\n" +
    JSON.stringify({
      canonical_service_keys: profile.serviceKeys,
      sender_account_types: profile.senderAccountTypes,
      sender_account_samples: profile.senderAccountSamples,
      receiver_account_types: profile.receiverAccountTypes,
      receiver_account_samples_by_type: profile.receiverAccountSamplesByType,
      sender_class_of_service: profile.senderCoS,
      receiver_class_of_service: profile.receiverCoS,
      currencies: profile.currencies,
      scenario_samples: profile.scenarioSamples,
      // Per-service reference: what the CORRECT template uses for each
      // Service_Name — the only allowed source for AUTO-INPUT fills.
      per_service_reference: perServiceRef,
    }) +
    "\n\nSHEET DATA ROWS (JSON array; \"row\" = data-row number):\n" +
    JSON.stringify(payloadRows) +
    (rows.length > payloadRows.length
      ? `\n\n(Only the first ${payloadRows.length} of ${rows.length} rows were sent — check those.)`
      : "") +
    "\n\nCheck every row and reply with the strict JSON verdict."
    );
  };

  // Free AI tiers (e.g. Groq free: 8k TPM) reject requests that exceed the
  // per-minute token budget, and a REJECTED 413 still counts toward TPM —
  // blind halve-and-retry therefore poisons the rate-limit window. Instead
  // SIZE THE FIRST ATTEMPT from an estimate so it always fits the budget.
  const TOKEN_BUDGET = 6500; // comfortably under Groq free 8k TPM
  const systemCost = estimateTokens(QA_SYSTEM_PROMPT);
  let checked = Math.min(rows.length, maxRows);
  while (checked >= 1) {
    const cost =
      systemCost + estimateTokens(buildUser(buildPayload(checked)));
    if (cost <= TOKEN_BUDGET) break;
    if (checked === 1) break;
    // Scale down proportionally to how far over budget we are.
    const rowCost = Math.max(1, cost - systemCost);
    const budgetForRows = Math.max(1, TOKEN_BUDGET - systemCost);
    const scaled = Math.max(1, Math.floor((checked * budgetForRows) / rowCost) - 1);
    if (scaled >= checked) {
      checked = Math.max(1, Math.floor(checked / 2));
    } else {
      checked = scaled;
    }
  }

  let raw: Record<string, unknown> | null = null;
  let lastChecked = checked;
  while (checked >= 1) {
    raw = await askAiJson(
      QA_SYSTEM_PROMPT,
      buildUser(buildPayload(checked))
    );
    if (raw) break;
    const next = Math.max(1, Math.floor(checked / 2));
    if (next >= checked) break;
    checked = next;
    lastChecked = checked;
  }

  if (!raw) {
    return {
      ...base,
      checkedRows: lastChecked,
      summary:
        "AI agent unreachable or payload still too large for the configured AI plan — applied rule-based fixes only.",
    };
  }

  const summary = String(raw.summary ?? "").slice(0, 300);
  const { fixes, rejected } = sanitizeAiFixes(
    raw.fixes,
    headers,
    rows.slice(0, checked),
    profile
  );
  if (rejected > 0) {
    console.log(`[qaAgent] rejected ${rejected} unsafe/hallucinated fix(es)`);
  }

  return { available: true, summary, fixes, checkedRows: checked };
}

/**
 * Guardrails between the model and the workbook. Anything that is not a
 * plain, allowed correction of a whitelisted column is rejected:
 *   • column must map to a real sheet header AND be QA-relevant
 *   • Service_Name "to" must be a canonical SERVICES key
 *   • the model's claimed "from" must match the real cell value (numeric /
 *     truncation tolerant) — a wrong "from" means it is inventing the row's
 *     state, e.g. trying to fill a cell that is not empty
 *   • corrections must actually change the cell (checked against the real
 *     row values, not the model's claimed "from")
 *   • AUTO-INPUT fills (empty cell) must be grounded in the per-service
 *     reference statistics — only values the correct template actually
 *     uses for that row's Service_Name, so nothing is ever invented
 * Duplicate (row, column) suggestions: the last one wins.
 */
export function sanitizeAiFixes(
  rawFixes: unknown,
  headers: string[],
  rows: string[][],
  profile: ReferenceProfile
): { fixes: AiFix[]; rejected: number } {
  const rowCount = rows.length;
  // headerKey -> 0-based column index (first match wins).
  const colByKey = new Map<string, number>();
  headers.forEach((h, i) => {
    const k = headerKey(h);
    if (k && !colByKey.has(k)) colByKey.set(k, i);
  });
  const serviceColIdx = colByKey.get("servicename") ?? -1;
  let rejected = 0;
  const out = new Map<string, AiFix>();

  if (!Array.isArray(rawFixes)) {
    return { fixes: [], rejected: rawFixes ? 1 : 0 };
  }

  for (const item of rawFixes.slice(0, 400)) {
    if (!item || typeof item !== "object") {
      rejected++;
      continue;
    }
    const o = item as Record<string, unknown>;
    const rowNum = Math.floor(Number(o.row));
    const column = String(o.column ?? "").trim();
    const to = String(o.to ?? "").trim();
    const reason = String(o.reason ?? "").trim().slice(0, 240);
    const key = headerKey(column);

    if (!Number.isFinite(rowNum) || rowNum < 1 || rowNum > rowCount) {
      rejected++;
      continue;
    }
    const colIdx = colByKey.get(key);
    if (colIdx === undefined || !QA_FOCUS_KEYS.has(key)) {
      rejected++;
      continue;
    }
    if (!to || to.length > 200) {
      rejected++;
      continue;
    }

    // Ground truth for this cell — the model's "from" is not trusted for
    // classification, but it must still MATCH the real value: a model that
    // misreports the current state (e.g. claims a fill on a non-empty cell)
    // is guessing about the row and gets rejected outright.
    const realCell = String(rows[rowNum - 1]?.[colIdx] ?? "").trim();
    const claimedFrom = String(o.from ?? "").trim();
    const normFrom = (s: string): string => s.replace(/\s+/g, " ").trim();
    const numFrom = parseAmount(claimedFrom);
    const numReal = parseAmount(realCell);
    // Tolerances: numeric formatting ("120,000" vs "120000") and payload
    // truncation (AI echoes a ≥100-char prefix of a very long cell).
    const fromMatches =
      normFrom(claimedFrom) === normFrom(realCell) ||
      (numFrom !== null && numReal !== null && numFrom === numReal) ||
      (claimedFrom.length >= 100 && normFrom(realCell).startsWith(normFrom(claimedFrom)));
    if (!fromMatches) {
      rejected++;
      continue;
    }
    const isFill = realCell === "";
    if (!isFill && to === realCell) {
      rejected++; // no-op fix
      continue;
    }
    // AUTO-INPUT grounding: what the correct template uses for the row's
    // Service_Name. Fills without reference backing are rejected.
    const stat =
      isFill && serviceColIdx >= 0
        ? profile.serviceStats[
            looseKey(String(rows[rowNum - 1]?.[serviceColIdx] ?? ""))
          ]
        : undefined;

    // Column-specific validation + canonical-casing rewrite.
    let finalTo = to;
    if (key === "servicename") {
      if (isFill) {
        rejected++; // never auto-input the service itself
        continue;
      }
      const canonical = SERVICE_LOOKUP[looseKey(to)];
      if (!canonical) {
        rejected++;
        continue;
      }
      finalTo = canonical;
    } else if (
      key === "senderaccounttype" ||
      key === "recieveraccounttype" ||
      key === "receiveraccounttype"
    ) {
      const vocab =
        key === "senderaccounttype"
          ? profile.senderAccountTypes
          : profile.receiverAccountTypes;
      const canonical = vocab.length ? canonicalFromList(vocab, to) : to;
      if (!canonical) {
        rejected++;
        continue;
      }
      if (isFill) {
        // Grounded fill: only a type the reference uses for this service.
        const allowed =
          key === "senderaccounttype"
            ? stat?.senderTypes
            : stat?.receiverTypes;
        if (
          !stat ||
          !allowed?.length ||
          !canonicalFromList(allowed, canonical)
        ) {
          rejected++;
          continue;
        }
      }
      finalTo = canonical;
    } else if (key === "amount" || key === "receiveramount") {
      const n = parseAmount(to);
      if (n === null) {
        rejected++;
        continue;
      }
      if (isFill) {
        // Grounded fill: only an amount the reference uses for this service.
        if (!stat || !stat.amounts.length) {
          rejected++;
          continue;
        }
        if (!stat.amounts.some((a) => parseAmount(a) === n)) {
          rejected++;
          continue;
        }
      }
      finalTo = String(n);
    } else if (key === "senderaccount" || key === "receiveraccount") {
      // Accounts are never altered or invented: fills must be an exact
      // value the reference uses for this service; corrections rejected.
      const allowed =
        key === "senderaccount"
          ? stat?.senderAccounts
          : stat?.receiverAccounts;
      if (!isFill || !stat || !allowed?.length || !allowed.includes(to)) {
        rejected++;
        continue;
      }
    } else if (
      key === "accountcurrency" ||
      key === "recievercurrency" ||
      key === "receivercurrency"
    ) {
      if (isFill) {
        rejected++; // no per-service reference backing for currencies
        continue;
      }
      const canonical = profile.currencies.length
        ? canonicalFromList(profile.currencies, to)
        : to;
      if (!canonical) {
        rejected++;
        continue;
      }
      finalTo = canonical;
    } else if (isFill) {
      // Free-text columns (Scenarios, CoS, …) are corrections-only.
      rejected++;
      continue;
    }

    out.set(`${rowNum}||${key}`, {
      row: rowNum,
      column,
      from: realCell,
      to: finalTo,
      reason:
        reason ||
        (isFill
          ? "Auto-filled from the reference template for this service"
          : "Corrected by AI agent"),
      fill: isFill,
    });
  }

  return { fixes: [...out.values()].slice(0, 200), rejected };
}

