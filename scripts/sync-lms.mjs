// Copies data from the ScholarLogic LMS (MongoDB) into the CRM, then repeats every few minutes.
//   - LMS courses           -> CRM courses (fee starts at 0; set it in the CRM, the sync never changes it)
//   - LMS batches           -> CRM batches (one per course that teaches the batch's subject)
//   - LMS students          -> CRM students in the "Enrolled" stage ("Lost" when dropped), with their batches
//   - LMS registration form -> CRM leads in the "New" stage; the same record becomes the student once verified
//   - LMS staff listed in LMS_STAFF_EMAILS -> CRM logins that use their LMS password
// Each copied row keeps the LMS id in "lmsId", so a run updates rows instead of duplicating them.
// The sync only fills fields the LMS has a value for, and only moves a stage to Enrolled or Lost,
// so counsellors' own work in the CRM (stages of leads, follow-ups, fees, notes) is kept.
//
// Settings (.env): LMS_MONGODB_URI (required), LMS_STAFF_EMAILS (comma-separated),
// LMS_STAFF_ROLE (default ADMIN), LMS_SYNC_MINUTES (default 5).
// Run: node scripts/sync-lms.mjs          (keeps running)
//      node scripts/sync-lms.mjs --once   (one pass, then exits)

import { PrismaClient } from "@prisma/client";
import { MongoClient } from "mongodb";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env file; real environment variables are used.
}

const MONGO_URI = process.env.LMS_MONGODB_URI;
if (!MONGO_URI) {
  console.error("LMS_MONGODB_URI isn't set, so there is nothing to sync from.");
  process.exit(1);
}
const EVERY_MINUTES = Math.max(1, Number(process.env.LMS_SYNC_MINUTES) || 5);
const STAFF_EMAILS = (process.env.LMS_STAFF_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);
const STAFF_ROLE = ["ADMIN", "COUNSELLOR", "ACCOUNTS", "VIEWER"].includes(process.env.LMS_STAFF_ROLE)
  ? process.env.LMS_STAFF_ROLE
  : "ADMIN";
const ONCE = process.argv.includes("--once");

const db = new PrismaClient();
const mongo = new MongoClient(MONGO_URI);

// ---------- helpers

/** Same rules as src/lib/phone.ts: E.164, Indian numbers without a country code. */
function normalizePhone(raw) {
  const cleaned = String(raw || "").trim().replace(/^'/, "").replace(/[\s().-]/g, "");
  if (!cleaned) return null;
  if (cleaned.startsWith("+")) {
    if (cleaned.startsWith("+91")) return /^\+91[6-9]\d{9}$/.test(cleaned) ? cleaned : null;
    return /^\+[1-9]\d{7,14}$/.test(cleaned) ? cleaned : null;
  }
  const national = cleaned.replace(/^(0091|91(?=\d{10}$)|0(?=\d{10}$))/, "");
  return /^[6-9]\d{9}$/.test(national) ? `+91${national}` : null;
}

/** Dates of birth arrive as "2002-05-14", "14/05/2002" or "14-05-2002". */
function parseDay(raw) {
  const s = String(raw || "").trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return day(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return day(+m[3], +m[2], +m[1]);
  return null;
}
function day(y, mo, d) {
  if (y < 1950 || y > 2030 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return new Date(Date.UTC(y, mo - 1, d));
}

const text = (v) => {
  const s = String(v ?? "").trim();
  return s ? s : undefined;
};
const year = (v) => {
  const n = parseInt(String(v ?? ""), 10);
  return n >= 1980 && n <= 2035 ? n : undefined;
};
const date = (v) => (v ? new Date(v) : undefined);
/** For day-only columns: the calendar day in India time, at UTC midnight (how Prisma stores @db.Date). */
const istDay = (v) => {
  if (!v) return undefined;
  const t = new Date(new Date(v).getTime() + 330 * 60 * 1000);
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
};
const mode = (v) => (["ONLINE", "OFFLINE", "HYBRID"].includes(v) ? v : undefined);
const id = (v) => (v ? String(v) : "");

/** Only the defined values, so an empty LMS field never wipes what the CRM has. */
function defined(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== ""));
}

/** The fields in `data` that differ from `row`. */
function changes(row, data) {
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    const cur = row?.[k];
    const same = v instanceof Date ? cur instanceof Date && cur.getTime() === v.getTime() : cur === v;
    if (!same) out[k] = v;
  }
  return out;
}
const has = (o) => Object.keys(o).length > 0;

// ---------- one pass

async function syncOnce() {
  const lms = mongo.db();
  const all = (name, filter = {}, projection) => lms.collection(name).find(filter, projection ? { projection } : {}).toArray();
  const [courses, subjects, batches, students, allocations, registrations] = await Promise.all([
    all("trackcourses"),
    all("subjects", {}, { name: 1, code: 1 }),
    all("batches", {}, { batchCode: 1, subjectId: 1, mode: 1, timing: 1, startDate: 1, expectedEndDate: 1, actualEndDate: 1, capacity: 1, status: 1 }),
    all("students"),
    all("studentbatchallocations"),
    all("studentregistrations"),
  ]);
  const userIds = students.map((s) => s.userId).filter(Boolean);
  const users = await all(
    "users",
    { $or: [{ _id: { $in: userIds } }, { email: { $in: STAFF_EMAILS } }] },
    { fullName: 1, email: 1, role: 1, isActive: 1, passwordHash: 1, "profile.phone": 1 },
  );
  const userById = new Map(users.map((u) => [id(u._id), u]));
  const regById = new Map(registrations.map((r) => [id(r._id), r]));
  const subjectById = new Map(subjects.map((s) => [id(s._id), s]));
  const batchById = new Map(batches.map((b) => [id(b._id), b]));

  const n = { courses: 0, batches: 0, students: 0, leads: 0, enrollments: 0, stageMoves: 0, staff: 0 };

  // Pipeline stages and sources (made by the lms_link migration)
  const stages = await db.pipelineStage.findMany();
  const NEW = stages.find((s) => s.key === "NEW") ?? stages.find((s) => s.type === "OPEN");
  const ENROLLED = stages.find((s) => s.name === "Enrolled") ?? stages.find((s) => s.type === "WON");
  const LOST = stages.find((s) => s.type === "LOST");
  if (!NEW || !ENROLLED || !LOST) throw new Error("The CRM has no New / Enrolled / Lost stages. Run the migrations first.");
  const stageName = new Map(stages.map((s) => [s.id, s.name]));
  const sources = await db.leadSource.findMany({ where: { key: { in: ["lms", "registration_form"] } } });
  const SRC_LMS = sources.find((s) => s.key === "lms")?.id ?? null;
  const SRC_FORM = sources.find((s) => s.key === "registration_form")?.id ?? null;

  // ---- courses
  const courseIdFor = new Map(); // LMS course id -> CRM course id
  const crmCourses = await db.course.findMany();
  for (const c of courses) {
    const lmsId = id(c._id);
    const data = defined({ name: text(c.name), durationMonths: Number(c.durationMonths) || 6, isActive: c.isActive !== false });
    let row = crmCourses.find((x) => x.lmsId === lmsId) ?? crmCourses.find((x) => !x.lmsId && x.code === String(c.code).toUpperCase());
    if (!row) {
      row = await db.course.create({ data: { ...data, code: String(c.code).toUpperCase(), fee: 0, lmsId } });
      n.courses++;
    } else {
      const diff = changes(row, { ...data, lmsId });
      if (has(diff)) {
        await db.course.update({ where: { id: row.id }, data: diff });
        n.courses++;
      }
    }
    courseIdFor.set(lmsId, row.id);
  }
  const coursesTeaching = new Map(); // LMS subject id -> LMS course ids
  for (const c of courses) {
    for (const s of c.subjects || []) {
      const k = id(s.subjectId);
      coursesTeaching.set(k, [...(coursesTeaching.get(k) || []), id(c._id)]);
    }
  }

  // ---- batches: one CRM batch per (LMS batch, course)
  const crmBatches = await db.batch.findMany();
  const batchCache = new Map();
  async function crmBatchFor(lmsBatch, lmsCourseId) {
    const crmCourseId = courseIdFor.get(lmsCourseId);
    if (!lmsBatch || !crmCourseId) return null;
    const lmsId = `${id(lmsBatch._id)}:${lmsCourseId}`;
    if (batchCache.has(lmsId)) return batchCache.get(lmsId);
    const subject = subjectById.get(id(lmsBatch.subjectId));
    const name = `${lmsBatch.batchCode}${subject ? ` · ${subject.name}` : ""}`.slice(0, 120);
    const data = defined({
      name,
      timing: text(lmsBatch.timing),
      mode: mode(lmsBatch.mode),
      startDate: date(lmsBatch.startDate),
      endDate: date(lmsBatch.actualEndDate || lmsBatch.expectedEndDate),
      capacity: Number(lmsBatch.capacity) || 30,
      isActive: !["COMPLETED", "CANCELLED"].includes(lmsBatch.status),
    });
    let row =
      crmBatches.find((x) => x.lmsId === lmsId) ??
      crmBatches.find((x) => !x.lmsId && x.courseId === crmCourseId && x.name === name);
    if (!row) {
      row = await db.batch.create({ data: { startDate: new Date(), ...data, courseId: crmCourseId, lmsId } });
      crmBatches.push(row);
      n.batches++;
    } else {
      const diff = changes(row, { ...data, lmsId });
      if (has(diff)) {
        row = await db.batch.update({ where: { id: row.id }, data: diff });
        n.batches++;
      }
    }
    batchCache.set(lmsId, row.id);
    return row.id;
  }
  for (const b of batches) {
    for (const courseId of coursesTeaching.get(id(b.subjectId)) || []) await crmBatchFor(b, courseId);
  }

  // ---- students and leads
  const crmStudents = await db.student.findMany({
    where: { lmsId: { not: null } },
    select: { id: true, lmsId: true, stageId: true, deletedAt: true, name: true, email: true, phone: true, city: true, address: true, college: true, degree: true, degreeStream: true, degreeScore: true, passOutYear: true, tenthScore: true, twelfthScore: true, preferredMode: true, joiningDate: true, dateOfBirth: true, courseInterestId: true, lostReason: true, photoUrl: true, sourceId: true },
  });
  const byLmsId = new Map(crmStudents.map((s) => [s.lmsId, s]));
  const enrollments = await db.enrollment.findMany({ select: { id: true, studentId: true, batchId: true, status: true } });
  const enrollmentByKey = new Map(enrollments.map((e) => [`${e.studentId}|${e.batchId}`, e]));
  const allocationsByStudent = new Map();
  for (const a of allocations) {
    const k = id(a.studentId);
    allocationsByStudent.set(k, [...(allocationsByStudent.get(k) || []), a]);
  }

  /** Create or update one CRM student/lead. `stage` is forced only when it is Enrolled or Lost. */
  async function upsertPerson({ lmsId, adoptLmsId, data, stage, lostReason, sourceId, createdAt, note }) {
    let row = byLmsId.get(lmsId) ?? (adoptLmsId ? byLmsId.get(adoptLmsId) : undefined);
    if (!row) {
      if (stage === null) return null; // e.g. a rejected registration that was never in the CRM
      row = await db.student.create({
        data: { phone: "", ...data, stageId: stage.id, lostReason: stage === LOST ? lostReason : null, sourceId, lmsId, ...(createdAt ? { createdAt } : {}) },
      });
      await db.activity.create({ data: { studentId: row.id, type: "NOTE", body: note, occurredAt: createdAt ?? new Date() } });
      byLmsId.set(lmsId, row);
      return { row, created: true };
    }
    const diff = changes(row, { ...data, lmsId });
    if (stage && (stage === ENROLLED || stage === LOST) && row.stageId !== stage.id) {
      diff.stageId = stage.id;
      diff.lostReason = stage === LOST ? lostReason : null;
      n.stageMoves++;
      await db.activity.create({
        data: {
          studentId: row.id,
          type: "NOTE",
          body: `Moved from ${stageName.get(row.stageId) ?? "?"} to ${stage.name} by the ScholarLogic LMS${stage === LOST && lostReason ? ` (${lostReason})` : ""}`,
        },
      });
    }
    if (has(diff)) {
      row = { ...row, ...(await db.student.update({ where: { id: row.id }, data: diff })) };
      byLmsId.set(lmsId, row);
      return { row, created: false, changed: true };
    }
    return { row, created: false, changed: false };
  }

  const regStudentIds = new Set();
  for (const s of students) {
    const user = userById.get(id(s.userId));
    if (!user) continue;
    const reg = s.registrationId ? regById.get(id(s.registrationId)) : undefined;
    if (reg) regStudentIds.add(id(reg._id));
    const dropped = s.enrollment?.status === "DROPPED";
    const data = defined({
      name: text(user.fullName),
      email: text(user.email),
      phone: normalizePhone(s.phone) ?? normalizePhone(reg?.phone) ?? normalizePhone(user.profile?.phone),
      city: text(s.location),
      address: text(s.address) ?? text(reg?.address),
      college: text(reg?.college) ?? text(s.college),
      degree: text(reg?.degree),
      degreeStream: text(reg?.degreeStream) ?? text(s.branch),
      degreeScore: text(reg?.degreePercentage),
      passOutYear: year(reg?.passOutYear),
      tenthScore: text(reg?.tenthPercentage),
      twelfthScore: text(reg?.twelfthPercentage),
      dateOfBirth: parseDay(s.dateOfBirth) ?? parseDay(reg?.dateOfBirth),
      preferredMode: mode(s.enrollment?.mode),
      joiningDate: istDay(s.enrollment?.joiningDate),
      courseInterestId: courseIdFor.get(id(s.enrollment?.courseId)),
    });
    const res = await upsertPerson({
      lmsId: `stu:${id(s._id)}`,
      adoptLmsId: reg ? `reg:${id(reg._id)}` : undefined,
      data,
      stage: dropped ? LOST : ENROLLED,
      lostReason: dropped ? "Dropped (ScholarLogic LMS)" : null,
      sourceId: reg ? SRC_FORM : SRC_LMS,
      createdAt: date(reg?.submittedAt) ?? date(s.enrollmentDate) ?? date(s.createdAt),
      note: `Added from the ScholarLogic LMS as student ${s.studentId}`,
    });
    if (!res) continue;
    if (res.created || res.changed) n.students++;

    // batches the student is in
    for (const a of allocationsByStudent.get(id(s._id)) || []) {
      if (a.status === "MOVED") continue;
      const batchId = await crmBatchFor(batchById.get(id(a.batchId)), id(a.courseId) || id(s.enrollment?.courseId));
      if (!batchId) continue;
      const status = a.status === "COMPLETED" ? "COMPLETED" : a.status === "DROPPED" ? "WITHDRAWN" : "ACTIVE";
      const key = `${res.row.id}|${batchId}`;
      const cur = enrollmentByKey.get(key);
      if (!cur) {
        const e = await db.enrollment.create({ data: { studentId: res.row.id, batchId, status, enrolledAt: date(a.startDate) ?? date(a.allocationDate) ?? new Date() } });
        enrollmentByKey.set(key, e);
        n.enrollments++;
      } else if (cur.status !== status) {
        await db.enrollment.update({ where: { id: cur.id }, data: { status } });
        cur.status = status;
        n.enrollments++;
      }
    }
  }

  // Registration form entries that aren't students yet -> leads
  for (const r of registrations) {
    if (regStudentIds.has(id(r._id)) || r.studentId) continue;
    if (r.verificationStatus === "VERIFIED") {
      // Verified means they are a student already (shown above). Hide a lead made from it earlier.
      const old = byLmsId.get(`reg:${id(r._id)}`);
      if (old && !old.deletedAt) {
        await db.student.update({ where: { id: old.id }, data: { deletedAt: new Date() } });
        old.deletedAt = new Date();
        n.leads++;
      }
      continue;
    }
    const rejected = r.verificationStatus === "REJECTED";
    const notes = [
      r.requestedCourse && `Course: ${r.requestedCourse}`,
      r.preferredModeRaw && `Mode: ${r.preferredModeRaw}`,
      r.preferredTiming && `Timing: ${r.preferredTiming}`,
      r.comments && `Comments: ${r.comments}`,
    ].filter(Boolean);
    const res = await upsertPerson({
      lmsId: `reg:${id(r._id)}`,
      data: defined({
        name: text(r.fullName),
        email: text(r.email),
        phone: normalizePhone(r.phone),
        address: text(r.address),
        college: text(r.college),
        degree: text(r.degree),
        degreeStream: text(r.degreeStream),
        degreeScore: text(r.degreePercentage),
        passOutYear: year(r.passOutYear),
        tenthScore: text(r.tenthPercentage),
        twelfthScore: text(r.twelfthPercentage),
        dateOfBirth: parseDay(r.dateOfBirth),
        preferredMode: mode(r.preferredMode),
        joiningDate: istDay(r.joiningDate),
        courseInterestId: courseIdFor.get(id(r.courseId)),
      }),
      stage: rejected ? (byLmsId.has(`reg:${id(r._id)}`) ? LOST : null) : NEW,
      lostReason: rejected ? `Registration rejected${r.rejectionReason ? `: ${r.rejectionReason}` : ""}` : null,
      sourceId: SRC_FORM,
      createdAt: date(r.submittedAt),
      note: ["Registration form received on the ScholarLogic website.", ...notes].join("\n"),
    });
    if (res && (res.created || res.changed)) n.leads++;
  }

  // ---- staff logins (only the emails in LMS_STAFF_EMAILS)
  for (const email of STAFF_EMAILS) {
    const u = users.find((x) => String(x.email).toLowerCase() === email);
    if (!u) continue;
    const row = await db.user.findUnique({ where: { email } });
    if (!row) {
      await db.user.create({
        data: { name: u.fullName, email, phone: text(u.profile?.phone) ?? null, passwordHash: u.passwordHash, role: STAFF_ROLE, isActive: u.isActive !== false, lmsId: id(u._id) },
      });
      n.staff++;
    } else if (row.lmsId === id(u._id)) {
      // Same password and on/off as the LMS. A password change ends their CRM sessions.
      const diff = changes(row, { passwordHash: u.passwordHash, isActive: u.isActive !== false });
      if (has(diff)) {
        await db.user.update({ where: { id: row.id }, data: { ...diff, ...(diff.passwordHash ? { sessionVersion: { increment: 1 } } : {}) } });
        n.staff++;
      }
    }
    // A CRM login made by hand (no lmsId) is never changed.
  }

  return n;
}

// ---------- loop

let running = false;
async function tick() {
  if (running) return;
  running = true;
  const started = Date.now();
  try {
    const n = await syncOnce();
    const total = Object.values(n).reduce((a, b) => a + b, 0);
    if (total > 0 || ONCE) {
      console.log(
        `${new Date().toISOString()} LMS sync: ${n.courses} courses, ${n.batches} batches, ${n.students} students, ` +
          `${n.leads} leads, ${n.enrollments} batch places, ${n.stageMoves} stage moves, ${n.staff} staff logins changed (${Date.now() - started} ms)`,
      );
    }
  } catch (error) {
    console.error(`${new Date().toISOString()} LMS sync failed:`, error?.message ?? error);
    if (ONCE) process.exitCode = 1;
  } finally {
    running = false;
  }
}

await mongo.connect();
await tick();
if (ONCE) {
  await mongo.close();
  await db.$disconnect();
} else {
  console.log(`LMS sync running every ${EVERY_MINUTES} minutes.`);
  setInterval(tick, EVERY_MINUTES * 60 * 1000);
}
