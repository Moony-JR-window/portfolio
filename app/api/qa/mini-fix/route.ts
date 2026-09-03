import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import {
  processWorkbook,
  workbookToBase64,
  sheetToAoa,
  buildPreviewMatrix,
  makeUniqueHeaders,
} from "@/lib/excelLogic";
import {
  miniFixAccountTypes,
  loadReferenceProfile,
  headerKey,
  type AiFix,
  type QaProvider,
  type RawFetchReply,
} from "@/lib/qaAgent";
import { openOxalphaSession } from "@/lib/oxalphaBrowser";
import { isValidQaKey } from "@/lib/qaKey";

export const maxDuration = 60;

/**
 * POST /api/qa/mini-fix
 * The "🪄 Auto Types" step of the "/qa" Excel QA window.
 *
 * Pipeline:
 *   1. Deterministic QA (lib/excelLogic.ts): unmerge + Service_Name rename.
 *   2. For EVERY data row ask the AI (configured provider, free Pollinations
 *      fallback) to read the row's Test_Case_Description (the Scenarios
 *      column is NOT used) and return the correct Sender_Account_Type,
 *      Reciever_Account_Type, Account_Currency and Reciever_Currency.
 *   3. Apply ONLY those four column fixes — every other cell is untouched —
 *      then return the fixed workbook + report.
 *
 * Body: multipart/form-data — file (required), key (required; lib/qaKey.ts),
 * sheet, headerRow (optional).
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { success: false, error: "No file uploaded. Field name must be 'file'." },
        { status: 400 }
      );
    }

    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if (!["xlsx", "xlsm"].includes(ext)) {
      return NextResponse.json(
        {
          success: false,
          error: "Unsupported file type. Please upload a .xlsx or .xlsm file.",
        },
        { status: 400 }
      );
    }

    // Access-key gate — key required for all modes. Default to
    // "deepseek" for backward compatibility with old clients.
        const aiMode = String(formData.get("aiMode") || "deepseek");
    if (!isValidQaKey(formData.get("key"))) {
      return NextResponse.json(
        { success: false, error: "Invalid or missing QA access key." },
        { status: 403 }
      );
    }

    // Choose the AI provider for the account-type pass (groq/deepseek/pollinations/oxalpha).
    // OXALPHA ONLY: the requested provider is authoritative — when the user
    // picks ⚡ oxalpha we never silently switch to another AI.
    const provider = String(formData.get("provider") || "auto") as QaProvider;
    console.log(`[mini-fix] provider=${provider} aiMode=${aiMode}`);

    // Optional oxalpha.com session credentials (Cookie + XSRF token + model +
    // Turnstile token). Only consumed when provider === "oxalpha"; otherwise ignored.
    const oxAlphaCreds = {
      cookie: String(formData.get("oxcookie") || ""),
      csrf: String(formData.get("oxcsrf") || ""),
      model: String(formData.get("oxmodel") || "") || undefined,
      turnstile: String(formData.get("oxturnstile") || "") || undefined,
      turnstileField:
        String(formData.get("oxturnstilefield") || "") || undefined,
    };

    // Optional free-text command typed by the user (e.g. merchant account
    // numbers: "my fc khr is 1234, usd is 4522, psp khr 2823..."). Passed to
    // the AI together with each row's Test_Case_Description.
    const extraCommand = String(formData.get("extraCommand") || "").slice(0, 4000).trim();

    const sheetName = String(formData.get("sheet") || "");
    let headerRow = Number(formData.get("headerRow"));
    if (!Number.isFinite(headerRow) || headerRow < 1) headerRow = 1;

    // ---- 1) Deterministic pass (same engine as POST /api/qa) ----
    const buffer = await file.arrayBuffer();
    const result = await processWorkbook(buffer, sheetName, headerRow);
    if (!result.ok || !result.wb) {
      return NextResponse.json(
        {
          success: false,
          error: result.error || "Could not process the workbook.",
        },
        { status: 400 }
      );
    }
    const ws = result.wb.getWorksheet(result.sheetName);
    if (!ws) {
      return NextResponse.json(
        { success: false, error: "Sheet could not be opened." },
        { status: 400 }
      );
    }

    // ---- 2) 🪄 Auto Types pass ----
    const aoa = sheetToAoa(ws);
    const hr = result.headerRow;
    const headerArr = (aoa[hr - 1] || []).map((h) =>
      h === null || h === undefined ? "" : String(h)
    );
    const headers = makeUniqueHeaders(headerArr);
    const dataRows = aoa
      .slice(hr)
      .map((r) =>
        (r || []).map((v) => (v === null || v === undefined ? "" : String(v)))
      );

    const profile = await loadReferenceProfile();
    if (!profile) {
      return NextResponse.json(
        { success: false, error: "Reference template not readable on the server." },
        { status: 500 }
      );
    }

    // Provider priority for oxalpha:
    //   1) DIRECT FETCH (Postman-proven): when a session Cookie is available
    //      (env OXALPHA_COOKIE / OXALPHA_CSRF_TOKEN or pasted creds) the plain
    //      HTTPS request works — no browser, no Turnstile token needed. Fast.
    //   2) BROWSER fallback: only when no cookie is configured, launch a real
    //      Chrome on oxalpha.com/chat to solve Turnstile and carry the session.
    const hasDirectCreds = Boolean(
      (oxAlphaCreds.cookie && oxAlphaCreds.csrf) ||
        (process.env.OXALPHA_COOKIE && process.env.OXALPHA_CSRF_TOKEN)
    );
    const browserMode =
      provider === "oxalpha" &&
      !hasDirectCreds &&
      process.env.OXALPHA_BROWSER !== "0";
    let oxSession: Awaited<ReturnType<typeof openOxalphaSession>> | null = null;
    let rawFetch: ((system: string, user: string, model: string) => Promise<RawFetchReply | null>) | undefined;
    if (browserMode) {
      try {
        oxSession = await openOxalphaSession({ model: oxAlphaCreds.model });
        // Probe once before committing to the batch: if oxalpha is
        // quota-blocked / challenge-walled, fail the run NOW (fast, honest)
        // instead of grinding through every row slowly.
        const probe = await oxSession.ask(
          "Reply with exactly this JSON and nothing else: {\"ok\":true}",
          "ping"
        );
        if (!probe || !probe.content || (probe.status && probe.status >= 400)) {
          await oxSession.close().catch(() => {});
          const detail = probe
            ? `HTTP ${probe.status} ${probe.resBody || ""}`.trim()
            : "no response from the page";
          console.error("[mini-fix] oxalpha probe failed:", detail);
          return NextResponse.json(
            {
              success: false,
              error: `⚡ oxalpha is not answering (probe: ${detail}). Run aborted — no fallback is used for oxalpha. Wait for the quota/Turnstile to clear and try again.`,
            },
            { status: 502 }
          );
        }
        rawFetch = oxSession.ask;
      } catch (err) {
        console.error("[mini-fix] oxalpha browser launch failed:", err);
        if (oxSession) await oxSession.close().catch(() => {});
        oxSession = null;
        return NextResponse.json(
          {
            success: false,
            error:
              "Could not launch the oxalpha browser session (Chrome missing or blocked). Run aborted — no fallback is used for oxalpha.",
          },
          { status: 502 }
        );
      }
    }

    let agent;
    try {
      agent = await miniFixAccountTypes(
        headers,
        dataRows,
        profile,
        provider,
        undefined,
        oxAlphaCreds,
        rawFetch,
        extraCommand
      );
    } finally {
      if (oxSession) await oxSession.close().catch(() => {});
    }

    // ---- 3) Apply ONLY the account-type fixes + export ----
    const colByKey = new Map<string, number>();
    headerArr.forEach((h, i) => {
      const k = headerKey(h);
      if (k && !colByKey.has(k)) colByKey.set(k, i);
    });
    const appliedFixes: AiFix[] = [];
    for (const fix of agent.fixes) {
      const colIdx = colByKey.get(headerKey(fix.column));
      if (colIdx === undefined) continue;
      const excelRow = hr + fix.row;
      if (excelRow <= hr) continue;
      // Fills may only write into genuinely empty cells.
      if (fix.fill || fix.from === "") {
        const current = String(aoa[excelRow - 1]?.[colIdx] ?? "").trim();
        if (current !== "") continue;
      }
      try {
        ws.getRow(excelRow).getCell(colIdx + 1).value = fix.to;
        appliedFixes.push(fix);
      } catch {
        // out-of-range row — skip silently
      }
    }

    const fixedAoa = sheetToAoa(ws);
    const fixed = buildPreviewMatrix(fixedAoa, hr, 1000);
    const fixedBase64 = await workbookToBase64(result.wb);
    const fixedRowsLen = hr - 1 < fixedAoa.length ? fixedAoa.length - hr : 0;

    return NextResponse.json({
      success: true,
      fileName: file.name,
      sheetNames: result.sheetNames,
      sheetName: result.sheetName,
      headerRow: hr,
      totalRows: fixedRowsLen,
      previewRows: fixed.rows.length,
      unmergedRanges: result.unmergedRanges,
      serviceCol: result.serviceCol,
      renameCount: result.renameCount,
      original: result.original,
      fixed,
      fixedBase64,
      ai: {
        available: agent.available,
        checkedRows: agent.checkedRows,
        suggested: agent.fixes.length,
        applied: appliedFixes.length,
        filled: appliedFixes.filter((f) => f.fill).length,
        summary: agent.summary,
        fixes: appliedFixes,
        requestLogs: agent.requestLogs,
      },
    });
  } catch (error) {
    console.error("[QA Mini-Fix] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to run the auto-types pass.",
      },
      { status: 500 }
    );
  }
}