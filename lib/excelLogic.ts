import * as XLSX from "xlsx";

/**
 * excelLogic.ts — a faithful TypeScript port of the QA logic in
 * `excel_rename.py` (the standalone Tkinter tool). This makes the in-browser
 * "/qa" tool produce identical results:
 *
 *   1. Unmerge every merged range and fill each opened cell with the original
 *      top-left value (mirrors `_unmerge_workbook`; unmerge happens on ALL
 *      sheets).
 *   2. Rename the `Service_Name` column on the selected sheet using
 *      SERVICE_KEYS (mirrors `_normalize_service_name`, applied to each row
 *      below the header row).
 *   3. Expose preview rows (Original before unmerge | Fixed after unmerge +
 *      rename) so a UI can compare them side-by-side.
 */

// ---------------------------------------------------------------
// SERVICE_KEYS must match the python SERVICES map keys in excel_rename.py
// ---------------------------------------------------------------
export const SERVICE_KEYS: string[] = [
  "Wing to Wing",
  "Wing Wei Luy",
  "Code to Wing",
  "Own Account Transfer",
  "Wing To World",

  "Transfer to Local Bank via Bakong",
  "Wing To Other Banks NCS",
  "Fund Transfer - Bakong Wallet",
  "Transfer Direct To Other Bank (ABA)",

  "Billpay to Other Bank (ABA)",
  "Billpay to Angkor Hospital",
  "Billpay to PPSHV",
  "Billpay to Bakong Wallet",
  "Billpay to EDC",

  "PTU PIN",
  "PTU Pinless",

  "QR Pay",
  "Cash Out(Scan)",
  "Cashout - Input Manual",

  "KHQR(WingBank to customer other bank)",
  "KHQR(WingBank to merchant other bank)",
  "QR Payment KHQR Bakong Wallet",
];

/** Normalize text for matching only; keeps real output from SERVICE_KEYS. */
export function normalizeTextKey(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  text = text.replace(/\u00a0/g, " "); // remove non-breaking space
  text = text.replace(/\s+/g, " "); // collapse multiple spaces
  text = text.trim();
  return text.toLowerCase();
}

const SERVICE_LOOKUP: Record<string, string> = {};
for (const key of SERVICE_KEYS) {
  SERVICE_LOOKUP[normalizeTextKey(key)] = key;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Port of `_normalize_service_name`. Returns the canonical SERVICE_KEYS value,
 * or the cleaned original text when nothing matches.
 */
export function normalizeServiceName(value: unknown): string | null {
  if (value === null || value === undefined) return null;

  const original = String(value);
  let text = original.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();

  if (!text) return text;

  // 1. Exact / case-insensitive / space-normalized match.
  let key = normalizeTextKey(text);
  if (key in SERVICE_LOOKUP) return SERVICE_LOOKUP[key];

  // 2. Remove trailing number. Wing to Wing2 / Wing to Wing 2 -> Wing to Wing
  let noNumber = text.replace(/\s*\d+\s*$/, "").trim();
  key = normalizeTextKey(noNumber);
  if (key in SERVICE_LOOKUP) return SERVICE_LOOKUP[key];

  // 3. Remove trailing number in brackets. Wing to Wing(2) -> Wing to Wing
  let noBracket = text.replace(/\s*\(\s*\d+\s*\)\s*$/, "").trim();
  key = normalizeTextKey(noBracket);
  if (key in SERVICE_LOOKUP) return SERVICE_LOOKUP[key];

  // 4. Prefix match with service keys (longest first) for trailing digits —
  //    catches cases like "QR Pay2" -> "QR Pay".
  const sorted = [...SERVICE_KEYS].sort((a, b) => b.length - a.length);
  for (const serviceKey of sorted) {
    const pattern = new RegExp(
      "^" + escapeRegex(serviceKey) + "\\s*\\d+\\s*$",
      "i"
    );
    if (pattern.test(text)) return serviceKey;
  }

  // 5. Unknown value: keep the original cleaned text.
  return text;
}
interface IndexRange {
  s: { r: number; c: number };
  e: { r: number; c: number };
}

/**
 * Unmerge every merged range in a worksheet and fill each opened cell with the
 * original top-left value. Returns the number of merged ranges removed.
 * Mirrors `_unmerge_workbook` for a single sheet.
 */
export function unmergeWorksheet(ws: XLSX.WorkSheet): number {
  const merges = (ws["!merges"] || []) as IndexRange[];
  if (!merges.length) return 0;

  let removed = 0;
  for (const range of merges) {
    const minC = range.s.c;
    const minR = range.s.r;
    const maxC = range.e.c;
    const maxR = range.e.r;

    const topLeft = ws[XLSX.utils.encode_cell({ r: minR, c: minC })];
    const value = topLeft ? topLeft.v : undefined;

    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const t = topLeft?.t ?? (typeof value === "number" ? "n" : "s");
        ws[addr] = {
          t,
          v: value as unknown,
          ...(topLeft?.s ? { s: topLeft.s } : {}),
        };
      }
    }
    removed++;
  }

  ws["!merges"] = [];
  return removed;
}

/** Find the `Service_Name` column index (0-based) from the header row. */
export function findServiceNameColumn(
  ws: XLSX.WorkSheet,
  headerRow: number
): number | null {
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1:A1");
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = ws[XLSX.utils.encode_cell({ r: headerRow - 1, c })];
    if (!cell) continue;
    const header = String(
      cell.v === null || cell.v === undefined ? "" : cell.v
    ).trim();
    if (header === "Service_Name") return c;
    if (normalizeTextKey(header) === normalizeTextKey("Service_Name")) return c;
  }
  return null;
}

/**
 * Rename every Service_Name value below the header row on the selected sheet.
 * Mirrors `_fix_service_name_column`. Returns the number of renamed cells
 * (or -1 when no Service_Name column is found).
 */
export function renameServiceNameColumn(
  ws: XLSX.WorkSheet,
  headerRow: number
): { count: number; serviceCol: number | null } {
  const serviceCol = findServiceNameColumn(ws, headerRow);
  if (serviceCol === null) return { count: -1, serviceCol: null };

  let count = 0;
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1:A1");

  for (let r = headerRow; r <= range.e.r; r++) {
    const addr = XLSX.utils.encode_cell({ r, c: serviceCol });
    const cell = ws[addr];
    const oldVal = cell ? cell.v : null;
    const newVal = normalizeServiceName(oldVal);

    const oldText =
      oldVal === null || oldVal === undefined ? "" : String(oldVal).trim();
    const newText = newVal === null ? "" : String(newVal).trim();

    if (oldText !== newText) {
      if (!cell) {
        ws[addr] = {
          t: typeof newVal === "number" ? "n" : "s",
          v: newVal as unknown,
        };
      } else {
        cell.v = newVal;
        if (typeof newVal === "number") cell.t = "n";
        else if (!cell.t) cell.t = "s";
      }
      count++;
    }
  }

  return { count, serviceCol };
}

/** Mirror `_make_unique_headers` so previews get clean unique column names. */
export function makeUniqueHeaders(headers: string[]): string[] {
  const out: string[] = [];
  const seen: Record<string, number> = {};
  for (let i = 0; i < headers.length; i++) {
    const name = (headers[i] || "").trim() || `Column_${i + 1}`;
    if (!(name in seen)) {
      seen[name] = 1;
      out.push(name);
    } else {
      seen[name] += 1;
      out.push(`${name}_${seen[name]}`);
    }
  }
  return out;
}

export type PreviewRows = string[][];

/** Build a bounded, header-first preview as a matrix of strings. */
export function buildPreviewMatrix(
  aoa: unknown[][],
  headerRow: number,
  maxRows = 60,
  maxCols = 40
): { headers: string[]; rows: PreviewRows } {
  if (!aoa.length) return { headers: [], rows: [] };
  if (headerRow - 1 >= aoa.length) return { headers: [], rows: [] };

  const headerArr = aoa[headerRow - 1] || [];
  const headers = makeUniqueHeaders(
    headerArr.map((h) => (h === null || h === undefined ? "" : String(h)))
  ).slice(0, maxCols);

  const rows = aoa
    .slice(headerRow)
    .slice(0, maxRows)
    .map((r) =>
      (r || [])
        .slice(0, maxCols)
        .map((v) => (v === null || v === undefined ? "" : String(v)))
    );

  return { headers, rows };
}

export interface PreviewSet {
  headers: string[];
  rows: PreviewRows;
}

export interface QaResult {
  ok: boolean;
  error?: string;
  sheetNames: string[];
  sheetName: string;
  headerRow: number;
  totalRows: number;
  previewRows: number;
  unmergedRanges: number;
  serviceCol: number | null;
  renameCount: number;
  original: PreviewSet;
  fixed: PreviewSet;
  wb: XLSX.WorkBook | null;
}
/**
 * Run the full QA pipeline on a workbook buffer. Mirrors the `process_record`
 * core of excel_rename.py: unmerge all sheets, then rename SERVICE_NAME on the
 * selected sheet, and return bounded previews for both the original and fixed
 * views plus a reference to the processed workbook (used to export).
 */
export function processWorkbook(
  buffer: ArrayBuffer,
  sheetName: string,
  headerRow: number,
  maxPreviewRows = 60
): QaResult {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheetNames = wb.SheetNames;

  const fail = (message: string): QaResult => ({
    ok: false,
    error: message,
    sheetNames,
    sheetName,
    headerRow,
    totalRows: 0,
    previewRows: 0,
    unmergedRanges: 0,
    serviceCol: null,
    renameCount: 0,
    original: { headers: [], rows: [] },
    fixed: { headers: [], rows: [] },
    wb,
  });

  if (!sheetNames.length) return fail("The workbook has no sheets.");

  // Resolve the requested sheet; fall back to the first sheet.
  const selected = sheetNames.includes(sheetName) ? sheetName : sheetNames[0];

  const origWs = wb.Sheets[selected];
  const origAoa = XLSX.utils.sheet_to_json(origWs, {
    header: 1,
    raw: true,
    defval: "",
  }) as unknown[][];

  // 1. Unmerge every merged range (all sheets), fill top-left values.
  let unmergedRanges = 0;
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (ws) unmergedRanges += unmergeWorksheet(ws);
  }

  // 2. Rename SERVICE_NAME on the selected sheet (after unmerge).
  const fixedWs = wb.Sheets[selected];
  const { count, serviceCol } = renameServiceNameColumn(fixedWs, headerRow);
  const renameCount = count >= 0 ? count : 0;

  const fixedAoa = XLSX.utils.sheet_to_json(fixedWs, {
    header: 1,
    raw: true,
    defval: "",
  }) as unknown[][];

  const original = buildPreviewMatrix(origAoa, headerRow, maxPreviewRows);
  const fixed = buildPreviewMatrix(fixedAoa, headerRow, maxPreviewRows);

  const fixedRowsLen =
    headerRow - 1 < fixedAoa.length ? fixedAoa.length - headerRow : 0;

  return {
    ok: true,
    sheetNames,
    sheetName: selected,
    headerRow,
    totalRows: fixedRowsLen,
    previewRows: fixed.rows.length,
    unmergedRanges,
    serviceCol,
    renameCount,
    original,
    fixed,
    wb,
  };
}

/** Serialize the (already processed) workbook to a base64 .xlsx string. */
export function workbookToBase64(wb: XLSX.WorkBook): string {
  return XLSX.write(wb, { type: "base64", bookType: "xlsx" });
}