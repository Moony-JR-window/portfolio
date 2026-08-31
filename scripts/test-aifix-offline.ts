// TEMP: verify aiFixRows returns deterministic fills even when AI unreachable.
// Run: npx tsx scripts/test-aifix-offline.ts
import { loadReferenceProfile, aiFixRows } from "../lib/qaAgent";

const HEADERS = [
  "No", "TestID", "Channels", "Service_Name", "Scenarios", "Testcase_Type",
  "Test_Case_Description", "Sender_Account_Type", "Sender_Account",
  "Sender CoS/Account-Classs", "Account_Currency", "Amount", "Fee", "Commission",
  "Receiver Amount", "Reciever_Account_Type", "Receiver_Account",
  "Receiver_Class_Of_Service", "Reciever_Currency",
];
const A = "";
const R = (
  no: string, svc: string, st: string, sa: string, cur: string,
  amt: string, rt: string, ra: string, rc: string
): string[] => [
  no, "T", "", svc, "Sc", "Normal", "d", st, sa, "", cur, amt, "", "", amt, rt, ra, "", rc,
];
const ROWS: string[][] = [
  R("1", "PTU PIN", "FC", A, "USD", A, "Operator", A, "USD"),
  R("2", "QR Pay (Scan)", "FC", A, "USD", A, "Phone Number", A, "USD"),
  R("3", "Wing to Other Banks (Local Bank via Bakong)", "FC", A, "USD", A, "Customer QR OtherBank", A, "KHR"),
  R("4", "Wing to Wing", "FC", "103634567", "USD", "120000", "FC", "103634533", "KHR"),
];

async function main() {
  const profile = await loadReferenceProfile();
  if (!profile) throw new Error("no profile");
  const agent = await aiFixRows(HEADERS, ROWS, profile);
  console.log("available:", agent.available, "| checkedRows:", agent.checkedRows);
  console.log("summary:", agent.summary);
  console.log("fixes:", agent.fixes.length);
  for (const f of agent.fixes) console.log(`  r${f.row} ${f.column} -> ${f.to}`);
  const fillRows = new Set(agent.fixes.filter((f) => f.fill).map((f) => f.row));
  if (!fillRows.has(1)) throw new Error("row 1 (PTU PIN) not auto-filled");
  if (!fillRows.has(2)) throw new Error("row 2 (QR Pay (Scan)) not auto-filled");
  if (!fillRows.has(3)) throw new Error("row 3 (renamed bakong service) not auto-filled");
  if (fillRows.has(4)) throw new Error("row 4 already filled but was auto-filled");
  console.log("\n✅ aiFixRows offline path returns deterministic fills for all empty rows");
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});