import Papa from "papaparse";

import { db } from "@/lib/db";
import { MAX_IMPORT_ROWS, MODE_LABELS } from "@/lib/leads";
import { leadSchema, type LeadValues } from "@/lib/validations/lead";

// Headers are compared in lowercase with punctuation removed, so "Mobile No." matches "mobileno".
// The LMS Google Form's column names are included, so its response sheet imports as it is.
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
  address: "address",
  dateofbirth: "dateOfBirth",
  dob: "dateOfBirth",
  college: "college",
  collegeuniversity: "college",
  collegeanduniversity: "college",
  degree: "degree",
  stream: "degreeStream",
  degreestream: "degreeStream",
  degreescore: "degreeScore",
  degreepercentage: "degreeScore",
  degreepercentagecgpa: "degreeScore",
  cgpa: "degreeScore",
  passoutyear: "passOutYear",
  yearofpassing: "passOutYear",
  tenth: "tenthScore",
  tenthpercentage: "tenthScore",
  tenthscore: "tenthScore",
  twelfth: "twelfthScore",
  twelfthpercentage: "twelfthScore",
  twelfthscore: "twelfthScore",
  course: "course",
  courseofinterest: "course",
  mode: "mode",
  preferredmode: "mode",
  joiningdate: "joiningDate",
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
  address: "",
  dateOfBirth: "",
  college: "",
  degree: "",
  degreeStream: "",
  degreeScore: "",
  passOutYear: "",
  tenthScore: "",
  twelfthScore: "",
  course: "",
  mode: "",
  joiningDate: "",
  source: "",
  budget: "",
  preferredIntake: "",
  notes: "",
};

export type ImportRow = { line: number; values: LeadValues; isDuplicate: boolean };
export type ImportError = { line: number; message: string };
export type ParsedImport = { rows: ImportRow[]; errors: ImportError[]; total: number; fatal?: string };

// "10th %" and "12th %" lose their digits below, so they are told apart first.
const normalizeHeader = (header: string) =>
  header
    .toLowerCase()
    .replace(/\b10\s*th\b/g, "tenth")
    .replace(/\b12\s*th\b/g, "twelfth")
    .replace(/[^a-z]/g, "");

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

  const [sources, courses] = await Promise.all([
    db.leadSource.findMany({ select: { id: true, name: true } }),
    db.course.findMany({ select: { id: true, name: true, code: true } }),
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

    const modeValue = row.mode.trim().toLowerCase();
    const preferredMode =
      (Object.keys(MODE_LABELS) as (keyof typeof MODE_LABELS)[]).find((key) => key.toLowerCase() === modeValue) ?? "";
    if (modeValue && !preferredMode) problems.push(`Unknown mode "${row.mode.trim()}"`);

    const result = leadSchema.safeParse({
      name: row.name.replace(/^'/, ""),
      phone: row.phone,
      alternatePhone: row.alternatePhone,
      email: row.email,
      parentName: row.parentName.replace(/^'/, ""),
      parentPhone: row.parentPhone,
      city: row.city,
      address: row.address,
      dateOfBirth: row.dateOfBirth.trim(),
      college: row.college,
      degree: row.degree,
      degreeStream: row.degreeStream,
      degreeScore: row.degreeScore,
      passOutYear: row.passOutYear,
      tenthScore: row.tenthScore,
      twelfthScore: row.twelfthScore,
      preferredMode,
      joiningDate: row.joiningDate.trim(),
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
