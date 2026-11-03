import { expect, test, type Browser, type Page } from "@playwright/test";

import { db, emailOf, expectToast, newSignedInContext, noHorizontalScroll, path, signIn, watchForErrors } from "./helpers";

let lastStamp = 0;
const newPhone = () => {
  lastStamp = Math.max(lastStamp + 1, Date.now());
  return `+917${String(lastStamp % 1_000_000_000).padStart(9, "0")}`;
};
const userId = async (who: string) => (await db.user.findUniqueOrThrow({ where: { email: emailOf(who) } })).id;
const stageId = async (name: string) => (await db.pipelineStage.findUniqueOrThrow({ where: { name } })).id;

async function makeStudent(name: string, options: { owner?: string; stage?: string; email?: string } = {}) {
  return db.student.create({
    data: {
      name,
      phone: newPhone(),
      email: options.email,
      stageId: await stageId(options.stage ?? "New"),
      assignedToId: await userId(options.owner ?? "counsellor"),
    },
  });
}

const openTab = (page: Page, tab: string) =>
  page.getByLabel("Profile sections").getByRole("link", { name: tab, exact: true }).click();

const pdf = (name = "report.pdf", body = "%PDF-1.4 sample") => ({ name, mimeType: "application/pdf", buffer: Buffer.from(body) });

async function enrolledWithFees() {
  return db.student.findFirstOrThrow({
    where: { deletedAt: null, stage: { type: "WON" }, feePlans: { some: { payments: { some: {} } } } },
    include: {
      assignedTo: true,
      admissions: { include: { checklistItems: true, course: true } },
      feePlans: { include: { payments: true, instalments: { include: { payments: true } } } },
    },
  });
}

test.describe("the students list", () => {
  test("shows enrolled students only, with search and pagination", async ({ page }) => {
    const total = await db.student.count({ where: { deletedAt: null, stage: { type: "WON" } } });
    await signIn(page, "admin");
    await page.goto("/students", { waitUntil: "networkidle" });
    await expect(page.getByLabel("Pagination")).toContainText(`of ${total}`);

    const lead = await makeStudent("Not Enrolled Yak", { stage: "New" });
    await page.goto(`/students?q=${encodeURIComponent(lead.name)}`, { waitUntil: "networkidle" });
    await expect(page.getByText("No students match these filters")).toBeVisible();

    const name = `Enrolled Zebra ${Date.now()}`;
    const student = await makeStudent(name, { stage: "Enrolled" });
    await page.goto("/students", { waitUntil: "networkidle" });
    await page.getByLabel("Search students").fill(name);
    // Waits for the search to land, because it would otherwise replace the click below.
    await page.waitForURL(/\/students\?q=Enrolled/);
    await page.getByRole("link", { name }).click();
    await page.waitForURL(`**/students/${student.id}`);
  });

  for (const { label, url, box } of [
    { label: "students", url: "/students", box: "Search students" },
    { label: "leads", url: "/leads", box: "Search leads" },
  ]) {
    test(`text typed in the ${label} search before the page finishes loading still searches`, async ({ page }) => {
      await signIn(page, "admin");
      // Holds back the page's JavaScript, as a slow connection would.
      let release = () => {};
      const held = new Promise<void>((resolve) => (release = resolve));
      await page.route("**/_next/static/chunks/**", async (route) => {
        await held;
        await route.continue();
      });

      await page.goto(url, { waitUntil: "commit" });
      const input = page.getByLabel(box);
      await input.fill("Early Typing");
      release();

      await page.waitForURL(/q=Early/);
      await expect(input).toHaveValue("Early Typing");
    });
  }

  test("counsellors only see their own students", async ({ page }) => {
    const own = await db.student.count({
      where: { deletedAt: null, stage: { type: "WON" }, assignedToId: await userId("counsellor") },
    });
    await signIn(page, "counsellor");
    await page.goto("/students", { waitUntil: "networkidle" });
    if (own > 0) await expect(page.getByLabel("Pagination")).toContainText(`of ${own}`);
  });
});

test.describe("the profile", () => {
  test("opens from the leads table, showing header details and quick actions", async ({ page }) => {
    const lead = await makeStudent("Header Check Ibex", { owner: "kavya", email: "ibex@example.com" });
    await signIn(page, "admin");
    await page.goto(`/leads?q=${encodeURIComponent(lead.name)}`, { waitUntil: "networkidle" });
    await page.getByRole("link", { name: lead.name }).click();
    await page.waitForURL(`**/students/${lead.id}`);

    await expect(page.getByRole("heading", { name: lead.name })).toBeVisible();
    await expect(page.getByRole("main")).toContainText("Counsellor: Kavya Reddy");
    await expect(page.getByRole("link", { name: /^Call/ })).toHaveAttribute("href", `tel:${lead.phone}`);
    await expect(page.getByRole("link", { name: "WhatsApp" })).toHaveAttribute("href", `https://wa.me/${lead.phone.slice(1)}`);
    await expect(page.getByRole("link", { name: "Email" })).toHaveAttribute("href", "mailto:ibex@example.com");
    await expect(page.getByLabel("Breadcrumb").getByRole("link", { name: "Leads" })).toBeVisible();
  });

  test("every tab loads without errors", async ({ page }) => {
    const problems = watchForErrors(page);
    const student = await enrolledWithFees();
    await signIn(page, "admin");
    await page.goto(`/students/${student.id}`, { waitUntil: "networkidle" });

    for (const tab of ["Activity", "Academics", "Documents", "Admission", "Payments", "Notes", "Overview"]) {
      await openTab(page, tab);
      await expect(page.getByLabel("Profile sections").getByRole("link", { name: tab, exact: true })).toHaveAttribute("aria-current", "page");
    }
    expect(problems).toEqual([]);
  });

  test("the timeline shows demo classes, stage changes and contacts, and can be filtered", async ({ page }) => {
    const student = await db.student.findFirstOrThrow({
      where: { deletedAt: null, stage: { name: "Interested" } },
      include: { activities: true },
    });
    await signIn(page, "admin");
    await page.goto(`/students/${student.id}?tab=activity`, { waitUntil: "networkidle" });

    await expect(page.locator('[data-activity-type="DEMO_CLASS"]')).not.toHaveCount(0);
    await expect(page.locator('[data-activity-type="STAGE_CHANGE"]')).not.toHaveCount(0);

    await page.getByLabel("Filter activity by type").selectOption("DEMO_CLASS");
    await expect(page).toHaveURL(/type=DEMO_CLASS/);
    await expect(page.locator('[data-activity-type="STAGE_CHANGE"]')).toHaveCount(0);
    await expect(page.locator('[data-activity-type="DEMO_CLASS"]')).toHaveCount(
      student.activities.filter((activity) => activity.type === "DEMO_CLASS").length,
    );
  });

  test("the timeline paginates long histories", async ({ page }) => {
    const student = await makeStudent("Long History Jackal", { owner: "admin" });
    await db.activity.createMany({
      data: Array.from({ length: 35 }, (_, index) => ({
        studentId: student.id,
        type: "NOTE" as const,
        body: `History entry ${index}`,
        occurredAt: new Date(Date.now() - index * 60_000),
      })),
    });
    await signIn(page, "admin");
    await page.goto(`/students/${student.id}?tab=activity`, { waitUntil: "networkidle" });
    await expect(page.getByText("History entry 0", { exact: true })).toBeVisible();
    await expect(page.getByText("History entry 34", { exact: true })).toHaveCount(0);

    await page.getByRole("link", { name: "Next page" }).click();
    await expect(page.getByText("History entry 34", { exact: true })).toBeVisible();
    await expect(page.getByText("History entry 0", { exact: true })).toHaveCount(0);
  });

  test("notes can be added from the header and the Notes tab, and require text", async ({ page }) => {
    const student = await makeStudent("Note Taker Koala");
    await signIn(page, "counsellor");
    await page.goto(`/students/${student.id}`, { waitUntil: "networkidle" });

    await page.getByRole("button", { name: "Add note" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Save note" }).click();
    await expect(dialog.getByText("Write a note first")).toBeVisible();
    await dialog.getByLabel("Note").fill("Prefers calls after 6 PM.");
    await dialog.getByRole("button", { name: "Save note" }).click();
    await expectToast(page, "Note added");
    await expect(dialog).toBeHidden();

    await openTab(page, "Notes");
    await expect(page.getByText("Prefers calls after 6 PM.")).toBeVisible();
    await page.getByLabel("Add a note").fill("Second note, from the tab.");
    await page.getByRole("button", { name: "Save note" }).click();
    await expect(page.getByText("Second note, from the tab.")).toBeVisible();
    await expect(page.getByLabel("Add a note")).toHaveValue("");

    const notes = await db.activity.findMany({ where: { studentId: student.id, type: "NOTE" } });
    expect(notes).toHaveLength(2);
    expect(notes[0].actorId).toBe(await userId("counsellor"));
  });

  test("notes are shown as plain text, so they can't run scripts", async ({ page }) => {
    const student = await makeStudent("Script Note Lemur", { owner: "admin" });
    await db.activity.create({
      data: { studentId: student.id, type: "NOTE", body: '<img src=x onerror="window.__attacked=true">' },
    });
    await signIn(page, "admin");
    await page.goto(`/students/${student.id}?tab=notes`, { waitUntil: "networkidle" });
    await expect(page.getByText('<img src=x onerror="window.__attacked=true">')).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __attacked?: boolean }).__attacked)).toBeUndefined();
  });

  test("logging a contact updates the timeline and last-contacted date", async ({ page }) => {
    const student = await makeStudent("Contact Log Marmot");
    expect(student.lastContactedAt).toBeNull();
    await signIn(page, "counsellor");
    await page.goto(`/students/${student.id}`, { waitUntil: "networkidle" });

    await page.getByRole("button", { name: "Log contact" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Type").selectOption("WHATSAPP");
    await dialog.getByLabel("Summary").fill("Sent the brochure.");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expectToast(page, "Contact logged");

    const saved = await db.student.findUniqueOrThrow({ where: { id: student.id } });
    expect(saved.lastContactedAt).not.toBeNull();
    const activity = await db.activity.findFirstOrThrow({ where: { studentId: student.id, type: "WHATSAPP" } });
    expect(activity.body).toBe("Sent the brochure.");
    await expect(page.getByText("Sent the brochure.")).toBeVisible();
  });

  test("scheduling and completing follow-ups keeps the next follow-up date right", async ({ page }) => {
    const student = await makeStudent("Follow Up Narwhal");
    await signIn(page, "counsellor");
    await page.goto(`/students/${student.id}`, { waitUntil: "networkidle" });

    const schedule = async (when: string, title: string) => {
      await page.getByRole("button", { name: "Schedule follow-up" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("When").fill(when);
      await dialog.getByLabel(/What for/).fill(title);
      await dialog.getByRole("button", { name: "Schedule", exact: true }).click();
    };
    const local = (daysAhead: number) => {
      const date = new Date(Date.now() + daysAhead * 86_400_000);
      const pad = (value: number) => String(value).padStart(2, "0");
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T10:00`;
    };

    await schedule(local(-2), "In the past");
    await expect(page.getByRole("dialog").getByText("Choose a date and time in the future")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();

    await schedule(local(5), "Later one");
    await expectToast(page, "Follow-up scheduled");
    await expect(page.getByRole("dialog")).toBeHidden();
    await schedule(local(2), "Sooner one");
    await expect(page.getByText("Sooner one", { exact: true })).toBeVisible();

    const tasks = await db.task.findMany({ where: { studentId: student.id }, orderBy: { dueAt: "asc" } });
    expect(tasks.map((task) => task.title)).toEqual(["Sooner one", "Later one"]);
    expect(tasks[0].assigneeId).toBe(await userId("counsellor"));
    // Stored as the moment the person meant, in their own time zone.
    expect(tasks[0].dueAt.getTime()).toBe(new Date(local(2)).getTime());
    let saved = await db.student.findUniqueOrThrow({ where: { id: student.id } });
    expect(saved.nextFollowUpAt?.getTime()).toBe(tasks[0].dueAt.getTime());

    await page.getByRole("button", { name: 'Mark "Sooner one" as done' }).click();
    await expectToast(page, "Follow-up completed");
    await expect(page.getByRole("button", { name: 'Mark "Sooner one" as done' })).toHaveCount(0);
    saved = await db.student.findUniqueOrThrow({ where: { id: student.id } });
    expect(saved.nextFollowUpAt?.getTime()).toBe(tasks[1].dueAt.getTime());

    await page.getByRole("button", { name: 'Mark "Later one" as done' }).click();
    await expect(page.getByText("Nothing scheduled")).toBeVisible();
    saved = await db.student.findUniqueOrThrow({ where: { id: student.id } });
    expect(saved.nextFollowUpAt).toBeNull();
  });

  test("reopening a lost lead brings back its waiting follow-up", async ({ page }) => {
    const student = await makeStudent("Reopen Ocelot", { owner: "admin" });
    const dueAt = new Date(Date.now() + 3 * 86_400_000);
    await db.task.create({ data: { title: "Waiting", dueAt, assigneeId: await userId("admin"), studentId: student.id } });
    await db.student.update({ where: { id: student.id }, data: { nextFollowUpAt: dueAt } });

    await signIn(page, "admin");
    await page.goto(`/students/${student.id}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Actions for Reopen Ocelot" }).click();
    await page.getByRole("menuitem", { name: "Lost" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Reason").selectOption("Not responding");
    await dialog.getByRole("button", { name: "Mark as lost" }).click();
    await expectToast(page, "Reopen Ocelot moved to Lost");
    await expect(page.getByRole("main")).toContainText("Lost: Not responding");
    expect((await db.student.findUniqueOrThrow({ where: { id: student.id } })).nextFollowUpAt).toBeNull();

    await page.getByRole("button", { name: "Actions for Reopen Ocelot" }).click();
    await page.getByRole("menuitem", { name: "Interested" }).click();
    await expectToast(page, "Reopen Ocelot moved to Interested");
    const reopened = await db.student.findUniqueOrThrow({ where: { id: student.id } });
    expect(reopened.nextFollowUpAt?.getTime()).toBe(dueAt.getTime());
    expect(reopened.lostReason).toBeNull();
  });

  test("details can be edited from the profile", async ({ page }) => {
    const student = await makeStudent("Edit Profile Panda", { owner: "admin" });
    await signIn(page, "admin");
    await page.goto(`/students/${student.id}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Actions for Edit Profile Panda" }).click();
    await page.getByRole("menuitem", { name: "Edit" }).click();
    await page.getByLabel("City").fill("Mangaluru");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expectToast(page, "Lead updated");
    await expect(page.getByRole("main")).toContainText("Mangaluru");
  });

  test("academic records can be added, edited and removed, keeping the record", async ({ page }) => {
    const student = await makeStudent("Academic Quokka");
    await signIn(page, "counsellor");
    await page.goto(`/students/${student.id}?tab=academics`, { waitUntil: "networkidle" });

    await page.getByRole("button", { name: "Add record" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog.getByText("Enter the qualification")).toBeVisible();
    await dialog.getByLabel("Qualification").fill("Class 10");
    await dialog.getByLabel("School or institution").fill("Test School");
    await dialog.getByLabel("Year").fill("1800");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog.getByText(/Enter a year from 1990/)).toBeVisible();
    await dialog.getByLabel("Year").fill("2024");
    await dialog.getByLabel(/Score/).fill("91%");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expectToast(page, "Academic record saved");
    await expect(page.getByText("91%")).toBeVisible();

    const record = await db.academicRecord.findFirstOrThrow({ where: { studentId: student.id } });
    expect(record.year).toBe(2024);

    await page.getByRole("button", { name: "Edit Class 10" }).click();
    await expect(dialog.getByLabel("Year")).toHaveValue("2024");
    await dialog.getByLabel(/Score/).fill("93%");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("93%")).toBeVisible();

    await page.getByRole("button", { name: "Remove Class 10" }).click();
    await expect(page.getByText("No results recorded")).toBeVisible();
    const removed = await db.academicRecord.findUniqueOrThrow({ where: { id: record.id } });
    expect(removed.deletedAt).not.toBeNull();
    expect(removed.score).toBe("93%");
    expect(await db.auditLog.count({ where: { entityId: record.id } })).toBe(3);
  });

  test("the Admission tab shows the admission and its checklist", async ({ page }) => {
    const student = await enrolledWithFees();
    await signIn(page, "admin");
    await page.goto(`/students/${student.id}?tab=admission`, { waitUntil: "networkidle" });

    const [admission] = student.admissions;
    await expect(page.getByRole("main")).toContainText(admission.course.name);
    await expect(page.getByRole("main")).toContainText("Confirmed");
    for (const item of admission.checklistItems) await expect(page.getByText(item.name)).toBeVisible();
    const required = admission.checklistItems.filter((item) => item.isRequired);
    await expect(page.getByRole("main")).toContainText(
      `${required.filter((item) => item.completedAt).length} of ${required.length} required`,
    );
  });

  test("the Payments tab adds up to what's in the database", async ({ page }) => {
    const student = await enrolledWithFees();
    const [plan] = student.feePlans;
    const rupees = (paise: number) =>
      new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);
    const payable = Math.round(((plan.totalAmount - plan.discountAmount) * (10000 + plan.gstRateBps)) / 10000);
    const paid = plan.payments.reduce((sum, payment) => sum + payment.amount, 0);

    await signIn(page, "admin");
    await page.goto(`/students/${student.id}?tab=payments`, { waitUntil: "networkidle" });
    const summary = page.getByLabel(/Fee summary for/);
    await expect(summary).toContainText(rupees(payable));
    await expect(summary).toContainText(rupees(paid));
    await expect(summary).toContainText(rupees(payable - paid));
    await expect(page.getByText(/^Instalment \d$/)).toHaveCount(plan.instalments.length);
  });

  test("a soft-deleted payment isn't counted", async ({ page }) => {
    const student = await enrolledWithFees();
    const [plan] = student.feePlans;
    const payment = plan.payments[0];
    await db.payment.update({ where: { id: payment.id }, data: { deletedAt: new Date() } });
    try {
      await signIn(page, "admin");
      await page.goto(`/students/${student.id}?tab=payments`, { waitUntil: "networkidle" });
      await expect(page.getByLabel(/Fee summary for/)).toContainText(`${plan.payments.length - 1} ${plan.payments.length === 2 ? "payment" : "payments"}`);
    } finally {
      await db.payment.update({ where: { id: payment.id }, data: { deletedAt: null } });
    }
  });

  test("deleting from the profile returns to the list", async ({ page }) => {
    const student = await makeStudent("Delete Profile Puffin", { owner: "admin" });
    await signIn(page, "admin");
    await page.goto(`/students/${student.id}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Actions for Delete Profile Puffin" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await expectToast(page, "Delete Profile Puffin deleted");
    await page.waitForURL("**/leads");

    const response = await page.context().request.get(`/students/${student.id}`);
    expect(response.status()).toBe(404);
    await page.getByRole("button", { name: "Undo" }).click();
    await expectToast(page, "Delete Profile Puffin restored");
    expect((await page.context().request.get(`/students/${student.id}`)).status()).toBe(200);
  });

  test("the palette finds people and opens their profile", async ({ page }) => {
    const student = await makeStudent("Palette Profile Rhea", { owner: "admin" });
    await signIn(page, "admin");
    await page.waitForLoadState("networkidle");
    await page.keyboard.press("Control+k");
    await page.getByPlaceholder("Search leads, pages or commands...").fill("Palette Profile Rhea");
    await page.getByRole("option", { name: /Palette Profile Rhea/ }).click();
    await page.waitForURL(`**/students/${student.id}`);
  });
});

test.describe("documents", () => {
  async function upload(page: Page, type: string, file: ReturnType<typeof pdf>) {
    await page.getByLabel("Document type").selectOption(type);
    await page.getByLabel("Document file").setInputFiles(file);
  }

  test("uploads, downloads the same bytes, verifies and removes with undo", async ({ page }) => {
    const student = await makeStudent("Documents Seal");
    await signIn(page, "counsellor");
    await page.goto(`/students/${student.id}?tab=documents`, { waitUntil: "networkidle" });
    await expect(page.getByText("No documents yet")).toBeVisible();
    await expect(page.getByRole("button", { name: "Choose file" })).toBeDisabled();

    const body = "%PDF-1.4 the real contents";
    await upload(page, "School report card", pdf("रिपोर्ट card.pdf", body));
    await expectToast(page, "Document uploaded");
    await expect(page.getByText("रिपोर्ट card.pdf")).toBeVisible();

    const document = await db.document.findFirstOrThrow({ where: { studentId: student.id } });
    expect(document.fileUrl).toMatch(/^[0-9a-f-]{36}\.pdf$/);
    expect(document.status).toBe("PENDING");
    expect(document.uploadedById).toBe(await userId("counsellor"));

    const response = await page.context().request.get(`/students/${student.id}/documents/${document.id}`);
    expect(response.status()).toBe(200);
    expect((await response.body()).toString()).toBe(body);
    expect(response.headers()["content-type"]).toBe("application/pdf");
    expect(response.headers()["content-disposition"]).toContain("attachment");
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(await db.auditLog.count({ where: { entityId: document.id, action: "document.downloaded" } })).toBe(1);

    await page.getByLabel(/^Status of/).selectOption("VERIFIED");
    await expectToast(page, "Document status updated");
    const verified = await db.document.findUniqueOrThrow({ where: { id: document.id } });
    expect(verified.status).toBe("VERIFIED");
    expect(verified.verifiedById).toBe(await userId("counsellor"));

    await page.getByRole("button", { name: /^Remove / }).click();
    await expect(page.getByText("No documents yet")).toBeVisible();
    expect((await db.document.findUniqueOrThrow({ where: { id: document.id } })).deletedAt).not.toBeNull();
    expect((await page.context().request.get(`/students/${student.id}/documents/${document.id}`)).status()).toBe(404);

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByText("रिपोर्ट card.pdf")).toBeVisible();
  });

  test("rejects files by their contents, not their names", async ({ page }) => {
    const student = await makeStudent("Bad Files Tapir");
    await signIn(page, "counsellor");
    await page.goto(`/students/${student.id}?tab=documents`, { waitUntil: "networkidle" });

    await upload(page, "Other", { name: "invoice.pdf", mimeType: "application/pdf", buffer: Buffer.from("MZ this is really a program") });
    await expectToast(page, "Only PDF, JPG, PNG and WebP files can be uploaded.");

    await upload(page, "Other", { name: "page.png", mimeType: "image/png", buffer: Buffer.from("<html><script>alert(1)</script>") });
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Only PDF" }).first()).toBeVisible();
    expect(await db.document.count({ where: { studentId: student.id } })).toBe(0);
  });

  test("rejects files over 5 MB, with a helpful message", async ({ page }) => {
    const student = await makeStudent("Big File Urchin");
    await signIn(page, "counsellor");
    await page.goto(`/students/${student.id}?tab=documents`, { waitUntil: "networkidle" });
    await upload(page, "Other", { name: "big.pdf", mimeType: "application/pdf", buffer: Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(5 * 1024 * 1024 + 10)]) });
    await expectToast(page, "Choose a file smaller than 5 MB.");
    expect(await db.document.count({ where: { studentId: student.id } })).toBe(0);
  });

  test("accepts a file just under the limit, and images too", async ({ page }) => {
    const student = await makeStudent("Limit File Vole");
    await signIn(page, "counsellor");
    await page.goto(`/students/${student.id}?tab=documents`, { waitUntil: "networkidle" });

    await upload(page, "Other", { name: "almost.pdf", mimeType: "application/pdf", buffer: Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(5 * 1024 * 1024 - 10)]) });
    await expect(page.getByText("almost.pdf")).toBeVisible({ timeout: 30_000 });

    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    await upload(page, "Passport-size photo", { name: "photo.png", mimeType: "image/png", buffer: png });
    await expect(page.getByText("photo.png")).toBeVisible();
    const saved = await db.document.findFirstOrThrow({ where: { studentId: student.id, fileName: "photo.png" } });
    expect(saved.fileUrl).toMatch(/\.png$/);
  });
});

test.describe("access", () => {
  async function replay(browser: Browser, who: string, request: { url: string; headers: Record<string, string>; body: string }) {
    const other = await newSignedInContext(browser, who);
    const response = await other.context.request.post(request.url, {
      headers: {
        "next-action": request.headers["next-action"],
        "content-type": request.headers["content-type"] ?? "text/plain;charset=UTF-8",
        accept: "text/x-component",
        origin: "http://localhost:3200",
      },
      data: request.body,
    });
    const text = await response.text();
    await other.context.close();
    return text;
  }

  test("a counsellor gets a 404 for someone else's profile and documents", async ({ page }) => {
    const student = await makeStudent("Private Weasel", { owner: "kavya" });
    const document = await db.document.create({
      data: { studentId: student.id, type: "Other", fileName: "private.pdf", fileUrl: "00000000-0000-0000-0000-000000000000.pdf" },
    });
    await signIn(page, "counsellor");
    const request = page.context().request;
    expect((await request.get(`/students/${student.id}`)).status()).toBe(404);
    expect((await request.get(`/students/${student.id}?tab=documents`)).status()).toBe(404);
    expect((await request.get(`/students/${student.id}/documents/${document.id}`)).status()).toBe(404);
  });

  test("a document can't be fetched through a different student's address", async ({ page }) => {
    const owner = await makeStudent("Doc Owner Xerus", { owner: "counsellor" });
    const other = await makeStudent("Doc Other Xerus", { owner: "counsellor" });
    const document = await db.document.create({
      data: { studentId: owner.id, type: "Other", fileName: "x.pdf", fileUrl: "00000000-0000-0000-0000-000000000000.pdf" },
    });
    await signIn(page, "counsellor");
    expect((await page.context().request.get(`/students/${other.id}/documents/${document.id}`)).status()).toBe(404);
  });

  test("soft-deleted people and unknown ids get a 404", async ({ page }) => {
    const deleted = await db.student.findFirstOrThrow({ where: { deletedAt: { not: null } } });
    await signIn(page, "admin");
    expect((await page.context().request.get(`/students/${deleted.id}`)).status()).toBe(404);
    expect((await page.context().request.get("/students/does-not-exist")).status()).toBe(404);
  });

  test("the viewer can't open profiles", async ({ page }) => {
    const student = await enrolledWithFees();
    await signIn(page, "viewer");
    const response = await page.context().request.get(`/students/${student.id}`, { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers().location).toMatch(/\/forbidden$/);
  });

  test("accounts sees only fee-related tabs, and no editing tools", async ({ page }) => {
    const student = await enrolledWithFees();
    await db.activity.create({ data: { studentId: student.id, type: "NOTE", body: "Sensitive counselling note" } });
    await signIn(page, "accounts");
    await page.goto(`/students/${student.id}`, { waitUntil: "networkidle" });

    const tabs = await page.getByLabel("Profile sections").getByRole("link").allTextContents();
    expect(tabs).toEqual(["Overview", "Admission", "Payments"]);
    for (const button of ["Add note", "Log contact", "Schedule follow-up"]) {
      await expect(page.getByRole("button", { name: button })).toHaveCount(0);
    }
    await expect(page.getByRole("button", { name: /^Actions for/ })).toHaveCount(0);
    await expect(page.getByText("Open follow-ups")).toHaveCount(0);

    // Asking for a hidden tab by address falls back to the overview.
    await page.goto(`/students/${student.id}?tab=notes`, { waitUntil: "networkidle" });
    await expect(page.getByText("Sensitive counselling note")).toHaveCount(0);
    await expect(page.getByText("Contact", { exact: true })).toBeVisible();

    await page.goto(`/students/${student.id}?tab=payments`, { waitUntil: "networkidle" });
    await expect(page.getByLabel(/Fee summary for/)).toBeVisible();
  });

  test("accounts can't open people without an admission, or documents", async ({ page }) => {
    const lead = await makeStudent("Too Early Yak", { owner: "kavya" });
    const student = await enrolledWithFees();
    const document = await db.document.create({
      data: { studentId: student.id, type: "Other", fileName: "id.pdf", fileUrl: "00000000-0000-0000-0000-000000000000.pdf" },
    });
    await signIn(page, "accounts");
    expect((await page.context().request.get(`/students/${lead.id}`)).status()).toBe(404);
    expect((await page.context().request.get(`/students/${student.id}/documents/${document.id}`)).status()).toBe(403);
    await db.document.update({ where: { id: document.id }, data: { deletedAt: new Date() } });
  });

  test("accounts' palette only finds people with an admission", async ({ page }) => {
    await makeStudent("Palette Scope Zorilla", { owner: "kavya" });
    const student = await enrolledWithFees();
    await signIn(page, "accounts");
    await page.waitForLoadState("networkidle");
    await page.keyboard.press("Control+k");
    const input = page.getByPlaceholder("Search students, pages or commands...");
    await input.fill(student.name);
    await expect(page.getByRole("option", { name: new RegExp(student.name) }).first()).toBeVisible();
    await input.fill("Palette Scope Zorilla");
    await page.waitForTimeout(800);
    await expect(page.getByRole("option", { name: /Palette Scope Zorilla/ })).toHaveCount(0);
  });

  test("profile actions refuse direct requests from people without permission", async ({ browser }) => {
    const student = await makeStudent("Replay Note Aye", { owner: "counsellor", stage: "Enrolled" });
    const { context, page } = await newSignedInContext(browser, "counsellor");
    await page.goto(`/students/${student.id}`, { waitUntil: "networkidle" });

    await page.getByRole("button", { name: "Add note" }).click();
    await page.getByRole("dialog").getByLabel("Note").fill("Captured note");
    const requestPromise = page.waitForRequest(
      (request) => request.method() === "POST" && Boolean(request.headers()["next-action"]) && (request.postData() ?? "").includes(student.id),
    );
    await page.getByRole("dialog").getByRole("button", { name: "Save note" }).click();
    const captured = await requestPromise;
    await expectToast(page, "Note added");
    const request = { url: captured.url(), headers: captured.headers(), body: captured.postData() ?? "" };
    await context.close();

    expect(await replay(browser, "accounts", request)).toContain("You don't have permission");
    expect(await replay(browser, "viewer", request)).toContain("You don't have permission");
    expect(await replay(browser, "kavya", request)).toContain("isn't assigned to you");
    expect(await db.activity.count({ where: { studentId: student.id, type: "NOTE" } })).toBe(1);
  });

  test("an admin can open anyone's profile", async ({ page }) => {
    const student = await makeStudent("Admin Sees Bongo", { owner: "kavya" });
    await signIn(page, "admin");
    await page.goto(`/students/${student.id}`);
    expect(path(page)).toBe(`/students/${student.id}`);
    await expect(page.getByRole("heading", { name: student.name })).toBeVisible();
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("the profile and every tab fit the screen, and tabs still work", async ({ page }) => {
    const student = await enrolledWithFees();
    const owner = student.assignedTo!.email.split("@")[0];
    await signIn(page, owner);
    await page.goto(`/students/${student.id}`, { waitUntil: "networkidle" });
    await noHorizontalScroll(page);

    for (const tab of ["activity", "academics", "documents", "admission", "payments", "notes"]) {
      await page.goto(`/students/${student.id}?tab=${tab}`, { waitUntil: "networkidle" });
      await noHorizontalScroll(page);
    }
    await page.getByRole("button", { name: "Add note" }).tap();
    await expect(page.getByRole("dialog").getByLabel("Note")).toBeVisible();
  });

  test("the students list fits the screen", async ({ page }) => {
    await signIn(page, "admin");
    await page.goto("/students", { waitUntil: "networkidle" });
    await noHorizontalScroll(page);
  });
});
