import { readFile } from "node:fs/promises";
import path from "node:path";

import fontkit from "@pdf-lib/fontkit";
import { degrees, PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import { amountInWords, COACHING_SAC_CODE, PAYMENT_METHOD_LABELS } from "@/lib/fees";
import { formatShortDate } from "@/lib/format";

type ReceiptData = {
  number: string;
  issuedAt: Date;
  orgName: string;
  orgAddress: string | null;
  orgGstin: string | null;
  studentName: string;
  courseName: string;
  gstRateBps: number;
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalAmount: number;
  payment: { method: keyof typeof PAYMENT_METHOD_LABELS; reference: string | null; paidAt: Date; deletedAt: Date | null };
};

// Includes the ₹ sign, which the fonts built into PDF readers don't have.
const FONT_DIR = path.join(process.cwd(), "assets", "fonts");

const INK = rgb(0.06, 0.09, 0.16);
const MUTED = rgb(0.35, 0.4, 0.48);
const LINE = rgb(0.88, 0.9, 0.93);
const BRAND = rgb(0.31, 0.27, 0.9);

const money = (paise: number) =>
  `₹${new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(paise / 100)}`;

/** Words that don't fit are moved to the next line, as PDFs don't wrap text themselves. */
function wrap(text: string, font: PDFFont, size: number, width: number) {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > width && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export async function buildReceiptPdf(receipt: ReceiptData) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(`Receipt ${receipt.number}`);
  pdf.setAuthor(receipt.orgName);
  pdf.setSubject(receipt.payment.deletedAt ? "Cancelled receipt" : "Fee receipt");

  const [regularBytes, boldBytes] = await Promise.all([
    readFile(path.join(FONT_DIR, "DejaVuSans.ttf")),
    readFile(path.join(FONT_DIR, "DejaVuSans-Bold.ttf")),
  ]);
  const regular = await pdf.embedFont(regularBytes, { subset: true });
  const bold = await pdf.embedFont(boldBytes, { subset: true });

  const page: PDFPage = pdf.addPage([595.28, 841.89]);
  const left = 48;
  const right = 547;
  let y = 790;

  const text = (value: string, x: number, atY: number, size = 10, font = regular, color = INK) =>
    page.drawText(value, { x, y: atY, size, font, color });
  const rightText = (value: string, atY: number, size = 10, font = regular, color = INK) =>
    text(value, right - font.widthOfTextAtSize(value, size), atY, size, font, color);
  const rule = (atY: number) => page.drawLine({ start: { x: left, y: atY }, end: { x: right, y: atY }, thickness: 1, color: LINE });

  text(receipt.orgName, left, y, 20, bold, BRAND);
  rightText("FEE RECEIPT", y, 12, bold);
  y -= 18;
  for (const line of wrap(receipt.orgAddress ?? "", regular, 9, 300)) {
    text(line, left, y, 9, regular, MUTED);
    y -= 12;
  }
  if (receipt.orgGstin) {
    text(`GSTIN: ${receipt.orgGstin}`, left, y, 9, regular, MUTED);
    y -= 12;
  }

  y -= 14;
  rule(y);
  y -= 24;

  text("Receipt number", left, y, 9, regular, MUTED);
  text("Receipt date", 300, y, 9, regular, MUTED);
  y -= 14;
  text(receipt.number, left, y, 11, bold);
  text(formatShortDate(receipt.issuedAt), 300, y, 11, bold);
  y -= 26;

  text("Received from", left, y, 9, regular, MUTED);
  text("Course", 300, y, 9, regular, MUTED);
  y -= 14;
  const studentLines = wrap(receipt.studentName, bold, 11, 230);
  const courseLines = wrap(receipt.courseName, bold, 11, 247);
  for (let index = 0; index < Math.max(studentLines.length, courseLines.length); index += 1) {
    if (studentLines[index]) text(studentLines[index], left, y, 11, bold);
    if (courseLines[index]) text(courseLines[index], 300, y, 11, bold);
    y -= 14;
  }
  y -= 12;

  text("Payment method", left, y, 9, regular, MUTED);
  text("Paid on", 300, y, 9, regular, MUTED);
  y -= 14;
  const method = PAYMENT_METHOD_LABELS[receipt.payment.method];
  text(receipt.payment.reference ? `${method} (${receipt.payment.reference})` : method, left, y, 11);
  text(formatShortDate(receipt.payment.paidAt), 300, y, 11);
  y -= 30;

  page.drawRectangle({ x: left, y: y - 6, width: right - left, height: 22, color: rgb(0.95, 0.96, 0.98) });
  text("Description", left + 8, y, 9, bold);
  rightText("Amount", y, 9, bold);
  y -= 26;

  const row = (label: string, amount: number) => {
    text(label, left + 8, y, 10);
    rightText(money(amount), y, 10);
    y -= 20;
  };
  const halfRate = receipt.gstRateBps / 200;
  row(`Coaching fees (SAC ${COACHING_SAC_CODE})`, receipt.taxableAmount);
  row(`CGST at ${halfRate}%`, receipt.cgstAmount);
  row(`SGST at ${halfRate}%`, receipt.sgstAmount);
  if (receipt.igstAmount > 0) row("IGST", receipt.igstAmount);

  rule(y + 8);
  y -= 8;
  text("Total received", left + 8, y, 12, bold);
  rightText(money(receipt.totalAmount), y, 12, bold, BRAND);
  y -= 24;

  for (const line of wrap(amountInWords(receipt.totalAmount), regular, 9, right - left - 16)) {
    text(line, left + 8, y, 9, regular, MUTED);
    y -= 12;
  }

  y -= 40;
  rightText(`For ${receipt.orgName}`, y, 10);
  y -= 44;
  rightText("Authorised signatory", y, 9, regular, MUTED);

  text("This receipt was generated by ScholarLogic.", left, 48, 8, regular, MUTED);

  if (receipt.payment.deletedAt) {
    page.drawText("CANCELLED", {
      x: 130,
      y: 380,
      size: 64,
      font: bold,
      color: rgb(0.86, 0.15, 0.15),
      opacity: 0.25,
      rotate: degrees(30),
    });
  }

  return pdf.save();
}
