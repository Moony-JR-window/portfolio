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
    const provider = String(formData.get("provider") || "auto") as QaProvider;

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

    // oxalpha runs in "browser" mode by default: open a real Chrome on
    // oxalpha.com/chat once and reuse it for every row so Turnstile is solved by
    // the browser (domain-valid token) and session cookies/XSRF are the
    // browser's own — the "fully automatic" path. Set OXALPHA_BROWSER=0 to
    // force the manual cookie/turnstile fetch (needs pasted/env credentials).
    //
    // OXALPHA ONLY: when the user picks ⚡ oxalpha we never silently switch to
    // another AI (no DeepSeek/Pollinations fallback). If oxalpha cannot answer
    // (e.g. Vercel serverless has no browser/Turnstile), the row simply fails
    // and the 📋 Logs tab shows the exact URL/status/response for each failure.
    const browserMode = provider === "oxalpha" && process.env.OXALPHA_BROWSER !== "0";
    let oxSession: Awaited<ReturnType<typeof openOxalphaSession>> | null = null;
    let rawFetch: ((system: string, user: string, model: string) => Promise<RawFetchReply | null>) | undefined;
    if (browserMode) {
      try {
        oxSession = await openOxalphaSession({ model: oxAlphaCreds.model });
        rawFetch = oxSession.ask;
      } catch (err) {
        console.error("[mini-fix] oxalpha browser launch failed:", err);
        oxSession = null;
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
        rawFetch
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
    const fixed = buildPreviewMatrix(fixedAoa, hr, 60);
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