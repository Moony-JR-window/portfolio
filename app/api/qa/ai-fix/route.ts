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
  aiFixRows,
  headerKey,
  loadReferenceProfile,
  type AiFix,
  type QaProvider,
} from "@/lib/qaAgent";
import { isValidQaKey } from "@/lib/qaKey";

export const maxDuration = 60;

/**
 * POST /api/qa/ai-fix
 * The "✨ AI Fix" step of the "/qa" Excel QA window.
 *
 * Pipeline:
 *   1. Deterministic QA (lib/excelLogic.ts): unmerge every merged range on
 *      all sheets + rename Service_Name to its canonical SERVICES key.
 *   2. AI agent pass (lib/qaAgent.ts): the uploaded rows are compared, via
 *      the AI, against the CORRECT reference template
 *      `excel_data/Wing Bank Regression Testcase Template
 *      1.5_unmerged_renamed.xlsx` — making sure Service_Name, Sender
 *      type/account, Amount and Receiver type/account are correct.
 *   3. Validated AI fixes are applied to the workbook and returned with a
 *      human-readable report + the fixed workbook (base64).
 *
 * Body: multipart/form-data — file (required), key (required; see lib/qaKey.ts),
 * sheet, headerRow (optional).
 *
 * Fail-soft: when the AI provider is unreachable the response still carries
 * the rule-based fixed workbook with `ai.available: false`.
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

    // Choose the AI provider for the agent pass. The window picks
    // "groq" / "deepseek" / "pollinations" (or omit for the default auto chain).
    const provider = String(formData.get("provider") || "auto") as QaProvider;

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

    // ---- 2) AI agent pass against the reference template ----
    const aoa = sheetToAoa(ws);
    const hr = result.headerRow;
    const headerArr = (aoa[hr - 1] || []).map((h) =>
      h === null || h === undefined ? "" : String(h)
    );
    const headers = makeUniqueHeaders(headerArr);
    const dataRows = aoa
      .slice(hr)
      .map((r) => (r || []).map((v) => (v === null || v === undefined ? "" : String(v))));

    const profile = await loadReferenceProfile();
    let agent = {
      available: false,
      summary: "",
      fixes: [] as AiFix[],
      checkedRows: 0,
    };
    if (profile) {
            agent = await aiFixRows(headers, dataRows, profile, provider);
    } else {
      agent.summary =
        "Reference template not readable on the server — applied rule-based fixes only.";
    }

    return await finish(ws, hr, file.name, result, agent, aoa);
  } catch (error) {
    console.error("[QA AI-Fix] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to AI-fix the workbook.",
      },
      { status: 500 }
    );
  }
}
type ProcessResult = Awaited<ReturnType<typeof processWorkbook>>;

/**
 * Apply the validated AI fixes to the worksheet, rebuild the preview and
 * respond. Split into a helper so the request handler stays readable.
 */
async function finish(
  ws: ExcelJS.Worksheet,
  hr: number,
  fileName: string,
  result: ProcessResult,
  agent: {
    available: boolean;
    summary: string;
    fixes: AiFix[];
    checkedRows: number;
  },
  aoa: unknown[][]
) {
  if (!result.wb) {
    throw new Error("Workbook handle lost after processing.");
  }

  // ---- 3) Apply the validated fixes ----
  const appliedFixes: AiFix[] = [];
  if (agent.fixes.length) {
    // headerKey -> 0-based column index (first match on the header row).
    const colByKey = new Map<string, number>();
    (aoa[hr - 1] || []).forEach((h, i) => {
      const k = headerKey(h);
      if (k && !colByKey.has(k)) colByKey.set(k, i);
    });

    for (const fix of agent.fixes) {
      const colIdx = colByKey.get(headerKey(fix.column));
      if (colIdx === undefined) continue;
      // fix.row is 1-based within the data area (1 = first row under the
      // header), so its Excel row is hr + fix.row.
      const excelRow = hr + fix.row;
      if (excelRow <= hr) continue;

      const key = headerKey(fix.column);
      // AUTO-INPUT fills may only write into cells that are actually empty
      // in the pre-fix snapshot (aoa) — never overwrite existing data.
      if (fix.fill || fix.from === "") {
        const current = String(aoa[excelRow - 1]?.[colIdx] ?? "").trim();
        if (current !== "") continue;
      }
      let value: string | number = fix.to;
      if (key === "amount" || key === "receiveramount") {
        const n = Number(fix.to.replace(/[,\s]/g, ""));
        if (!Number.isFinite(n)) continue; // guardrail double-check
        value = n; // keep amounts numeric in the exported workbook
      }
      try {
        ws.getRow(excelRow).getCell(colIdx + 1).value = value;
        appliedFixes.push(fix);
      } catch {
        // out-of-range row etc. — skip silently, it is only a suggestion
      }
    }
  }

  // ---- 4) Rebuild the preview + export the AI-fixed workbook ----
  const fixedAoa = sheetToAoa(ws);
  const fixed = buildPreviewMatrix(fixedAoa, hr, 60);
  const fixedBase64 = await workbookToBase64(result.wb);
  const fixedRowsLen = hr - 1 < fixedAoa.length ? fixedAoa.length - hr : 0;

  return NextResponse.json({
    success: true,
    fileName,
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
}

