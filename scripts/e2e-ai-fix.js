/**
 * E2E test for POST /api/qa/ai-fix (dev server must be running on :3000).
 * Builds a deliberately-broken copy of the reference template and posts it.
 */
const fs = require("fs");
const ExcelJS = require("exceljs");

(async () => {
  const src =
    "excel_data/Wing Bank Regression Testcase Template 1.5_unmerged_renamed.xlsx";
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(src);
  const ws = wb.getWorksheet("Biinding");
  if (!ws) throw new Error("Biinding sheet missing");
  const hr = 1;

  // Break 4 cells across the QA columns:
  ws.getRow(hr + 1).getCell(4).value = "wingg to wingg"; // Service_Name r1
  ws.getRow(hr + 2).getCell(8).value = "PSP!!"; // Sender_Account_Type r2
  ws.getRow(hr + 3).getCell(12).value = "12O,000"; // Amount r3
  ws.getRow(hr + 4).getCell(16).value = "FCC"; // Reciever_Account_Type r4
  // AUTO-INPUT test bed: blank the Amount on data row 5 — the AI agent must
  // fill it with a value the reference template actually uses for that row's
  // Service_Name (never invented).
  ws.getRow(hr + 5).getCell(12).value = null;

  const buf = await wb.xlsx.writeBuffer();
  const form = new FormData();
  form.append("file", new Blob([buf]), "broken_testcase.xlsx");
  form.append("sheet", "Biinding");
  form.append("headerRow", String(hr));

  const res = await fetch("http://localhost:3000/api/qa/ai-fix", {
    method: "POST",
    body: form,
  });
  const json = await res.json();
  console.log("HTTP", res.status, "success:", json.success);
  if (!json.success) {
    console.log("error:", json.error);
    process.exit(1);
  }
  console.log("renameCount:", json.renameCount, "unmerged:", json.unmergedRanges);
  console.log("ai:", {
    available: json.ai.available,
    checkedRows: json.ai.checkedRows,
    suggested: json.ai.suggested,
    applied: json.ai.applied,
    filled: json.ai.filled,
    summary: json.ai.summary,
  });
  for (const f of json.ai.fixes) {
    console.log(
      `  FIX r${f.row} ${f.column}: "${f.from}" -> "${f.to}" (${f.reason})${f.fill ? " [AUTO-FILL]" : ""}`
    );
  }

  // Re-read the AI-fixed workbook and verify the broken cells were repaired.
  const fixed = new ExcelJS.Workbook();
  await fixed.xlsx.load(Buffer.from(json.fixedBase64, "base64"));
  const fws = fixed.getWorksheet("Biinding");
  const v = (r, c) => String(fws.getRow(r).getCell(c).value ?? "");
  console.log("\npost-fix values:");
  console.log("  r1 Service_Name:", v(hr + 1, 4));
  console.log("  r2 Sender type:", v(hr + 2, 8));
  console.log("  r3 Amount:", v(hr + 3, 12));
  console.log("  r4 Receiver type:", v(hr + 4, 16));
  console.log("  r5 Amount (was blank):", v(hr + 5, 12));

  const bad = [];
  if (v(hr + 1, 4) !== "Wing to Wing") bad.push("Service_Name not canonical");
  if (v(hr + 2, 8) !== "PSP") bad.push("Sender type not fixed: " + v(hr + 2, 8));
  if (Number(v(hr + 3, 12)) !== 120000) bad.push("Amount not numeric: " + v(hr + 3, 12));
  if (v(hr + 4, 16) !== "FC") bad.push("Receiver type not fixed: " + v(hr + 4, 16));
  // AUTO-INPUT assertions: the blank amount must come back as a real number
  // and at least one applied fix must be an auto-fill.
  const r5 = v(hr + 5, 12);
  if (!r5 || Number.isNaN(Number(r5))) {
    bad.push("blank Amount r5 was not auto-filled: " + JSON.stringify(r5));
  }
  if (!(json.ai.filled >= 1)) bad.push("ai.filled is 0 — auto-input did not run");
  if (!json.ai.available) bad.push("AI was unavailable (is AI_API_KEY set?)");
  if (bad.length) {
    console.log("\nE2E ISSUES:", bad);
    process.exit(1);
  }
  console.log("\nE2E PASSED");
})().catch((e) => {
  console.error("E2E FAILED:", e);
  process.exit(1);
});
