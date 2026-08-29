/**
 * Live AI test of aiFixRows with the real reference rows (no Next server).
 * Run: npx tsx --env-file=.env.local scripts/test-ai-live.ts
 */
import ExcelJS from "exceljs";
import { aiFixRows, loadReferenceProfile } from "../lib/qaAgent";
import { makeUniqueHeaders, sheetToAoa } from "../lib/excelLogic";

async function main() {
  const profile = await loadReferenceProfile();
  if (!profile) throw new Error("no profile");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(
    "excel_data/Wing Bank Regression Testcase Template 1.5_unmerged_renamed.xlsx"
  );
  const ws = wb.getWorksheet("Biinding");
  if (!ws) throw new Error("Biinding sheet missing");
  // Break the same 4 cells as the E2E + blank one Amount for AUTO-INPUT.
  ws.getRow(2).getCell(4).value = "wingg to wingg";
  ws.getRow(3).getCell(8).value = "PSP!!";
  ws.getRow(4).getCell(12).value = "12O,000";
  ws.getRow(5).getCell(16).value = "FCC";
  ws.getRow(6).getCell(12).value = null; // empty Amount -> AI should fill it

  const aoa = sheetToAoa(ws);
  const headers = makeUniqueHeaders(
    (aoa[0] || []).map((h) => (h == null ? "" : String(h)))
  );
  const rows = aoa
    .slice(1)
    .map((r) => (r || []).map((v) => (v == null ? "" : String(v))));

  const t0 = Date.now();
  const agent = await aiFixRows(headers, rows, profile);
  console.log("agent in", Date.now() - t0, "ms:", {
    available: agent.available,
    checkedRows: agent.checkedRows,
    suggested: agent.fixes.length,
    summary: agent.summary,
  });
  for (const f of agent.fixes) {
    console.log(
      `  FIX r${f.row} ${f.column}: "${f.from}" -> "${f.to}"${f.fill ? " [AUTO-FILL]" : ""}`
    );
  }
}

main().catch((e) => {
  console.error("LIVE TEST FAILED:", e);
  process.exit(1);
});
