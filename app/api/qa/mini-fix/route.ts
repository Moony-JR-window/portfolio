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
} from "@/lib/qaAgent";
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
 *      column is NOT used) and return the correct Sender_Account_Type and
 *      Reciever_Account_Type.
 *   3. Apply ONLY those two column fixes — every other cell is untouched —
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

    // Access-key gate — same guard as the other /qa endpoints.
    if (!isValidQaKey(formData.get("key"))) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid or missing QA access key.",
        },
        { status: 403 }
      );
    }

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
    const agent = await miniFixAccountTypes(headers, dataRows, profile);

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