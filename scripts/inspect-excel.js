const ExcelJS = require("exceljs");
(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(
    "excel_data/Wing Bank Regression Testcase Template 1.5_unmerged_renamed.xlsx"
  );
  const ws = wb.getWorksheet("Biinding");
  // Probe the real types of Sender_Account (col 9), Amount (col 12), Receiver_Account (17)
  for (const [label, col] of [["Sender_Account", 9], ["Amount", 12], ["Receiver_Account", 17], ["Receiver_Type", 16]]) {
    for (const r of [2, 3, 10, 30]) {
      const cell = ws.getRow(r).getCell(col);
      console.log(`${label} r${r}:`, JSON.stringify(cell.value));
    }
  }
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
