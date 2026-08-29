/**
 * Tiny 1-row probe against the running dev server — isolates whether the
 * E2E AI failure is payload-size related or environment related.
 * Run: node scripts/probe-tiny.js
 */
const ExcelJS = require("exceljs");
const fs = require("fs");

(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(
    "excel_data/Wing Bank Regression Testcase Template 1.5_unmerged_renamed.xlsx"
  );
  const ws = wb.getWorksheet("Biinding");
  // Keep only data row 2, then break it:
  ws.spliceRows(3, 72); // drop rows 3..74
  ws.getRow(2).getCell(4).value = "wingg to wingg"; // Service_Name typo
  ws.getRow(2).getCell(12).value = ""; // Amount -> empty (auto-input target)
  ws.getRow(2).getCell(8).value = ""; // Sender_Account_Type -> empty
  ws.getRow(2).getCell(16).value = ""; // Receiver_Account_Type -> empty
  const buf = await wb.xlsx.writeBuffer();
  fs.writeFileSync("/tmp/tiny-probe.xlsx", Buffer.from(buf));

  const form = new FormData();
  form.append(
    "file",
    new Blob([fs.readFileSync("/tmp/tiny-probe.xlsx")], {
      type: "application/octet-stream",
    }),
    "tiny-probe.xlsx"
  );
  form.append("sheet", "Biinding");
  form.append("headerRow", "1");

  const t0 = Date.now();
  const res = await fetch("http://localhost:3000/api/qa/ai-fix", {
    method: "POST",
    body: form,
  });
  const json = await res.json();
  console.log("HTTP", res.status, "in", Date.now() - t0, "ms");
  console.log("ai:", JSON.stringify(json.ai, null, 2));
  if (json.fixedBase64) {
    fs.writeFileSync("/tmp/tiny-fixed.xlsx", Buffer.from(json.fixedBase64, "base64"));
    const chk = new ExcelJS.Workbook();
    await chk.xlsx.readFile("/tmp/tiny-fixed.xlsx");
    const cws = chk.getWorksheet("Biinding");
    const g = (c) => String(cws.getRow(2).getCell(c).value ?? "");
    console.log("fixed row2: service=", g(4), "senderType=", g(8), "amount=", g(12), "receiverType=", g(16));
  }
})().catch((e) => {
  console.error("PROBE FAILED:", e);
  process.exit(1);
});
