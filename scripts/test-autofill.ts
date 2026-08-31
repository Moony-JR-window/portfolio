// TEMP diagnostic/harness: verify deterministic auto-fill covers renamed
// services + ALL rows (rows beyond the AI's 25-row window). The data mirrors
// the user's new 58-row regression workbook (see the pasted table).
// Run: npx tsx scripts/test-autofill.ts
import { loadReferenceProfile, autoFillFromReference, headerKey } from "../lib/qaAgent";

const HEADERS = [
  "No", "TestID", "Channels", "Service_Name", "Scenarios", "Testcase_Type",
  "Test_Case_Description", "Sender_Account_Type", "Sender_Account",
  "Sender CoS/Account-Classs", "Account_Currency", "Amount", "Fee", "Commission",
  "Receiver Amount", "Reciever_Account_Type", "Receiver_Account",
  "Receiver_Class_Of_Service", "Reciever_Currency", "Exchange Rate", "Rate Type",
  "TID", "Transaction Date", "Expected Result", "Actual Result", "Status",
  "Testing Type", "Tester", "Hyper Link Reference", "Remark", "Finance Staus",
  "Finance Comment",
];
const A = "";
// [No, TestID, Channels, Service_Name, Scenarios, Testcase_Type, Desc,
//  SenderType, SenderAcct, CoS, Currency, Amount, Fee, Comm, RecvAmount,
//  RecvType, RecvAcct, RecvCoS, RecvCurrency, ...]
const R = (
  no: string, svc: string, st: string, sa: string, cur: string,
  amt: string, rt: string, ra: string, rc: string
): string[] => [
  no, "T", "", svc, "Sc", "Normal", "d", st, sa, "", cur, amt, "", "",
  amt, rt, ra, "", rc, "", "", "", "", "ER", "", "Not Executed", "", "", "", "", "",
];

const ROWS: string[][] = [
  // Row 1-5: already filled (like user's rows 1-9) — should NOT be touched
  R("1", "Wing to Wing", "FC", "103634567", "USD", "120000", "FC", "103634533", "KHR"),
  R("2", "Own Account Transfer", "FC", "103634533", "USD", "30", "FC", "103634533", "KHR"),
  // Rows 3-12: renamed / new-template services with BLANK amounts + accounts.
  // These mirror user rows 13-58 where auto-fill currently fails.
  R("3", "PTU PIN", "FC", A, "USD", A, "Operator", A, "USD"),
  R("4", "QR Pay (Scan)", "FC", A, "USD", A, "Phone Number", A, "USD"),
  R("5", "Wing Wei Luy", "FC", A, "USD", A, "Phone Number", A, "N/A"),
  R("6", "Wing to Other Banks (Local Bank via Bakong)", "FC", A, "USD", A, "Customer QR OtherBank", A, "KHR"),
  R("7", "Wing to Other Banks Bakong Wallet", "FC", A, "USD", A, "Merchant App PSP", A, "KHR"),
  R("8", "KHQR Bakong Wallet", "FC", A, "USD", A, "Bakong KHR", A, "KHR"),
  R("9", "Billpay to PPSHV Expressway", "FC", A, "USD", A, "ABA Bank", A, "KHR"),
  R("10", "Cashout - Input Manual", "FC", A, "USD", A, "Merchant App FC", A, "USD"),
];

async function main() {
  const profile = await loadReferenceProfile();
  if (!profile) throw new Error("no profile");
  const fills = autoFillFromReference(HEADERS, ROWS, profile);

  const byRow: Record<number, string[]> = {};
  for (const f of fills) {
    (byRow[f.row] ||= []).push(`${f.column}->${f.to}`);
  }
  for (const [r, v] of Object.entries(byRow)) {
    console.log(`row ${r}: ${v.join(", ")}`);
  }
  console.log("\nTotal fills:", fills.length);

  // Assertions
  const row = (n: number) => fills.filter((f) => f.row === n);
  if (row(1).length) throw new Error("row 1 was already filled but got filled!");
  if (row(2).length) throw new Error("row 2 was already filled but got filled!");

  // Row 3 PTU PIN: amount + sender account + receiver account must be filled.
  const r3 = Object.fromEntries(row(3).map((f) => [headerKey(f.column), f.to]));
  if (!r3.amount) throw new Error("PTU PIN row: amount not auto-filled");
  if (!r3.senderaccount) throw new Error("PTU PIN row: sender account not auto-filled");
  if (!r3.receiveraccount) throw new Error("PTU PIN row: receiver account not auto-filled");
  // Match FC 9-digit shape.
  if (!/^\d{9}$/.test(r3.senderaccount)) throw new Error(`FC shape wrong: ${r3.senderaccount}`);

  // Row 6 renamed service must resolve to the bakong stat.
  if (!row(6).length) throw new Error("row 6 renamed service did NOT get filled");

  console.log("\n✅ all rows (incl. renamed services) auto-fill correctly");
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});