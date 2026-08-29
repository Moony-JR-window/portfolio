/**
 * Offline test of the qaAgent pipeline (no AI call):
 *   1. loadReferenceProfile() against the real reference template.
 *   2. sanitizeAiFixes() guardrails with a mix of valid/invalid suggestions.
 *   3. Full route pipeline minus the AI: processWorkbook -> apply mock fixes
 *      -> export -> re-read to confirm the fixes landed.
 */
import ExcelJS from "exceljs";
import { loadReferenceProfile, sanitizeAiFixes, headerKey } from "../lib/qaAgent";
import {
  processWorkbook,
  sheetToAoa,
  makeUniqueHeaders,
  workbookToBase64,
} from "../lib/excelLogic";

async function main() {
  const profile = await loadReferenceProfile();
  if (!profile) throw new Error("reference profile failed to load");
  console.log("profile.services:", profile.serviceKeys.length);
  console.log("profile.senderTypes:", profile.senderAccountTypes);
  console.log("profile.senderAccounts:", profile.senderAccountSamples.slice(0, 4));
  console.log("profile.receiverTypes:", profile.receiverAccountTypes.length);
  console.log(
    "profile.receiverSamplesByType keys:",
    Object.keys(profile.receiverAccountSamplesByType).slice(0, 6)
  );
  console.log("profile.currencies:", profile.currencies);
  if (!profile.serviceKeys.length) throw new Error("no service keys extracted");
  if (!profile.senderAccountTypes.length) throw new Error("no sender types");

  // --- Guardrail tests ---
  const headers = [
    "No", "TestID", "Channels", "Service_Name", "Scenarios", "Testcase_Type",
    "Test_Case_Description", "Sender_Account_Type", "Sender_Account",
    "Amount", "Reciever_Account_Type", "Receiver_Account",
  ];
  const rows = [
    ["1", "T1", "", "Wingg to Wing", "Perform from PSP KHR to FC U", "Normal", "d", "PSP", "07782083", "12O,000", "FC", "103634533"],
    ["2", "T2", "", "wing wei luy", "Perform from FC USD to PSP KHR", "Normal", "d", "FC", "103634567", "5000", "PPSHV", "PPSHV-001"],
    ["3", "T3", "", "KhQr (wingbank to customer other bank)", "Perform", "Normal", "d", "PSP", "07782087", "1000", "Merchant App FC", "000123"],
    // row 4: canonical service with EMPTY Sender_Account_Type + Amount —
    // the AUTO-INPUT fill test bed (must be grounded in per-service stats).
    ["4", "T4", "", "Wing to Wing", "Perform", "Normal", "d", "", "07782083", "", "FC", "103634533"],
  ];
  const raw = [
    // valid: fuzzy service name -> canonical
    { row: 1, column: "Service_Name", from: "Wingg to Wing", to: "wing-to-wing", reason: "typo" },
    // valid: case-insensitive canonical match
    { row: 2, column: "Service_Name", from: "wing wei luy", to: "Wing Wei Luy" },
    // INVALID: not a canonical service
    { row: 3, column: "Service_Name", from: "x", to: "Made Up Service" },
    // INVALID: unknown column
    { row: 1, column: "Not_A_Column", from: "a", to: "b" },
    // INVALID: row out of range
    { row: 99, column: "Service_Name", from: "a", to: "Wing to Wing" },
    // INVALID: non-numeric amount
    { row: 2, column: "Amount", from: "5000", to: "lots" },
    // valid: text amount with typo O -> number
    { row: 1, column: "Amount", from: "12O,000", to: "120,000" },
    // INVALID: sender type not in vocabulary
    { row: 1, column: "Sender_Account_Type", from: "PSP", to: "BANK" },
    // valid: receiver type vocabulary hit
    { row: 2, column: "Reciever_Account_Type", from: "PPSHV", to: "ppshv" },
    // valid: scenario consistency rewrite (free-text col)
    { row: 3, column: "Scenarios", from: "Perform", to: "Perform from PSP KHR to Merchant App FC" },
    // case/punctuation-only suggestion -> canonicalized to SERVICE_KEYS casing
    // (from must echo the REAL cell value exactly, as the AI is required to)
    { row: 3, column: "Service_Name", from: "KhQr (wingbank to customer other bank)", to: "khqr (wingbank to customer other bank)" },
    // INVALID fills: not grounded in the per-service reference
    { row: 4, column: "Amount", from: "", to: "99999999999" },
    { row: 4, column: "Sender_Account_Type", from: "", to: "zzz" },
    { row: 4, column: "Receiver_Account", from: "", to: "made-up-account" },
  ];
  // Per-service stats for the fill tests (must exist in the reference).
  const stat = profile.serviceStats["wing to wing"];
  if (!stat || !stat.amounts.length || !stat.senderTypes.length) {
    throw new Error("missing per-service stats for 'Wing to Wing'");
  }
  // VALID fills: exactly what the correct template uses for this service.
  raw.unshift(
    { row: 4, column: "Amount", from: "", to: stat.amounts[0], reason: "fill amount" },
    { row: 4, column: "Sender_Account_Type", from: "", to: stat.senderTypes[0], reason: "fill type" }
  );
  // INVALID receiver-type fill: a real type this service never uses.
  const otherReceiver = profile.receiverAccountTypes.find(
    (t) => !stat.receiverTypes.includes(t)
  );
  if (otherReceiver) {
    raw.push({ row: 4, column: "Reciever_Account_Type", from: "", to: otherReceiver });
  }
  const { fixes, rejected } = sanitizeAiFixes(raw, headers, rows, profile);
  console.log("\nsanitizer: accepted", fixes.length, "rejected", rejected);
  for (const f of fixes) console.log("  FIX", f);
  const expect: [string, string][] = [
    ["Service_Name", "Wing to Wing"],
    ["Service_Name", "Wing Wei Luy"],
    ["Service_Name", "KHQR(WingBank to customer other bank)"],
    ["Amount", "120000"],
    ["Reciever_Account_Type", "PPSHV"],
    ["Scenarios", "Perform from PSP KHR to Merchant App FC"],
  ];
  const got = fixes.map((f) => [f.column, f.to] as [string, string]);
  for (const e of expect) {
    if (!got.some((g) => g[0] === e[0] && g[1] === e[1])) {
      throw new Error(`expected fix missing: ${e.join(" -> ")}`);
    }
  }
  const amountFill = fixes.find((f) => f.row === 4 && f.column === "Amount");
  const typeFill = fixes.find(
    (f) => f.row === 4 && f.column === "Sender_Account_Type"
  );
  if (
    !amountFill ||
    !amountFill.fill ||
    amountFill.to !== String(Number(stat.amounts[0]))
  ) {
    throw new Error(`amount auto-fill failed: ${JSON.stringify(amountFill)}`);
  }
  if (
    !typeFill ||
    !typeFill.fill ||
    typeFill.to !== stat.senderTypes[0]
  ) {
    throw new Error(`sender-type auto-fill failed: ${JSON.stringify(typeFill)}`);
  }
  if (fixes.some((f) => f.row === 4 && f.column === "Receiver_Account")) {
    throw new Error("ungrounded account fill should have been rejected");
  }
  const expectedAccept = 8; // 6 corrections + 2 grounded fills
  const expectedReject = 8 + (otherReceiver ? 1 : 0); // 5 + 3 invalid fills (+1)
  if (fixes.length !== expectedAccept) {
    throw new Error(`expected ${expectedAccept} fixes, got ${fixes.length}`);
  }
  if (rejected !== expectedReject) {
    throw new Error(`expected ${expectedReject} rejections, got ${rejected}`);
  }
  console.log("guardrails + grounded auto-input OK");

  // --- Full pipeline (deterministic + apply) on a "broken" workbook ---
  const src =
    "excel_data/Wing Bank Regression Testcase Template 1.5_unmerged_renamed.xlsx";
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(src);
  const buf = await wb.xlsx.writeBuffer();
  const result = await processWorkbook(buf, "Biinding", 1);
  if (!result.ok || !result.wb) throw new Error(result.error || "process failed");
  const ws = result.wb.getWorksheet(result.sheetName)!;
  const aoa = sheetToAoa(ws);
  const hr = result.headerRow;
  const sheetHeaders = makeUniqueHeaders(
    (aoa[hr - 1] || []).map((h) => (h == null ? "" : String(h)))
  );
  // Corrupt 3 cells so we can verify the write-back below.
  ws.getRow(hr + 1).getCell(4).value = "wingg to wingg"; // Service_Name r1
  ws.getRow(hr + 2).getCell(8).value = "BANK"; // Sender type r2
  ws.getRow(hr + 3).getCell(12).value = "12O,000"; // Amount r3
  // NOTE: badRows must mirror the REAL sheet layout (sheetHeaders above) so
  // the from-match guard compares against the right column.
  const badRow = (service: string, senderType: string, amount: string): string[] => [
    "1", "T1", "", service, "Perform", "Normal", "d",
    senderType, "07782083", "Customer - Current Account Personal - Standard", "KHR",
    amount, "0", "0", "", "FC", "103634533", "High Yield Saving - Standard", "USD", "", "", "",
  ];
  const badRows = [
    badRow("wingg to wingg", "PSP", "120000"),
    badRow("Wing to Wing", "BANK", "120000"),
    badRow("Wing to Wing", "PSP", "12O,000"),
  ];
  const bad = sanitizeAiFixes(
    [
      { row: 1, column: "Service_Name", from: "wingg to wingg", to: "Wing to Wing", reason: "typo" },
      { row: 2, column: "Sender_Account_Type", from: "BANK", to: "PSP", reason: "8-digit phone" },
      { row: 3, column: "Amount", from: "12O,000", to: "120000", reason: "numeric" },
    ],
    sheetHeaders,
    badRows,
    profile
  );
  console.log(
    "\nwrite-back fixes:",
    bad.fixes.map((f) => `${f.row}:${f.column}->${f.to}`)
  );
  for (const fix of bad.fixes) {
    const colIdx = (aoa[hr - 1] || []).findIndex(
      (h) => headerKey(h) === headerKey(fix.column)
    );
    if (colIdx < 0) throw new Error(`column not found: ${fix.column}`);
    ws.getRow(hr + fix.row).getCell(colIdx + 1).value =
      fix.column === "Amount" ? Number(fix.to) : fix.to;
  }
  const out = await workbookToBase64(result.wb);
  const check = new ExcelJS.Workbook();
  // ExcelJS's .load typing wants the DOM-less Buffer alias; cast keeps both
  // Node 22 and ExcelJS type versions happy.
  await check.xlsx.load(Buffer.from(out, "base64") as unknown as ExcelJS.Buffer);
  const cws = check.getWorksheet(result.sheetName)!;
  const v = (r: number, c: number) => String(cws.getRow(r).getCell(c).value ?? "");
  if (v(hr + 1, 4) !== "Wing to Wing") throw new Error(`service write failed: ${v(hr + 1, 4)}`);
  if (v(hr + 2, 8) !== "PSP") throw new Error(`sender type write failed: ${v(hr + 2, 8)}`);
  if (Number(v(hr + 3, 12)) !== 120000) throw new Error(`amount write failed: ${v(hr + 3, 12)}`);
  console.log("write-back OK (service, sender type, amount)");
  console.log("\nALL OFFLINE TESTS PASSED");
}

main().catch((e) => {
  console.error("TEST FAILED:", e);
  process.exit(1);
});
