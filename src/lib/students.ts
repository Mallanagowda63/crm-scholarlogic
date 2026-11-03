import type { Role } from "@/lib/roles";

export const PROFILE_TABS = [
  { id: "overview", label: "Overview" },
  { id: "activity", label: "Activity" },
  { id: "academics", label: "Academics" },
  { id: "documents", label: "Documents" },
  { id: "admission", label: "Admission" },
  { id: "payments", label: "Payments" },
  { id: "notes", label: "Notes" },
] as const;

export type ProfileTab = (typeof PROFILE_TABS)[number]["id"];

/** Accounts only needs fee details. Notes and ID documents are kept from them, as some belong to minors. */
const ACCOUNTS_TABS: readonly ProfileTab[] = ["overview", "admission", "payments"];

export function tabsForRole(role: Role) {
  return role === "ACCOUNTS" ? PROFILE_TABS.filter((tab) => ACCOUNTS_TABS.includes(tab.id)) : PROFILE_TABS;
}

export const DOCUMENT_TYPES = [
  "School report card",
  "Student ID proof",
  "Parent ID proof",
  "Passport-size photo",
  "Scholarship test result",
  "Other",
] as const;

export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

export const ACTIVITY_PAGE_SIZE = 30;
export const STUDENTS_PAGE_SIZE = 25;

/** What a fee plan comes to after discount and GST. */
export function payableAmount(plan: { totalAmount: number; discountAmount: number; gstRateBps: number }) {
  return Math.round(((plan.totalAmount - plan.discountAmount) * (10000 + plan.gstRateBps)) / 10000);
}
