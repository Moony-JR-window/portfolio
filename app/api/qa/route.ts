import { NextRequest, NextResponse } from "next/server";
import { processWorkbook, workbookToBase64 } from "@/lib/excelLogic";

/**
 * POST /api/qa
 * In-browser Excel QA endpoint, backing the "/qa" chat command.
 *
 * Runs the same logic as the standalone `excel_rename.py` tool:
 *   • Unmerge every merged range and fill the top-left value into the cells.
 *   • Rename the Service_Name column to the canonical SERVIC3 map key.
 *   • Return bounded Original/Fixed previews plus the fixed workbook (base64)
 *     so the client can offer a one-click download.
 *
 * Body: multipart/form-data
 *   file      — the .xlsx / .xlsm workbook   (required)
 *   sheet     — sheet name to rename/apply QA on (optional; defaults to first)
 *   headerRow — 1-based header row          (optional; defaults to 1)
 *
 * The response is intentionally kept JSON (not a file stream) so the client
 * can show previews + stats and download in a single round-trip.
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

    const sheetName = String(formData.get("sheet") || "");
    let headerRow = Number(formData.get("headerRow"));
    if (!Number.isFinite(headerRow) || headerRow < 1) headerRow = 1;

    const buffer = await file.arrayBuffer();
    const result = await processWorkbook(buffer, sheetName, headerRow);

    if (!result.ok || !result.wb) {
      return NextResponse.json(
        { success: false, error: result.error || "Could not process the workbook." },
        { status: 400 }
      );
    }

    const fixedBase64 = await workbookToBase64(result.wb);

    return NextResponse.json({
      success: true,
      fileName: file.name,
      sheetNames: result.sheetNames,
      sheetName: result.sheetName,
      headerRow: result.headerRow,
      totalRows: result.totalRows,
      previewRows: result.previewRows,
      unmergedRanges: result.unmergedRanges,
      serviceCol: result.serviceCol,
      renameCount: result.renameCount,
      original: result.original,
      fixed: result.fixed,
      fixedBase64,
    });
  } catch (error) {
    console.error("[QA] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to process the workbook.",
      },
      { status: 500 }
    );
  }
}