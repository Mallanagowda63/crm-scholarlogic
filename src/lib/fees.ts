import { addDaysToKey, dateKeyStart, indiaDateKey } from "@/lib/format";

/** The Services Accounting Code for commercial training and coaching. Confirm with an accountant. */
export const COACHING_SAC_CODE = "999293";

export const PAYMENT_METHOD_LABELS = { UPI: "UPI", CASH: "Cash", CARD: "Card", BANK_TRANSFER: "Bank transfer" } as const;

/** What a fee plan comes to after discount and GST. */
export function payableAmount(plan: { totalAmount: number; discountAmount: number; gstRateBps: number }) {
  return Math.round(((plan.totalAmount - plan.discountAmount) * (10000 + plan.gstRateBps)) / 10000);
}

/** Splits a GST-inclusive amount into its taxable value and equal CGST and SGST. */
export function splitGst(total: number, gstRateBps: number) {
  const taxableAmount = Math.round((total * 10000) / (10000 + gstRateBps));
  const tax = total - taxableAmount;
  const cgstAmount = Math.floor(tax / 2);
  return { taxableAmount, cgstAmount, sgstAmount: tax - cgstAmount, igstAmount: 0 };
}

/** Indian financial years run from April to March, such as 2026-27, using India's date. */
export function financialYearOf(date: Date) {
  const [year, month] = indiaDateKey(date).split("-").map(Number);
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String(start + 1).slice(2)}`;
}

/** A due date lasts all day in India, so an instalment becomes overdue the morning after. */
export function endOfIndiaDay(key: string) {
  return new Date(dateKeyStart(addDaysToKey(key, 1)).getTime() - 1);
}

/** Splits an amount evenly, with any leftover paise on the last instalment. */
export function splitIntoInstalments(payable: number, count: number) {
  const base = Math.floor(payable / count);
  return Array.from({ length: count }, (_, index) => (index === count - 1 ? payable - base * (count - 1) : base));
}

export type InstalmentStatus = "PAID" | "PART_PAID" | "OVERDUE" | "UPCOMING";

/**
 * Payments count toward the earliest instalments first, so someone who pays
 * late or in parts always sees an accurate position.
 */
export function summarisePlan<T extends { amount: number; dueDate: Date }>(
  plan: {
    totalAmount: number;
    discountAmount: number;
    gstRateBps: number;
    instalments: T[];
    payments: { amount: number }[];
  },
  now: Date,
) {
  const payable = payableAmount(plan);
  const paid = plan.payments.reduce((sum, payment) => sum + payment.amount, 0);

  let remaining = paid;
  let overdueAmount = 0;
  const instalments = plan.instalments.map((instalment) => {
    const paidToward = Math.min(remaining, instalment.amount);
    remaining -= paidToward;
    const outstanding = instalment.amount - paidToward;
    const isOverdue = outstanding > 0 && instalment.dueDate < now;
    if (isOverdue) overdueAmount += outstanding;
    const status: InstalmentStatus =
      outstanding === 0 ? "PAID" : isOverdue ? "OVERDUE" : paidToward > 0 ? "PART_PAID" : "UPCOMING";
    return { ...instalment, paidToward, outstanding, status };
  });

  return { payable, paid, balance: payable - paid, overdueAmount, instalments };
}

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen",
  "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function belowThousand(value: number): string {
  const parts: string[] = [];
  if (value >= 100) parts.push(`${ONES[Math.floor(value / 100)]} Hundred`);
  const rest = value % 100;
  if (rest >= 20) parts.push(`${TENS[Math.floor(rest / 10)]}${rest % 10 ? ` ${ONES[rest % 10]}` : ""}`);
  else if (rest > 0) parts.push(ONES[rest]);
  return parts.join(" ");
}

function wholeInWords(value: number): string {
  if (value === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(value / 10_000_000);
  const lakh = Math.floor((value % 10_000_000) / 100_000);
  const thousand = Math.floor((value % 100_000) / 1000);
  const rest = value % 1000;
  if (crore) parts.push(`${wholeInWords(crore)} Crore`);
  if (lakh) parts.push(`${belowThousand(lakh)} Lakh`);
  if (thousand) parts.push(`${belowThousand(thousand)} Thousand`);
  if (rest) parts.push(belowThousand(rest));
  return parts.join(" ");
}

/** Such as "Rupees One Lakh Twenty Thousand and Fifty Paise Only". */
export function amountInWords(paise: number) {
  const rupees = Math.floor(paise / 100);
  const remainder = paise % 100;
  return `Rupees ${wholeInWords(rupees)}${remainder ? ` and ${wholeInWords(remainder)} Paise` : ""} Only`;
}
