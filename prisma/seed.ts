import { PrismaClient, type Board, type PaymentMethod } from "@prisma/client";
import bcrypt from "bcryptjs";
import { addDays, addHours, subDays, subHours } from "date-fns";

import { DEMO_PASSWORD, DEMO_USERS } from "../src/lib/demo-users";

const db = new PrismaClient();

// A small seeded generator, so every run produces the same sample data.
let randomState = 20261101;
function random() {
  randomState = (randomState + 0x6d2b79f5) | 0;
  let t = Math.imul(randomState ^ (randomState >>> 15), 1 | randomState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
const pick = <T>(items: readonly T[]) => items[int(0, items.length - 1)];
const chance = (probability: number) => random() < probability;

const rupees = (amount: number) => amount * 100;

const FIRST_NAMES = [
  "Aarav", "Aditi", "Akash", "Ananya", "Anika", "Arjun", "Aryan", "Bhavna", "Chirag", "Deepika",
  "Dhruv", "Divya", "Farhan", "Gauri", "Harsh", "Ishaan", "Ishita", "Jaya", "Karan", "Kavya",
  "Krishna", "Lakshmi", "Manav", "Meghna", "Mohit", "Nandini", "Naveen", "Neha", "Nikhil", "Pooja",
  "Pranav", "Priyanka", "Rahul", "Riya", "Rohit", "Sahil", "Sameer", "Sana", "Shreya", "Siddharth",
  "Sneha", "Tanvi", "Tarun", "Varun", "Vidya", "Vikram", "Yash", "Zoya",
];
const SURNAMES = [
  "Agarwal", "Bhat", "Chatterjee", "Desai", "Fernandes", "Gowda", "Gupta", "Hegde", "Iyer", "Jain",
  "Joshi", "Kapoor", "Khan", "Kulkarni", "Kumar", "Menon", "Mishra", "Nair", "Patel", "Pillai",
  "Rao", "Reddy", "Sharma", "Shetty", "Singh", "Srinivasan", "Verma", "Yadav",
];
const PARENT_FIRST_NAMES = [
  "Anil", "Geeta", "Mahesh", "Meena", "Rajesh", "Rekha", "Sanjay", "Sunita", "Suresh", "Usha",
];
const LOCALITIES = [
  "Koramangala", "Indiranagar", "HSR Layout", "Jayanagar", "Whitefield", "Malleshwaram",
  "Rajajinagar", "Electronic City", "Marathahalli", "BTM Layout",
];
const SCHOOLS = [
  "Delhi Public School", "Kendriya Vidyalaya", "St. Joseph's High School", "National Public School",
  "Sri Chaitanya School", "Vidya Mandir", "Army Public School", "Bishop Cotton School",
];
const LOST_REASONS = [
  "Fees over budget",
  "Joined another coaching centre",
  "Centre too far from home",
  "Not responding",
  "Didn't attend the demo class",
];
const CALL_NOTES = [
  "Discussed the course structure and batch timings.",
  "Parent asked about the fee instalment options.",
  "Shared the syllabus and faculty details.",
  "Asked to call back after the school exams.",
  "Wants to compare the morning and evening batches.",
];
const DEMO_FEEDBACK = [
  "Enjoyed the physics session and liked the teaching style.",
  "Found the pace comfortable. Parent wants to see the test series.",
  "Asked good questions. Needs extra support in maths.",
  "Liked the faculty but is unsure about the evening timing.",
];
const CHECKLIST = [
  { name: "Latest school report card", isRequired: true },
  { name: "Student ID proof", isRequired: true },
  { name: "Parent ID proof", isRequired: true },
  { name: "Passport-size photo", isRequired: true },
  { name: "Scholarship test result", isRequired: false },
];

const STAGES = [
  { name: "New", color: "#64748B", type: "OPEN", count: 18 },
  { name: "Contacted", color: "#0EA5E9", type: "OPEN", count: 16 },
  { name: "Demo Scheduled", color: "#8B5CF6", type: "OPEN", count: 12 },
  { name: "Demo Attended", color: "#6366F1", type: "OPEN", count: 12 },
  { name: "Interested", color: "#F59E0B", type: "OPEN", count: 12 },
  { name: "Admitted", color: "#14B8A6", type: "OPEN", count: 8 },
  { name: "Enrolled", color: "#22C55E", type: "WON", count: 30 },
  { name: "Lost", color: "#EF4444", type: "LOST", count: 12 },
] as const;
const DEMO_SCHEDULED = 2;
const DEMO_ATTENDED = 3;
const INTERESTED = 4;
const ADMITTED = 5;
const ENROLLED = 6;
const LOST = 7;

const SOURCES = ["Website", "Walk-in", "Instagram", "Facebook", "Google Ads", "Referral", "Fair/Event"];
const TARGET_EXAMS = ["JEE", "NEET", "Foundation", "Boards", "KCET"];
const BOARDS: readonly Board[] = ["CBSE", "CBSE", "ICSE", "STATE"];

const COURSES = [
  { code: "JEE-2Y", name: "JEE Main + Advanced (2-Year)", fee: 165000, durationMonths: 24, exam: "JEE", classes: ["11th"], instalments: 4 },
  { code: "JEE-1Y", name: "JEE Main + Advanced (1-Year)", fee: 95000, durationMonths: 12, exam: "JEE", classes: ["12th", "Dropper"], instalments: 3 },
  { code: "NEET-1Y", name: "NEET UG (1-Year)", fee: 90000, durationMonths: 12, exam: "NEET", classes: ["12th", "Dropper"], instalments: 3 },
  { code: "NEET-2Y", name: "NEET UG (2-Year)", fee: 155000, durationMonths: 24, exam: "NEET", classes: ["11th"], instalments: 4 },
  { code: "FND-10", name: "Class 10 Foundation", fee: 48000, durationMonths: 10, exam: "Foundation", classes: ["9th", "10th"], instalments: 3 },
  { code: "BRD-12", name: "Class 12 Boards (PCM/PCB)", fee: 36000, durationMonths: 9, exam: "Boards", classes: ["12th"], instalments: 2 },
  { code: "KCET-CR", name: "KCET Crash Course", fee: 22000, durationMonths: 2, exam: "KCET", classes: ["12th", "Dropper"], instalments: 2 },
] as const;

const ORG = {
  name: "Theta",
  address: "2nd Floor, 14 Residency Road, Bengaluru, Karnataka 560025",
  gstin: "29ABCDE1234F1Z5",
  receiptPrefix: "THETA",
};

const METHODS: readonly PaymentMethod[] = ["UPI", "UPI", "UPI", "BANK_TRANSFER", "CARD", "CASH"];

/** Indian financial years run from April to March, such as 2026-27. */
function financialYear(date: Date) {
  const start = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  return `${start}-${String(start + 1).slice(2)}`;
}

/** Splits a GST-inclusive amount into its taxable value and equal CGST and SGST. */
function splitGst(total: number, gstRateBps: number) {
  const taxableAmount = Math.round((total * 10000) / (10000 + gstRateBps));
  const tax = total - taxableAmount;
  const cgstAmount = Math.floor(tax / 2);
  return { taxableAmount, cgstAmount, sgstAmount: tax - cgstAmount };
}

function assertSafeToReset() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed in production.");
  }
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1"].includes(url.hostname)) {
    throw new Error(`Refusing to reset a database on ${url.hostname}. Seeding is for local use only.`);
  }
}

async function main() {
  assertSafeToReset();
  const now = new Date();

  // TRUNCATE skips the row-level triggers that block deletes, so seeding can start clean.
  await db.$executeRaw`TRUNCATE
    "AuditLog", "Notification", "MessageTemplate", "Activity", "Task", "Receipt", "Payment",
    "Instalment", "FeePlan", "ChecklistItem", "Document", "Application", "DemoClass", "Enrollment",
    "Batch", "Branch", "AcademicRecord", "Student", "Course", "TargetExam", "LeadSource",
    "PipelineStage", "OrgSettings", "LoginAttempt", "User"
    CASCADE`;

  // ---------- Users ----------
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const allUsers = [
    ...DEMO_USERS,
    { name: "Kavya Reddy", email: "kavya@theta.example", role: "COUNSELLOR" as const },
    { name: "Sandeep Verma", email: "sandeep@theta.example", role: "COUNSELLOR" as const },
  ];
  const users = await Promise.all(
    allUsers.map((user, index) =>
      db.user.create({
        data: { ...user, passwordHash, phone: `+9190003${String(index).padStart(5, "0")}` },
      }),
    ),
  );
  const admin = users.find((user) => user.role === "ADMIN")!;
  const accounts = users.find((user) => user.role === "ACCOUNTS")!;
  const counsellors = users.filter((user) => user.role === "COUNSELLOR");

  // ---------- Reference data ----------
  await db.orgSettings.create({
    data: { ...ORG, legalName: "Theta Education Pvt. Ltd.", phone: "+919000399999", email: "hello@theta.example" },
  });

  const stages = await Promise.all(
    STAGES.map(({ name, color, type }, position) =>
      db.pipelineStage.create({ data: { name, color, type, position } }),
    ),
  );
  const sources = await Promise.all(SOURCES.map((name) => db.leadSource.create({ data: { name } })));
  const targetExams = await Promise.all(
    TARGET_EXAMS.map((name, position) => db.targetExam.create({ data: { name, position } })),
  );
  const branches = await Promise.all(
    [
      { name: "Koramangala", address: "14 Residency Road, Koramangala" },
      { name: "Indiranagar", address: "42 100 Feet Road, Indiranagar" },
    ].map((branch) => db.branch.create({ data: { ...branch, city: "Bengaluru" } })),
  );

  const courses = await Promise.all(
    COURSES.map(({ code, name, fee, durationMonths }) =>
      db.course.create({
        data: { code, name, durationMonths, fee: rupees(fee), description: `${name} at Theta.` },
      }),
    ),
  );

  type SeatTracker = { id: string; capacity: number; filled: number };
  const batchesByCourse = new Map<string, SeatTracker[]>();
  for (const course of courses) {
    const days = course.durationMonths * 30;
    const startDate = subDays(now, 40);
    const upcomingStart = addDays(now, 25);
    const batches = await Promise.all([
      db.batch.create({
        data: {
          courseId: course.id,
          branchId: branches[0].id,
          name: "Morning - Koramangala",
          timing: "Mon–Sat 7–9 AM",
          mode: "OFFLINE",
          startDate,
          endDate: addDays(startDate, days),
          capacity: 30,
        },
      }),
      db.batch.create({
        data: {
          courseId: course.id,
          branchId: branches[1].id,
          name: "Evening - Indiranagar",
          timing: "Mon–Fri 4–6 PM",
          mode: "HYBRID",
          startDate,
          endDate: addDays(startDate, days),
          capacity: 25,
        },
      }),
      db.batch.create({
        data: {
          courseId: course.id,
          name: "Weekend - Online",
          timing: "Sat–Sun 10 AM–1 PM",
          mode: "ONLINE",
          startDate: upcomingStart,
          endDate: addDays(upcomingStart, days),
          capacity: 40,
        },
      }),
    ]);
    batchesByCourse.set(
      course.id,
      batches.map(({ id, capacity }) => ({ id, capacity, filled: 0 })),
    );
  }

  await db.messageTemplate.createMany({
    data: [
      {
        name: "First contact",
        channel: "WHATSAPP",
        body: "Hi {{name}}, thanks for your interest in {{course}} at Theta. When is a good time to talk?",
      },
      {
        name: "Demo class invitation",
        channel: "WHATSAPP",
        body: "Hi {{name}}, you're invited to a free demo class for {{course}} at Theta. Reply to pick a time that suits you.",
      },
      {
        name: "Fee reminder",
        channel: "WHATSAPP",
        body: "Hi {{name}}, your {{course}} fee instalment is due on {{due_date}}. Please contact us with any questions.",
      },
      {
        name: "Welcome email",
        channel: "EMAIL",
        subject: "Welcome to Theta",
        body: "Dear {{name}},\n\nWelcome to {{course}} at Theta. We're glad to have you with us.",
      },
      {
        name: "Application received",
        channel: "EMAIL",
        subject: "We've received your application",
        body: "Dear {{name}},\n\nWe've received your application for {{course}} and will be in touch soon.",
      },
    ],
  });

  // ---------- Students ----------
  const pendingPayments: {
    paymentId: string;
    paidAt: Date;
    amount: number;
    gstRateBps: number;
    studentName: string;
    courseName: string;
  }[] = [];
  let studentNumber = 0;
  let previousParent: { name: string; phone: string } | null = null;

  async function createStudent(stageIndex: number, deleted: boolean) {
    studentNumber += 1;
    const serial = String(studentNumber).padStart(5, "0");
    const first = pick(FIRST_NAMES);
    const last = pick(SURNAMES);
    const name = `${first} ${last}`;
    const courseIndex = int(0, courses.length - 1);
    const course = courses[courseIndex];
    const plan = COURSES[courseIndex];
    const currentClass = pick(plan.classes);
    const assignedTo = counsellors[studentNumber % counsellors.length];
    const isOpen = stageIndex < ENROLLED;
    const locality = pick(LOCALITIES);
    const schoolName = currentClass === "Dropper" ? null : `${pick(SCHOOLS)}, ${locality}`;

    // Later stages take longer to reach, so those students enquired further back.
    const age = stageIndex === 0 ? int(0, 6) : stageIndex >= ENROLLED ? int(45, 180) : int(stageIndex * 3, 40);
    const createdAt = subHours(subDays(now, age), int(0, 8));

    // Every 15th student shares a parent with the one before, as siblings do.
    const parent: { name: string; phone: string } =
      studentNumber % 15 === 0 && previousParent
        ? previousParent
        : { name: `${pick(PARENT_FIRST_NAMES)} ${last}`, phone: `+9190001${serial}` };
    previousParent = parent;

    const student = await db.student.create({
      data: {
        name,
        phone: `+9190000${serial}`,
        alternatePhone: chance(0.25) ? `+9190002${serial}` : null,
        email: chance(0.85) ? `${first}.${last}${studentNumber}@example.com`.toLowerCase() : null,
        parentName: parent.name,
        parentPhone: parent.phone,
        city: "Bengaluru",
        currentClass,
        board: currentClass === "Dropper" ? null : pick(BOARDS),
        schoolName,
        budget: chance(0.6) ? Math.round(course.fee * (0.8 + random() * 0.5)) : null,
        preferredIntake: pick(["January 2027", "April 2027", "June 2027"]),
        lostReason: stageIndex === LOST ? pick(LOST_REASONS) : null,
        createdAt,
        deletedAt: deleted ? subDays(now, int(1, 10)) : null,
        stageId: stages[stageIndex].id,
        sourceId: pick(sources).id,
        courseInterestId: course.id,
        targetExamId: targetExams.find((exam) => exam.name === plan.exam)!.id,
        assignedToId: assignedTo.id,
      },
    });

    // ---------- Timeline ----------
    const lastStep = stageIndex === LOST ? int(1, INTERESTED) : stageIndex;
    const elapsedMs = now.getTime() - createdAt.getTime();
    const stepTime = (step: number) =>
      new Date(createdAt.getTime() + (elapsedMs * step) / (Math.max(lastStep, 1) + 1));
    let lastContactedAt: Date | null = null;

    for (let step = 1; step <= lastStep; step += 1) {
      const occurredAt = stepTime(step);
      await db.activity.create({
        data: {
          studentId: student.id,
          type: "STAGE_CHANGE",
          body: `Stage changed from ${stages[step - 1].name} to ${stages[step].name}`,
          metadata: { from: stages[step - 1].name, to: stages[step].name },
          actorId: assignedTo.id,
          occurredAt,
        },
      });
      const contactedAt = subHours(occurredAt, 2);
      await db.activity.create({
        data: {
          studentId: student.id,
          type: pick(["CALL", "CALL", "WHATSAPP", "EMAIL"] as const),
          body: pick(CALL_NOTES),
          actorId: assignedTo.id,
          occurredAt: contactedAt,
        },
      });
      lastContactedAt = contactedAt;
    }
    if (stageIndex === LOST) {
      await db.activity.create({
        data: {
          studentId: student.id,
          type: "STAGE_CHANGE",
          body: `Stage changed from ${stages[lastStep].name} to Lost`,
          metadata: { from: stages[lastStep].name, to: "Lost" },
          actorId: assignedTo.id,
          occurredAt: subHours(now, int(2, 48)),
        },
      });
    }
    if (chance(0.4)) {
      await db.activity.create({
        data: {
          studentId: student.id,
          type: "NOTE",
          body: pick(["Prefers evening batches.", "Parent makes the final decision.", "Elder sibling studied here."]),
          actorId: assignedTo.id,
          occurredAt: addHours(createdAt, 1),
        },
      });
    }

    // ---------- Demo class ----------
    // Everyone who reached Demo Scheduled has one, and it appears on their timeline.
    if (lastStep >= DEMO_SCHEDULED) {
      const isUpcoming = stageIndex === DEMO_SCHEDULED;
      const noShow = stageIndex === LOST && lastStep === DEMO_SCHEDULED;
      const scheduledAt = isUpcoming ? addDays(now, int(1, 7)) : subHours(stepTime(DEMO_ATTENDED), 1);
      const attended = isUpcoming ? null : !noShow;
      const batch = chance(0.7) ? pick(batchesByCourse.get(course.id)!) : null;
      const feedback = attended ? pick(DEMO_FEEDBACK) : null;

      await db.demoClass.create({
        data: {
          studentId: student.id,
          // A demo is booked into a specific batch or, if undecided, just the course.
          ...(batch ? { batchId: batch.id } : { courseId: course.id }),
          scheduledAt,
          attended,
          feedback,
          counsellorId: assignedTo.id,
          createdAt: stepTime(DEMO_SCHEDULED),
        },
      });
      await db.activity.create({
        data: {
          studentId: student.id,
          type: "DEMO_CLASS",
          body: isUpcoming
            ? `Demo class scheduled for ${course.name}`
            : attended
              ? `Attended demo class for ${course.name}. ${feedback}`
              : `Didn't attend demo class for ${course.name}`,
          metadata: { attended },
          actorId: assignedTo.id,
          occurredAt: isUpcoming ? stepTime(DEMO_SCHEDULED) : scheduledAt,
        },
      });
    }

    // ---------- Follow-ups ----------
    let nextFollowUpAt: Date | null = null;
    if (isOpen) {
      const roll = random();
      // Some overdue, some today and the rest upcoming, so each dashboard list has content.
      nextFollowUpAt =
        roll < 0.2 ? subDays(now, int(1, 5)) : roll < 0.4 ? addHours(now, int(1, 6)) : addDays(now, int(1, 14));
      await db.task.create({
        data: {
          title: `Follow up with ${name}`,
          type: pick(["FOLLOW_UP", "FOLLOW_UP", "CALL", "MEETING"] as const),
          priority: pick(["LOW", "MEDIUM", "MEDIUM", "HIGH"] as const),
          dueAt: nextFollowUpAt,
          reminderAt: subHours(nextFollowUpAt, 1),
          assigneeId: assignedTo.id,
          createdById: assignedTo.id,
          studentId: student.id,
        },
      });
      if (nextFollowUpAt < now && !deleted) {
        await db.notification.create({
          data: {
            userId: assignedTo.id,
            title: "Overdue follow-up",
            message: `Your follow-up with ${name} is overdue.`,
            link: `/students/${student.id}`,
          },
        });
      }
    } else if (chance(0.5)) {
      const dueAt = subDays(now, int(2, 30));
      await db.task.create({
        data: {
          title: `Call ${name}`,
          type: "CALL",
          status: "DONE",
          dueAt,
          completedAt: dueAt,
          assigneeId: assignedTo.id,
          createdById: assignedTo.id,
          studentId: student.id,
        },
      });
    }

    await db.student.update({
      where: { id: student.id },
      data: { lastContactedAt, nextFollowUpAt },
    });

    // ---------- Academics ----------
    if (stageIndex >= DEMO_ATTENDED && stageIndex !== LOST) {
      await db.academicRecord.create({
        data: {
          studentId: student.id,
          qualification: currentClass === "9th" || currentClass === "10th" ? "Class 8" : "Class 10",
          institution: schoolName ?? `${pick(SCHOOLS)}, ${locality}`,
          year: int(2023, 2025),
          score: `${int(68, 97)}%`,
        },
      });
    }

    // ---------- Application ----------
    const isAccepted = stageIndex === ADMITTED || stageIndex === ENROLLED;
    const lostAfterApplying = stageIndex === LOST && lastStep === INTERESTED;
    if (isAccepted || lostAfterApplying || (stageIndex === INTERESTED && chance(0.5))) {
      const submittedAt = stepTime(Math.min(lastStep, INTERESTED));
      const application = await db.application.create({
        data: {
          studentId: student.id,
          courseId: course.id,
          status: isAccepted
            ? "ACCEPTED"
            : lostAfterApplying
              ? pick(["REJECTED", "WITHDRAWN"] as const)
              : pick(["SUBMITTED", "UNDER_REVIEW"] as const),
          submittedAt,
          decidedAt: isAccepted || lostAfterApplying ? addHours(submittedAt, 12) : null,
          createdAt: submittedAt,
        },
      });
      for (const item of CHECKLIST) {
        const completed = isAccepted ? item.isRequired || chance(0.3) : chance(0.55);
        await db.checklistItem.create({
          data: { applicationId: application.id, ...item, completedAt: completed ? submittedAt : null },
        });
      }
    }

    // ---------- Fees ----------
    if (isAccepted) {
      const discountAmount = chance(0.3) ? rupees(pick([2000, 3000, 5000])) : 0;
      const payable = Math.round(((course.fee - discountAmount) * (10000 + course.gstRateBps)) / 10000);
      const feePlan = await db.feePlan.create({
        data: {
          studentId: student.id,
          courseId: course.id,
          totalAmount: course.fee,
          discountAmount,
          gstRateBps: course.gstRateBps,
          createdById: accounts.id,
          createdAt: addDays(createdAt, 3),
        },
      });

      const baseAmount = Math.floor(payable / plan.instalments);
      const planStart = stageIndex === ENROLLED ? addDays(createdAt, 5) : addDays(now, 7);

      for (let sequence = 1; sequence <= plan.instalments; sequence += 1) {
        const amount = sequence === plan.instalments ? payable - baseAmount * (plan.instalments - 1) : baseAmount;
        const dueDate = addDays(planStart, (sequence - 1) * 45);
        const instalment = await db.instalment.create({
          data: { feePlanId: feePlan.id, sequence, amount, dueDate },
        });

        const isDue = dueDate <= now;
        // The first is always paid and later ones mostly, which leaves some overdue.
        const isPaid = stageIndex === ENROLLED && isDue && (sequence === 1 || chance(0.75));
        if (isPaid) {
          const paidAt = subDays(dueDate, int(0, 3));
          const method = pick(METHODS);
          const payment = await db.payment.create({
            data: {
              feePlanId: feePlan.id,
              instalmentId: instalment.id,
              amount,
              method,
              reference: method === "CASH" ? null : `TXN${serial}${sequence}${int(1000, 9999)}`,
              paidAt,
              recordedById: accounts.id,
              createdAt: paidAt,
            },
          });
          pendingPayments.push({
            paymentId: payment.id,
            paidAt,
            amount,
            gstRateBps: course.gstRateBps,
            studentName: name,
            courseName: course.name,
          });
        } else if (isDue && !deleted) {
          await db.notification.create({
            data: {
              userId: accounts.id,
              title: "Overdue payment",
              message: `${name}'s instalment ${sequence} for ${course.name} is overdue.`,
              link: `/students/${student.id}`,
            },
          });
        }
      }
    }

    // ---------- Enrolment ----------
    if (stageIndex === ENROLLED) {
      const batch = batchesByCourse.get(course.id)!.find((option) => option.filled < option.capacity)!;
      batch.filled += 1;
      await db.enrollment.create({
        data: { studentId: student.id, batchId: batch.id, enrolledAt: addDays(createdAt, 6) },
      });
    }
  }

  for (const [stageIndex, { count }] of STAGES.entries()) {
    for (let index = 0; index < count; index += 1) await createStudent(stageIndex, false);
  }
  // A couple of soft-deleted records, so lists can be checked for hiding them.
  await createStudent(0, true);
  await createStudent(LOST, true);

  // ---------- Receipts ----------
  // Numbered after all payments exist, so numbers run in date order within each financial year.
  pendingPayments.sort((a, b) => a.paidAt.getTime() - b.paidAt.getTime());
  const sequences = new Map<string, number>();
  for (const payment of pendingPayments) {
    const year = financialYear(payment.paidAt);
    const sequence = (sequences.get(year) ?? 0) + 1;
    sequences.set(year, sequence);
    await db.receipt.create({
      data: {
        paymentId: payment.paymentId,
        number: `${ORG.receiptPrefix}/${year}/${String(sequence).padStart(4, "0")}`,
        financialYear: year,
        sequence,
        issuedAt: payment.paidAt,
        orgName: ORG.name,
        orgAddress: ORG.address,
        orgGstin: ORG.gstin,
        studentName: payment.studentName,
        courseName: payment.courseName,
        gstRateBps: payment.gstRateBps,
        totalAmount: payment.amount,
        ...splitGst(payment.amount, payment.gstRateBps),
      },
    });
  }

  // ---------- Round robin and audit log ----------
  for (const [index, counsellor] of counsellors.entries()) {
    await db.user.update({
      where: { id: counsellor.id },
      data: { lastAssignedAt: subHours(now, index + 1) },
    });
  }

  await db.auditLog.createMany({
    data: users.map((user) => ({
      actorId: admin.id,
      action: "user.created",
      entityType: "User",
      entityId: user.id,
      after: { name: user.name, role: user.role },
      createdAt: subDays(now, 200),
    })),
  });

  const [studentCount, demoCount, paymentCount, activityCount, taskCount] = await Promise.all([
    db.student.count(),
    db.demoClass.count(),
    db.payment.count(),
    db.activity.count(),
    db.task.count(),
  ]);
  console.log(
    `Seeded ${users.length} users, ${studentCount} students, ${demoCount} demo classes, ` +
      `${paymentCount} payments, ${activityCount} activities and ${taskCount} tasks.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
