import ExcelJS from "exceljs";

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
 *
 * Processing & export use ExcelJS so that the original workbook's formatting
 * (fill colours, fonts, borders, row heights, column widths) is preserved —
 * the free SheetJS build cannot serialise cell styles back to .xlsx.
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
/** A simple 1-based rectangular range helper for ExcelJS addresses. */
interface CellRange {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

function colToLetters(n: number): string {
  let s = "";
  n = n - 1;
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

export function encodeRange(m: CellRange): string {
  return (
    colToLetters(m.left) + m.top + ":" + colToLetters(m.right) + m.bottom
  );
}

export function parseRange(addr: unknown): CellRange {
  const [a = "", b] = String(addr).split(":");
  const tl = decodeAddr(a);
  const br = decodeAddr(b || a);
  return { top: tl.r, left: tl.c, bottom: br.r, right: br.c };
}

function decodeAddr(a: string): { r: number; c: number } {
  const m = /([A-Z]+)(\d+)/.exec(a);
  let c = 0;
  for (const ch of m?.[1] || "A") c = c * 26 + (ch.charCodeAt(0) - 64);
  return { c, r: Number(m?.[2] || 1) };
}

/**
 * Flatten an ExcelJS cell value to plain text for display/matching only.
 * ExcelJS models rich-text runs, hyperlinks, formula results and dates as
 * objects — without this, previews would render "[object Object]", header
 * detection could miss `Service_Name`, and rename matching would fail.
 * The underlying workbook keeps its real values and formatting untouched.
 */
export function cellValueToPlainText(value: unknown): unknown {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, "0");
    return (
      `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ` +
      `${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`
    );
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (Array.isArray(obj.richText)) {
      return (obj.richText as Array<{ text?: string }>)
        .map((run) => (run && typeof run.text === "string" ? run.text : ""))
        .join("");
    }
    if (typeof obj.text === "string" && typeof obj.hyperlink === "string") {
      return obj.text; // hyperlink cell -> its label text
    }
    if (obj.result !== undefined) {
      return cellValueToPlainText(obj.result); // formula -> its cached result
    }
    if (obj.error !== undefined) {
      const err = obj.error as { message?: unknown };
      return err && err.message !== undefined ? String(err.message) : "#ERROR";
    }
  }
  return value;
}

/** Read a whole worksheet into a nested array ('' for empty cells). */
export function sheetToAoa(ws: ExcelJS.Worksheet): unknown[][] {
  const rows: unknown[][] = [];
  ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const arr: unknown[] = [];
    for (let c = 1; c <= row.cellCount; c++) {
      arr.push(cellValueToPlainText(row.getCell(c).value));
    }
    rows[rowNumber - 1] = arr;
  });
  return rows;
}

/**
 * Unmerge every merged range in an ExcelJS worksheet and fill each opened cell
 * with the original top-left value AND style (so colours/borders survive).
 * Returns the number of merged ranges removed. Mirrors `_unmerge_workbook`.
 */
export function unmergeWorksheet(ws: ExcelJS.Worksheet): number {
  const merges = (ws.model.merges || []).slice();
  if (!merges.length) return 0;

  const ranges = merges.map(parseRange);
  ws.model.merges = [];

  for (const m of ranges) {
    const master = ws.getCell(m.top, m.left);
    const value = master.value;
    const style: Record<string, unknown> = {};
    for (const p of [
      "fill",
      "font",
      "alignment",
      "border",
      "numFmt",
      "protection",
      "dataValidation",
    ] as const) {
      if ((master as unknown as Record<string, unknown>)[p] !== undefined) {
        style[p] = (master as unknown as Record<string, unknown>)[p];
      }
    }

    ws.unMergeCells(encodeRange(m));

    for (let r = m.top; r <= m.bottom; r++) {
      for (let c = m.left; c <= m.right; c++) {
        const cell = ws.getCell(r, c);
        Object.assign(cell, style);
        cell.value = value;
      }
    }
  }

  return ranges.length;
}

/** Find the `Service_Name` column index (1-based) from the header row. */
export function findServiceNameColumn(
  ws: ExcelJS.Worksheet,
  headerRow: number
): number | null {
  const row = ws.getRow(headerRow);
  const cols = row.cellCount || (ws.columnCount || 0);
  for (let c = 1; c <= cols; c++) {
    const cell = row.getCell(c);
    const header = String(cellValueToPlainText(cell.value)).trim();
    if (header === "Service_Name") return c;
    if (normalizeTextKey(header) === normalizeTextKey("Service_Name")) return c;
  }
  return null;
}

/**
 * Rename every Service_Name value below the header row on the selected sheet.
 * Mirrors `_fix_service_name_column`. Returns the number of renamed cells
 * (or -1 when no Service_Name column is found). Setting `cell.value` keeps the
 * cell's existing style.
 */
export function renameServiceNameColumn(
  ws: ExcelJS.Worksheet,
  headerRow: number
): { count: number; serviceCol: number | null } {
  const serviceCol = findServiceNameColumn(ws, headerRow);
  if (serviceCol === null) return { count: -1, serviceCol: null };

  let count = 0;
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const cell = ws.getCell(r, serviceCol);
    const raw = cellValueToPlainText(cell.value);
    const newVal = normalizeServiceName(raw);

    const oldText = raw === "" ? "" : String(raw).trim();
    const newText = newVal === null || newVal === undefined ? "" : String(newVal).trim();

    if (oldText !== newText) {
      cell.value = newVal;
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

/**
 * Auto-detect the header row (1-based) by scanning the sheet for the row that
 * actually contains the `Service_Name` header. Real files often have a dummy
 * first row (e.g. reporting labels) with the real header below it, so relying
 * only on the user-provided row causes the rename to be silently skipped.
 * Falls back to the preferred row when no `Service_Name` cell is found.
 */
export function detectServiceHeaderRow(
  aoa: unknown[][],
  preferredHeaderRow: number
): number {
  const target = normalizeTextKey("Service_Name");
  for (let r = 0; r < aoa.length; r++) {
    const row = aoa[r] || [];
    for (let c = 0; c < row.length; c++) {
      const v = row[c];
      if (v === null || v === undefined) continue;
      if (normalizeTextKey(v) === target) return r + 1; // convert to 1-based
    }
  }
  return Math.max(1, preferredHeaderRow);
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
  wb: ExcelJS.Workbook | null;
}
/**
 * Run the full QA pipeline on a workbook buffer. Mirrors the `process_record`
 * core of excel_rename.py: unmerge all sheets, then rename SERVICE_NAME on the
 * selected sheet, and return bounded previews for both the original and fixed
 * views plus a reference to the processed workbook (used to export).
 *
 * Uses ExcelJS so the original formatting (fill colours, fonts, borders, row
 * heights, column widths) is preserved in the exported file.
 */
export async function processWorkbook(
  buffer: ArrayBuffer,
  sheetName: string,
  headerRow: number,
  maxPreviewRows = 60
): Promise<QaResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheetNames = wb.worksheets.map((ws) => ws.name);

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
  const origWs = wb.getWorksheet(selected);
  const origAoa = sheetToAoa(origWs);

  // Auto-detect the real header row (the row that has Service_Name), falling
  // back to the user-provided (or default) row when it isn't found.
  const effectiveHeaderRow = detectServiceHeaderRow(
    origAoa,
    Math.max(1, headerRow)
  );

  // 1. Unmerge every merged range (all sheets), fill top-left values+styles.
  let unmergedRanges = 0;
  for (const ws of wb.worksheets) {
    unmergedRanges += unmergeWorksheet(ws);
  }

  // 2. Rename SERVICE_NAME on the selected sheet (after unmerge).
  const fixedWs = wb.getWorksheet(selected);
  const { count, serviceCol } = renameServiceNameColumn(
    fixedWs,
    effectiveHeaderRow
  );
  const renameCount = count >= 0 ? count : 0;

  const fixedAoa = sheetToAoa(fixedWs);

  const original = buildPreviewMatrix(
    origAoa,
    effectiveHeaderRow,
    maxPreviewRows
  );
  const fixed = buildPreviewMatrix(fixedAoa, effectiveHeaderRow, maxPreviewRows);

  const fixedRowsLen =
    effectiveHeaderRow - 1 < fixedAoa.length
      ? fixedAoa.length - effectiveHeaderRow
      : 0;

  return {
    ok: true,
    sheetNames,
    sheetName: selected,
    headerRow: effectiveHeaderRow,
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
export async function workbookToBase64(wb: ExcelJS.Workbook): Promise<string> {
  const buf = await wb.xlsx.writeBuffer();
  const bytes = new Uint8Array(buf as ArrayBuffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}