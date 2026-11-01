/**
 * Spreadsheets run cells starting with these characters as formulas, so a lead
 * named "=HYPERLINK(...)" could attack whoever opens an export. A leading
 * apostrophe makes the spreadsheet treat the cell as text.
 */
export function csvSafe(value: string) {
  if (/^\+\d+$/.test(value)) return value;
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/** Excel needs this mark to read ₹ and other non-English characters correctly. */
export const UTF8_BOM = "﻿";
