import Papa from "papaparse";

import { db } from "@/lib/db";
import { BOARD_LABELS, CLASS_OPTIONS, MAX_IMPORT_ROWS } from "@/lib/leads";
import { leadSchema, type LeadValues } from "@/lib/validations/lead";

// Headers are compared in lowercase with punctuation removed, so "Mobile No." matches "mobileno".
const HEADERS: Record<string, keyof typeof ROW_FIELDS> = {
  name: "name",
  studentname: "name",
  fullname: "name",
  phone: "phone",
  mobile: "phone",
  phonenumber: "phone",
  mobilenumber: "phone",
  mobileno: "phone",
  alternatephone: "alternatePhone",
  email: "email",
  emailaddress: "email",
  parentname: "parentName",
  parentphone: "parentPhone",
  city: "city",
  class: "currentClass",
  currentclass: "currentClass",
  board: "board",
  school: "schoolName",
  schoolname: "schoolName",
  targetexam: "targetExam",
  exam: "targetExam",
  course: "course",
  courseofinterest: "course",
  source: "source",
  leadsource: "source",
  budget: "budget",
  preferredintake: "preferredIntake",
  intake: "preferredIntake",
  notes: "notes",
};

const ROW_FIELDS = {
  name: "",
  phone: "",
  alternatePhone: "",
  email: "",
  parentName: "",
  parentPhone: "",
  city: "",
  currentClass: "",
  board: "",
  schoolName: "",
  targetExam: "",
  course: "",
  source: "",
  budget: "",
  preferredIntake: "",
  notes: "",
};

export type ImportRow = { line: number; values: LeadValues; isDuplicate: boolean };
export type ImportError = { line: number; message: string };
export type ParsedImport = { rows: ImportRow[]; errors: ImportError[]; total: number; fatal?: string };

const normalizeHeader = (header: string) => header.toLowerCase().replace(/[^a-z]/g, "");

export async function parseLeadCsv(text: string): Promise<ParsedImport> {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => HEADERS[normalizeHeader(header)] ?? `ignored:${header}`,
  });
  const empty = { rows: [], errors: [], total: parsed.data.length };

  const columns = parsed.meta.fields ?? [];
  if (!columns.includes("name") || !columns.includes("phone")) {
    return { ...empty, fatal: "The file needs Name and Phone columns." };
  }
  if (parsed.data.length === 0) return { ...empty, fatal: "The file has no rows to import." };
  if (parsed.data.length > MAX_IMPORT_ROWS) {
    return { ...empty, fatal: `The file has more than ${MAX_IMPORT_ROWS.toLocaleString("en-IN")} rows.` };
  }

  const [sources, courses, exams] = await Promise.all([
    db.leadSource.findMany({ select: { id: true, name: true } }),
    db.course.findMany({ select: { id: true, name: true, code: true } }),
    db.targetExam.findMany({ select: { id: true, name: true } }),
  ]);
  const byName = (items: { id: string; name: string; code?: string }[], value: string) => {
    const wanted = value.trim().toLowerCase();
    return items.find((item) => item.name.toLowerCase() === wanted || item.code?.toLowerCase() === wanted);
  };

  const errors: ImportError[] = [];
  const valid: { line: number; values: LeadValues }[] = [];

  parsed.data.forEach((raw, index) => {
    // Line 1 is the header, so the first row of data is line 2 in a spreadsheet.
    const line = index + 2;
    const row = { ...ROW_FIELDS, ...raw };
    const problems: string[] = [];

    const lookUp = (value: string, items: { id: string; name: string; code?: string }[], label: string) => {
      if (!value.trim()) return "";
      const match = byName(items, value);
      if (!match) problems.push(`Unknown ${label} "${value.trim()}"`);
      return match?.id ?? "";
    };
    const sourceId = lookUp(row.source, sources, "source");
    const courseInterestId = lookUp(row.course, courses, "course");
    const targetExamId = lookUp(row.targetExam, exams, "target exam");

    const classValue = row.currentClass.trim().toLowerCase();
    const currentClass = CLASS_OPTIONS.find((option) => option.toLowerCase() === classValue) ?? "";
    if (classValue && !currentClass) problems.push(`Unknown class "${row.currentClass.trim()}"`);

    const boardValue = row.board.trim().toLowerCase();
    const board =
      (Object.keys(BOARD_LABELS) as (keyof typeof BOARD_LABELS)[]).find(
        (key) => key.toLowerCase() === boardValue || BOARD_LABELS[key].toLowerCase() === boardValue,
      ) ?? "";
    if (boardValue && !board) problems.push(`Unknown board "${row.board.trim()}"`);

    const result = leadSchema.safeParse({
      name: row.name.replace(/^'/, ""),
      phone: row.phone,
      alternatePhone: row.alternatePhone,
      email: row.email,
      parentName: row.parentName.replace(/^'/, ""),
      parentPhone: row.parentPhone,
      city: row.city,
      currentClass,
      board,
      schoolName: row.schoolName,
      targetExamId,
      courseInterestId,
      sourceId,
      budget: row.budget,
      preferredIntake: row.preferredIntake,
      notes: row.notes,
      assignedToId: "",
    });
    if (!result.success) problems.push(...result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));

    if (problems.length > 0 || !result.success) errors.push({ line, message: problems.join("; ") });
    else valid.push({ line, values: result.data });
  });

  const phones = valid.flatMap(({ values }) =>
    [values.phone, values.alternatePhone, values.parentPhone].filter((p): p is string => Boolean(p)),
  );
  const emails = valid.map(({ values }) => values.email).filter((e): e is string => Boolean(e));
  const existing = await db.student.findMany({
    where: {
      OR: [
        { phone: { in: phones } },
        { alternatePhone: { in: phones } },
        { parentPhone: { in: phones } },
        { email: { in: emails } },
      ],
    },
    select: { phone: true, alternatePhone: true, parentPhone: true, email: true },
  });
  const seen = new Set(
    existing.flatMap((match) => [match.phone, match.alternatePhone, match.parentPhone, match.email]).filter(Boolean),
  );

  // Rows are added to `seen` as they go, which also catches repeats within the file.
  const rows = valid.map(({ line, values }) => {
    const keys = [values.phone, values.alternatePhone, values.parentPhone, values.email].filter(
      (key): key is string => Boolean(key),
    );
    const isDuplicate = keys.some((key) => seen.has(key));
    keys.forEach((key) => seen.add(key));
    return { line, values, isDuplicate };
  });

  return { rows, errors, total: parsed.data.length };
}
