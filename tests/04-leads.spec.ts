import { expect, test, type Locator, type Page } from "@playwright/test";

import { db, dragTo, emailOf, expectToast, newSignedInContext, noHorizontalScroll, signIn, watchForErrors } from "./helpers";

let lastStamp = 0;
/**
 * A fresh valid number, far from the ones in the sample data. Based on the clock
 * because Playwright restarts this file's process, and any counter, after a failure.
 */
const newPhone = () => {
  lastStamp = Math.max(lastStamp + 1, Date.now());
  return `7${String(lastStamp % 1_000_000_000).padStart(9, "0")}`;
};
const stored = (phone: string) => `+91${phone}`;

const lead = (phone: string) => db.student.findFirstOrThrow({ where: { phone: stored(phone) }, include: { stage: true, assignedTo: true } });
const stageId = async (name: string) => (await db.pipelineStage.findUniqueOrThrow({ where: { name } })).id;
const userId = async (who: string) => (await db.user.findUniqueOrThrow({ where: { email: emailOf(who) } })).id;

async function makeLead(name: string, options: { owner?: string; stage?: string } = {}) {
  const phone = newPhone();
  await db.student.create({
    data: {
      name,
      phone: stored(phone),
      stageId: await stageId(options.stage ?? "New"),
      assignedToId: options.owner ? await userId(options.owner) : null,
    },
  });
  return phone;
}

async function openNewLead(page: Page) {
  await page.getByRole("button", { name: "New lead" }).click();
  await expect(page.getByRole("dialog").getByText("New lead", { exact: true })).toBeVisible();
}

async function submitNewLead(page: Page, name: string, phone: string) {
  await openNewLead(page);
  await page.getByLabel(/Full name/).fill(name);
  await page.getByLabel(/^Phone/).fill(phone);
  await page.getByRole("button", { name: "Add lead" }).click();
}

const search = async (page: Page, text: string) => {
  await page.getByLabel("Search leads").fill(text);
  await page.waitForURL(`**/leads?*q=${encodeURIComponent(text).replace(/%20/g, "+")}*`);
};

const row = (page: Page, name: string) => page.getByRole("row").filter({ hasText: name });

function csvFile(text: string, name = "leads.csv") {
  return { name, mimeType: "text/csv", buffer: Buffer.from(text) };
}

test.describe("adding leads", () => {
  test("validates, saves every field and records the history", async ({ page }) => {
    await signIn(page, "admin");
    await page.goto("/leads", { waitUntil: "networkidle" });
    await openNewLead(page);

    await page.getByRole("button", { name: "Add lead" }).click();
    await expect(page.getByText("Enter the student's name")).toBeVisible();
    await expect(page.getByText("Enter a valid phone number")).toBeVisible();

    const phone = newPhone();
    await page.getByLabel(/Full name/).fill("Field Test Student");
    await page.getByLabel(/^Phone/).fill(`0${phone.slice(0, 5)} ${phone.slice(5)}`);
    await page.getByLabel("Email").fill("FIELD.TEST@Example.com");
    await page.getByLabel("City").fill("Mysuru");
    await page.getByLabel("Parent's name").fill("Field Parent");
    await page.getByLabel("Parent's phone").fill(`+91 ${newPhone()}`);
    await page.getByLabel("Date of birth").fill("2003-05-14");
    await page.getByLabel("Address").fill("12, 4th Cross, Jayanagar");
    await page.getByLabel("College & university").fill("Test College, VTU");
    await page.getByLabel("Degree", { exact: true }).fill("B.E");
    await page.getByLabel("Stream").fill("CSE");
    await page.getByLabel("Degree % or CGPA").fill("7.85");
    await page.getByLabel("Pass-out year").fill("2025");
    await page.getByLabel("10th %").fill("91%");
    await page.getByLabel("12th %").fill("84.5");
    await page.getByLabel("Course of interest").selectOption({ label: "Java Full Stack Development" });
    await page.getByLabel("Mode", { exact: true }).selectOption("Online");
    await page.getByLabel("Joining date").fill("2026-12-01");
    await page.getByLabel("Source", { exact: true }).selectOption({ label: "Referral" });
    await page.getByLabel("Budget (₹)").fill("1,50,000");
    await page.getByLabel("Preferred intake").fill("June 2027");
    await page.getByLabel("Notes").fill("Called from the seminar.");
    await page.getByRole("button", { name: "Add lead" }).click();
    await expectToast(page, "Lead added");

    const saved = await db.student.findFirstOrThrow({
      where: { phone: stored(phone) },
      include: { stage: true, source: true, activities: true },
    });
    expect(saved.email).toBe("field.test@example.com");
    expect(saved.budget).toBe(150000 * 100);
    expect(saved.stage.name).toBe("New");
    expect(saved).toMatchObject({
      address: "12, 4th Cross, Jayanagar",
      college: "Test College, VTU",
      degree: "B.E",
      degreeStream: "CSE",
      degreeScore: "7.85",
      passOutYear: 2025,
      tenthScore: "91",
      twelfthScore: "84.5",
      preferredMode: "ONLINE",
    });
    expect(saved.dateOfBirth?.toISOString().slice(0, 10)).toBe("2003-05-14");
    expect(saved.joiningDate?.toISOString().slice(0, 10)).toBe("2026-12-01");
    expect(saved.source?.name).toBe("Referral");
    expect(saved.activities.map((activity) => activity.body)).toEqual(["Called from the seminar."]);
    expect(await db.auditLog.count({ where: { entityId: saved.id, action: "lead.created" } })).toBe(1);
  });

  test("round robin shares new leads evenly among counsellors", async ({ page }) => {
    await signIn(page, "admin");
    await page.goto("/leads", { waitUntil: "networkidle" });

    const owners: (string | null)[] = [];
    for (let i = 0; i < 3; i += 1) {
      const phone = newPhone();
      await submitNewLead(page, `Round Robin ${i}`, phone);
      await expectToast(page, "Lead added");
      await expect(page.getByRole("dialog")).toBeHidden();
      owners.push((await lead(phone)).assignedToId);
    }
    expect(owners.every(Boolean)).toBe(true);
    expect(new Set(owners).size).toBe(3);
  });

  test("a counsellor's new lead stays with them", async ({ page }) => {
    await signIn(page, "counsellor");
    await page.goto("/leads", { waitUntil: "networkidle" });
    await expect(page.getByLabel("Counsellor", { exact: true })).toHaveCount(0);

    const phone = newPhone();
    await submitNewLead(page, "Self Assigned", phone);
    await expectToast(page, "Lead added");
    expect((await lead(phone)).assignedToId).toBe(await userId("counsellor"));
  });

  test("warns about duplicates by phone and email, and allows saving anyway", async ({ page }) => {
    const phone = await makeLead("Original Person", { owner: "kavya" });
    await db.student.update({ where: { id: (await lead(phone)).id }, data: { email: "dupe.check@example.com" } });
    const before = await db.student.count();

    await signIn(page, "counsellor");
    await page.goto("/leads", { waitUntil: "networkidle" });

    await submitNewLead(page, "Second Person", phone);
    const alert = page.getByRole("alert").filter({ hasText: "might already be in the system" });
    await expect(alert).toContainText("Original Person");
    await expect(alert).toContainText("same phone");
    expect(await db.student.count()).toBe(before);

    await page.getByRole("button", { name: "Keep editing" }).click();
    const otherPhone = newPhone();
    await page.getByLabel(/^Phone/).fill(otherPhone);
    await page.getByLabel("Email").fill("Dupe.Check@example.com");
    await page.getByRole("button", { name: "Add lead" }).click();
    await expect(alert).toContainText("same email");

    await page.getByRole("button", { name: "Save anyway" }).click();
    await expectToast(page, "Lead added");
    expect(await db.student.count()).toBe(before + 1);
  });

  test("also matches a parent's phone, because siblings share one", async ({ page }) => {
    const parentPhone = newPhone();
    await db.student.create({
      data: { name: "Older Sibling", phone: stored(newPhone()), parentPhone: stored(parentPhone), stageId: await stageId("New") },
    });
    await signIn(page, "admin");
    await page.goto("/leads", { waitUntil: "networkidle" });
    await submitNewLead(page, "Younger Sibling", parentPhone);
    await expect(page.getByRole("alert").filter({ hasText: "Older Sibling" })).toBeVisible();
  });
});

test.describe("editing leads", () => {
  test("loads existing values, saves changes and logs what changed", async ({ page }) => {
    const phone = await makeLead("Edit Target", { owner: "admin" });
    await signIn(page, "admin");
    await page.goto(`/leads?q=${phone}`, { waitUntil: "networkidle" });

    await page.getByRole("button", { name: "Actions for Edit Target" }).click();
    await page.getByRole("menuitem", { name: "Edit" }).click();
    await expect(page.getByLabel(/Full name/)).toHaveValue("Edit Target");
    await page.getByLabel("City").fill("Hubballi");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expectToast(page, "Lead updated");

    const saved = await lead(phone);
    expect(saved.city).toBe("Hubballi");
    const log = await db.auditLog.findFirstOrThrow({ where: { entityId: saved.id, action: "lead.updated" } });
    expect(log.after).toEqual({ city: "Hubballi" });
    expect(log.before).toEqual({ city: null });
  });
});

test.describe("the table", () => {
  test("hides enrolled students and soft-deleted people, and paginates", async ({ page }) => {
    const leadTotal = await db.student.count({ where: { deletedAt: null, stage: { type: { not: "WON" } } } });
    await signIn(page, "admin");
    await page.goto("/leads", { waitUntil: "networkidle" });

    await expect(page.getByLabel("Pagination")).toContainText(`1–25 of ${leadTotal}`);
    await page.getByRole("link", { name: "Next page" }).click();
    await expect(page.getByLabel("Pagination")).toContainText(`26–50 of ${leadTotal}`);
    await expect(page).toHaveURL(/page=2/);

    const deleted = await db.student.findFirstOrThrow({ where: { deletedAt: { not: null } } });
    await page.goto(`/leads?q=${deleted.phone.slice(3)}`, { waitUntil: "networkidle" });
    await expect(page.getByText("No leads match these filters")).toBeVisible();

    const enrolled = await db.student.findFirstOrThrow({ where: { deletedAt: null, stage: { type: "WON" } } });
    await page.goto(`/leads?q=${enrolled.phone.slice(3)}`, { waitUntil: "networkidle" });
    await expect(page.getByText("No leads match these filters")).toBeVisible();
  });

  test("searches by name, phone in any format, email and parent", async ({ page }) => {
    const phone = await makeLead("Searchable Zephyrine");
    await signIn(page, "admin");
    await page.goto("/leads", { waitUntil: "networkidle" });

    await search(page, "zephyrine");
    await expect(row(page, "Searchable Zephyrine")).toBeVisible();

    await search(page, phone.slice(2, 8));
    await expect(row(page, "Searchable Zephyrine")).toBeVisible();

    await search(page, "no such person here");
    await expect(page.getByText("No leads match these filters")).toBeVisible();
    await page.getByRole("link", { name: "Clear filters" }).click();
    await expect(page.getByRole("table")).toBeVisible();
  });

  test("filters by stage and source, and the numbers match the database", async ({ page }) => {
    const stage = await db.pipelineStage.findUniqueOrThrow({ where: { name: "Admitted" } });
    const source = await db.leadSource.findUniqueOrThrow({ where: { name: "Referral" } });
    await signIn(page, "admin");
    await page.goto("/leads", { waitUntil: "networkidle" });

    await page.getByLabel("Filter by stage").selectOption(stage.id);
    await expect(page).toHaveURL(new RegExp(`stage=${stage.id}`));
    const staged = await db.student.count({ where: { deletedAt: null, stageId: stage.id } });
    await expect(page.getByLabel("Pagination")).toContainText(`of ${staged}`);

    await page.getByLabel("Filter by stage").selectOption("");
    await page.getByLabel("Filter by source").selectOption(source.id);
    await expect(page).toHaveURL(new RegExp(`source=${source.id}`));
    const sourced = await db.student.count({
      where: { deletedAt: null, sourceId: source.id, stage: { type: { not: "WON" } } },
    });
    await expect(page.getByLabel("Pagination")).toContainText(`of ${sourced}`);
  });

  test("filters overdue follow-ups", async ({ page }) => {
    const overdue = await db.student.count({
      where: { deletedAt: null, stage: { type: { not: "WON" } }, nextFollowUpAt: { lt: new Date() } },
    });
    expect(overdue).toBeGreaterThan(0);
    await signIn(page, "admin");
    await page.goto("/leads?followUp=overdue", { waitUntil: "networkidle" });
    await expect(page.getByLabel("Pagination")).toContainText(`of ${overdue}`);
  });

  test("sorts by name in both directions", async ({ page }) => {
    await signIn(page, "admin");
    await page.goto("/leads", { waitUntil: "networkidle" });
    const names = () => page.locator("tbody tr td:nth-child(2) a:first-child").allTextContents();

    await page.getByRole("link", { name: "Name" }).click();
    await expect(page).toHaveURL(/sort=name/);
    await expect(page.getByRole("columnheader", { name: "Name" })).toHaveAttribute("aria-sort", "ascending");
    const ascending = await names();
    expect(ascending).toEqual([...ascending].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })));

    await page.getByRole("link", { name: "Name" }).click();
    await expect(page.getByRole("columnheader", { name: "Name" })).toHaveAttribute("aria-sort", "descending");
    const descending = await names();
    expect(descending[0].localeCompare(ascending[0])).toBeGreaterThan(0);
  });

  test("bulk assign moves selected leads and logs each one", async ({ page }) => {
    const phones = [await makeLead("Bulk Assign A"), await makeLead("Bulk Assign B")];
    await signIn(page, "admin");
    await page.goto("/leads?q=Bulk+Assign", { waitUntil: "networkidle" });

    await page.getByLabel("Select Bulk Assign A").click();
    await page.getByLabel("Select Bulk Assign B").click();
    await expect(page.getByRole("region", { name: "Bulk actions" })).toContainText("2 leads selected");
    await page.getByLabel("Assign selected leads").selectOption({ label: "Kavya Reddy" });
    await expectToast(page, "2 leads assigned to Kavya Reddy");

    const kavya = await userId("kavya");
    for (const phone of phones) {
      const saved = await lead(phone);
      expect(saved.assignedToId).toBe(kavya);
      expect(await db.auditLog.count({ where: { entityId: saved.id, action: "lead.assigned" } })).toBe(1);
    }
  });

  test("bulk stage change writes the timeline, and Lost requires a reason", async ({ page }) => {
    const phones = [await makeLead("Bulk Stage A"), await makeLead("Bulk Stage B")];
    await signIn(page, "admin");
    await page.goto("/leads?q=Bulk+Stage", { waitUntil: "networkidle" });

    await page.getByLabel("Select all leads on this page").click();
    await page.getByLabel("Change stage of selected leads").selectOption({ label: "Contacted" });
    await expectToast(page, "2 leads moved to Contacted");
    for (const phone of phones) {
      const saved = await lead(phone);
      expect(saved.stage.name).toBe("Contacted");
      const activity = await db.activity.findFirstOrThrow({ where: { studentId: saved.id, type: "STAGE_CHANGE" } });
      expect(activity.body).toBe("Stage changed from New to Contacted");
    }
    // Selections reset when fresh data arrives, so wait for it before selecting again.
    await expect(row(page, "Bulk Stage A")).toContainText("Contacted");

    await page.getByLabel("Select all leads on this page").click();
    await page.getByLabel("Change stage of selected leads").selectOption({ label: "Lost" });
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Mark as lost" })).toBeDisabled();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    expect((await lead(phones[0])).stage.name).toBe("Contacted");

    await page.getByLabel("Change stage of selected leads").selectOption({ label: "Lost" });
    await dialog.getByLabel("Reason").selectOption("Fees over budget");
    await dialog.getByRole("button", { name: "Mark as lost" }).click();
    await expectToast(page, "2 leads moved to Lost");
    const lost = await lead(phones[0]);
    expect(lost.stage.name).toBe("Lost");
    expect(lost.lostReason).toBe("Fees over budget");
    await expect(row(page, "Bulk Stage A")).toContainText("Fees over budget");

    // Reopening clears the reason.
    await page.getByLabel("Select Bulk Stage A").click();
    await page.getByLabel("Change stage of selected leads").selectOption({ label: "Interested" });
    await expectToast(page, "1 lead moved to Interested");
    expect((await lead(phones[0])).lostReason).toBeNull();
  });

  test("soft delete hides a lead, keeps the record and can be undone", async ({ page }) => {
    const phone = await makeLead("Delete Target");
    await signIn(page, "admin");
    await page.goto(`/leads?q=${phone}`, { waitUntil: "networkidle" });

    await page.getByRole("button", { name: "Actions for Delete Target" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await expectToast(page, "Delete Target deleted");
    await expect(page.getByText("No leads match these filters")).toBeVisible();

    const saved = await db.student.findFirstOrThrow({ where: { phone: stored(phone) } });
    expect(saved.deletedAt).not.toBeNull();

    await page.getByRole("button", { name: "Undo" }).click();
    await expectToast(page, "Delete Target restored");
    await expect(row(page, "Delete Target")).toBeVisible();
    expect((await db.student.findFirstOrThrow({ where: { phone: stored(phone) } })).deletedAt).toBeNull();
  });
});

test.describe("the Kanban board", () => {
  const column = (page: Page, stage: string) => page.locator(`section[data-stage="${stage}"]`);
  const handle = (page: Page, name: string) => page.getByRole("button", { name: `Move ${name}`, exact: true });

  async function centre(locator: Locator) {
    await locator.scrollIntoViewIfNeeded();
    const box = (await locator.boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  test("shows every stage, including Admitted, and counts match", async ({ page }) => {
    await signIn(page, "admin");
    await page.goto("/leads?view=board", { waitUntil: "networkidle" });

    for (const name of ["New", "Contacted", "Demo Scheduled", "Demo Attended", "Interested", "Admitted", "Enrolled", "Lost"]) {
      await expect(column(page, name)).toBeVisible();
    }
    const admitted = await db.student.count({ where: { deletedAt: null, stage: { name: "Admitted" } } });
    await expect(column(page, "Admitted").locator("header")).toContainText(String(admitted));
    await expect(column(page, "Admitted").locator("article")).toHaveCount(admitted);
  });

  test("dragging a card moves it, and it survives a reload", async ({ page }) => {
    const phone = await makeLead("Drag Target Aardvark");
    await signIn(page, "admin");
    await page.goto("/leads?view=board&q=Aardvark", { waitUntil: "networkidle" });

    await expect(column(page, "New").getByText("Drag Target Aardvark")).toBeVisible();
    await dragTo(page, await centre(handle(page, "Drag Target Aardvark")), await centre(column(page, "Contacted")));
    await expectToast(page, "Drag Target Aardvark moved to Contacted");
    await expect(column(page, "Contacted").getByText("Drag Target Aardvark")).toBeVisible();
    expect((await lead(phone)).stage.name).toBe("Contacted");

    await page.reload({ waitUntil: "networkidle" });
    await expect(column(page, "Contacted").getByText("Drag Target Aardvark")).toBeVisible();
  });

  test("dropping on Lost asks for a reason, and cancelling puts the card back", async ({ page }) => {
    // Enrolled sits next to Lost, so the card and the column are on screen together.
    const phone = await makeLead("Drag Lost Bumblebee", { stage: "Enrolled" });
    await signIn(page, "admin");
    await page.goto("/leads?view=board&q=Bumblebee", { waitUntil: "networkidle" });

    const dragToLost = async () => {
      const target = await centre(column(page, "Lost"));
      await dragTo(page, await centre(handle(page, "Drag Lost Bumblebee")), target);
    };
    await dragToLost();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Mark Drag Lost Bumblebee as lost?");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(column(page, "Enrolled").getByText("Drag Lost Bumblebee")).toBeVisible();
    expect((await lead(phone)).stage.name).toBe("Enrolled");

    await dragToLost();
    await dialog.getByLabel("Reason").selectOption("Other");
    await dialog.getByLabel("Tell us more").fill("Moved to another city");
    await dialog.getByRole("button", { name: "Mark as lost" }).click();
    await expectToast(page, "Drag Lost Bumblebee moved to Lost");
    const saved = await lead(phone);
    expect(saved.stage.name).toBe("Lost");
    expect(saved.lostReason).toBe("Moved to another city");
  });

  test("a failed save puts the card back and shows an error", async ({ page }) => {
    const phone = await makeLead("Drag Fail Caterpillar");
    await signIn(page, "admin");
    await page.goto("/leads?view=board&q=Caterpillar", { waitUntil: "networkidle" });

    // Someone else deletes this lead while it's still on screen.
    const saved = await lead(phone);
    await db.student.update({ where: { id: saved.id }, data: { deletedAt: new Date() } });

    await dragTo(page, await centre(handle(page, "Drag Fail Caterpillar")), await centre(column(page, "Contacted")));
    await expectToast(page, /no longer exists/);
    await expect(column(page, "Contacted").getByText("Drag Fail Caterpillar")).toHaveCount(0);
  });

  test("the Move to menu works without dragging", async ({ page }) => {
    const phone = await makeLead("Menu Move Dolphin");
    await signIn(page, "admin");
    await page.goto("/leads?view=board&q=Dolphin", { waitUntil: "networkidle" });

    await page.getByRole("button", { name: "Actions for Menu Move Dolphin" }).click();
    await page.getByRole("menuitem", { name: "Demo Scheduled" }).click();
    await expectToast(page, "Menu Move Dolphin moved to Demo Scheduled");
    expect((await lead(phone)).stage.name).toBe("Demo Scheduled");
  });

  test("the keyboard can move a card", async ({ page }) => {
    const phone = await makeLead("Keyboard Move Elephant");
    await signIn(page, "admin");
    await page.goto("/leads?view=board&q=Elephant", { waitUntil: "networkidle" });

    await handle(page, "Keyboard Move Elephant").focus();
    await page.keyboard.press("Space");
    // The default keyboard step is 25 pixels, and columns are about 300 pixels apart.
    for (let i = 0; i < 12; i += 1) await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Space");
    await expectToast(page, "Keyboard Move Elephant moved to Contacted");
    expect((await lead(phone)).stage.name).toBe("Contacted");
  });

  test("moving to Enrolled makes them a student, not a lead", async ({ page }) => {
    const phone = await makeLead("Enrol Target Flamingo");
    await signIn(page, "admin");
    await page.goto("/leads?view=board&q=Flamingo", { waitUntil: "networkidle" });

    // Refused until there's an admission with a batch and fee plan.
    await page.getByRole("button", { name: "Actions for Enrol Target Flamingo" }).click();
    await page.getByRole("menuitem", { name: "Enrolled" }).click();
    await expectToast(page, "Enrol Target Flamingo needs an admission and a fee plan before enrolling.");
    expect((await lead(phone)).stage.type).toBe("OPEN");

    const course = await db.course.findUniqueOrThrow({ where: { code: "AWS" }, include: { batches: true } });
    const { id: studentId } = await lead(phone);
    const plan = await db.feePlan.create({ data: { studentId, courseId: course.id, totalAmount: course.fee, gstRateBps: course.gstRateBps } });
    await db.admission.create({
      data: { studentId, courseId: course.id, batchId: course.batches[0].id, admissionDate: new Date(), feePlanId: plan.id },
    });

    await page.getByRole("button", { name: "Actions for Enrol Target Flamingo" }).click();
    await page.getByRole("menuitem", { name: "Enrolled" }).click();
    await expectToast(page, /now counts as a student/);

    await page.goto("/leads?q=Flamingo", { waitUntil: "networkidle" });
    await expect(page.getByText("No leads match these filters")).toBeVisible();
    expect((await lead(phone)).stage.type).toBe("WON");
  });
});

test.describe("CSV", () => {
  test("export respects filters, and neutralises formulas", async ({ page }) => {
    const phone = await makeLead("=HYPERLINK(\"http://evil.example\")");
    await signIn(page, "admin");
    await page.goto(`/leads?q=${phone}`, { waitUntil: "networkidle" });

    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Export" }).click()]);
    const stream = await download.createReadStream();
    let text = "";
    for await (const chunk of stream) text += chunk.toString();

    expect(download.suggestedFilename()).toMatch(/^scholarlogic-leads-\d{4}-\d{2}-\d{2}\.csv$/);
    const lines = text.replace(/^﻿/, "").trim().split(/\r?\n/);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("Name,Phone,Alternate Phone");
    expect(lines[1].startsWith(`"'=HYPERLINK`)).toBe(true);
    // Phone numbers keep their plus sign.
    expect(lines[1]).toContain(`,${stored(phone)},`);
    expect(await db.auditLog.count({ where: { action: "lead.exported" } })).toBeGreaterThan(0);
  });

  test("a counsellor's export only has their own leads", async ({ page }) => {
    await signIn(page, "counsellor");
    const counsellor = await userId("counsellor");
    const expected = await db.student.count({
      where: { deletedAt: null, assignedToId: counsellor, stage: { type: { not: "WON" } } },
    });
    const response = await page.context().request.get("/leads/export");
    expect(response.status()).toBe(200);
    const lines = (await response.text()).trim().split(/\r?\n/);
    expect(lines).toHaveLength(expected + 1);
  });

  test("import previews, skips bad rows and duplicates, and shares out new leads", async ({ page }) => {
    const existing = await makeLead("Already Here");
    const [a, b, c] = [newPhone(), newPhone(), newPhone()];
    const csv = [
      // Column names as the LMS Google Form sheet has them.
      "Full Name,Mobile,Email,College & University,Degree,Degree Stream,Degree Percentage / CGPA,Pass-out Year,10th Percentage,12th %,Course,Preferred Mode,Source,Budget,Notes",
      `Import One,${a},one@example.com,PES University,B.Tech,IT,8.2,2025,88,79,JFS,Online,Website,"1,50,000",Spoke at the fair`,
      `Import Two,${b},,,BCA,,,2026,,,Python Full Stack Development,offline,referral,,`,
      `Import Three,${c},,,,,,,,,,,,,`,
      `Duplicate Row,${existing},,,,,,,,,,,,,`,
      `Repeat In File,${a},,,,,,,,,,,,,`,
      `Bad Phone,12345,,,,,,,,,,,,,`,
      `Bad Course,${newPhone()},,,,,,,,,No Such Course,,,,`,
    ].join("\n");
    const before = await db.student.count();

    await signIn(page, "admin");
    await page.goto("/leads", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await page.locator("#import-file").setInputFiles(csvFile(csv));

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Ready to import", { exact: true }).locator("..")).toContainText("3");
    await expect(dialog.getByText("Possible duplicates", { exact: true }).locator("..")).toContainText("2");
    await expect(dialog.getByText("With errors", { exact: true }).locator("..")).toContainText("2");
    await expect(dialog).toContainText("Line 7:");
    await expect(dialog).toContainText('Unknown course "No Such Course"');
    expect(await db.student.count()).toBe(before);

    await dialog.getByRole("button", { name: "Import 3 leads" }).click();
    await expectToast(page, "3 leads imported");
    expect(await db.student.count()).toBe(before + 3);

    const one = await db.student.findFirstOrThrow({
      where: { phone: stored(a), name: "Import One" },
      include: { stage: true, courseInterest: true, activities: true },
    });
    expect(one.stage.name).toBe("New");
    expect(one.budget).toBe(150000 * 100);
    expect(one.courseInterest?.code).toBe("JFS");
    expect(one).toMatchObject({
      college: "PES University",
      degree: "B.Tech",
      degreeStream: "IT",
      degreeScore: "8.2",
      passOutYear: 2025,
      tenthScore: "88",
      twelfthScore: "79",
      preferredMode: "ONLINE",
    });
    expect(one.activities.map((activity) => activity.body)).toEqual(["Spoke at the fair"]);
    const two = await db.student.findFirstOrThrow({ where: { phone: stored(b) }, include: { source: true, courseInterest: true } });
    expect(two.source?.name).toBe("Referral");
    expect(two.courseInterest?.code).toBe("PFS");
    expect(two.preferredMode).toBe("OFFLINE");

    const owners = await db.student.findMany({ where: { name: { startsWith: "Import " }, phone: { in: [a, b, c].map(stored) } } });
    expect(new Set(owners.map((owner) => owner.assignedToId)).size).toBe(3);
    expect(await db.student.count({ where: { name: "Bad Phone" } })).toBe(0);
    expect(await db.student.count({ where: { name: "Duplicate Row" } })).toBe(0);
  });

  test("import can include duplicates when asked", async ({ page }) => {
    const existing = await makeLead("Sibling One");
    await signIn(page, "admin");
    await page.goto("/leads", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await page.locator("#import-file").setInputFiles(csvFile(`Name,Phone\nSibling Two,${existing}\n`));

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Import 0 leads" })).toBeDisabled();
    await dialog.getByRole("checkbox", { name: /Also import the possible duplicates/ }).click();
    await dialog.getByRole("button", { name: "Import 1 lead" }).click();
    await expectToast(page, "1 lead imported");
    expect(await db.student.count({ where: { name: "Sibling Two" } })).toBe(1);
  });

  test("import explains files it can't use", async ({ page }) => {
    await signIn(page, "admin");
    await page.goto("/leads", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await page.locator("#import-file").setInputFiles(csvFile("City,Email\nMysuru,a@example.com\n"));
    await expectToast(page, "The file needs Name and Phone columns.");
  });

  test("a counsellor's import stays with them", async ({ page }) => {
    const phone = newPhone();
    await signIn(page, "counsellor");
    await page.goto("/leads", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await page.locator("#import-file").setInputFiles(csvFile(`Name,Phone\nCounsellor Import,${phone}\n`));
    await page.getByRole("dialog").getByRole("button", { name: "Import 1 lead" }).click();
    await expectToast(page, "1 lead imported");
    expect((await lead(phone)).assignedToId).toBe(await userId("counsellor"));
  });
});

test.describe("security", () => {
  test("a counsellor only sees their own leads, in every view", async ({ page }) => {
    const counsellor = await userId("counsellor");
    const others = await makeLead("Someone Elses Lead", { owner: "kavya" });
    const own = await db.student.count({ where: { deletedAt: null, assignedToId: counsellor, stage: { type: { not: "WON" } } } });

    await signIn(page, "counsellor");
    await page.goto("/leads", { waitUntil: "networkidle" });
    await expect(page.getByLabel("Pagination")).toContainText(`of ${own}`);

    await page.goto(`/leads?q=${others}`, { waitUntil: "networkidle" });
    await expect(page.getByText("No leads match these filters")).toBeVisible();

    await page.goto(`/leads?view=board&q=${others}`, { waitUntil: "networkidle" });
    await expect(page.getByText("No leads match these filters")).toBeVisible();

    // A counsellor filter in the URL can't widen what they see.
    await page.goto(`/leads?counsellor=${await userId("kavya")}`, { waitUntil: "networkidle" });
    await expect(page.getByLabel("Pagination")).toContainText(`of ${own}`);
    await expect(page.getByLabel("Filter by counsellor")).toHaveCount(0);
  });

  test("the palette doesn't find other counsellors' leads", async ({ page }) => {
    await makeLead("Palette Hidden Gazelle", { owner: "kavya" });
    await makeLead("Palette Visible Gazelle", { owner: "counsellor" });
    await signIn(page, "counsellor");
    await page.waitForLoadState("networkidle");
    await page.keyboard.press("Control+k");
    await page.getByPlaceholder("Search leads, pages or commands...").fill("Gazelle");
    await expect(page.getByRole("option", { name: /Palette Visible Gazelle/ })).toBeVisible();
    await expect(page.getByRole("option", { name: /Palette Hidden Gazelle/ })).toHaveCount(0);
  });

  for (const who of ["accounts", "viewer"]) {
    test(`${who} can't open leads or the export`, async ({ page }) => {
      await signIn(page, who);
      for (const url of ["/leads", "/leads/export"]) {
        const response = await page.context().request.get(url, { maxRedirects: 0 });
        expect(response.status(), url).toBe(307);
        expect(response.headers().location, url).toMatch(/\/forbidden$/);
      }
    });
  }

  test("Server Actions enforce permissions when called directly", async ({ browser }) => {
    // Captures a real request as an admin, then replays it with other people's cookies.
    const target = await makeLead("Replay Target", { owner: "kavya" });
    const saved = await lead(target);
    const { context, page } = await newSignedInContext(browser, "admin");
    await page.goto(`/leads?q=${target}`, { waitUntil: "networkidle" });

    const capture = (matcher: (body: string) => boolean) =>
      page.waitForRequest((request) => request.method() === "POST" && Boolean(request.headers()["next-action"]) && matcher(request.postData() ?? ""));

    await page.getByLabel(`Select Replay Target`).click();
    const assignRequest = capture((body) => body.includes(saved.id));
    await page.getByLabel("Assign selected leads").selectOption({ label: "Sandeep Verma" });
    const assign = await assignRequest;
    await expectToast(page, /assigned to Sandeep Verma/);
    const sandeep = await userId("sandeep");
    expect((await lead(target)).assignedToId).toBe(sandeep);

    const replay = async (who: string) => {
      const other = await newSignedInContext(browser, who);
      const response = await other.context.request.post(assign.url(), {
        headers: {
          "next-action": assign.headers()["next-action"],
          "content-type": assign.headers()["content-type"] ?? "text/plain;charset=UTF-8",
          accept: "text/x-component",
          origin: "http://localhost:3200",
        },
        data: assign.postData() ?? "",
      });
      const text = await response.text();
      await other.context.close();
      return text;
    };

    // Move it away, so a successful replay would be visible as a change.
    const kavya = await userId("kavya");
    for (const who of ["viewer", "accounts", "counsellor"]) {
      await db.student.update({ where: { id: saved.id }, data: { assignedToId: kavya } });
      const text = await replay(who);
      expect(text, who).toContain("You don't have permission");
      expect((await lead(target)).assignedToId, who).toBe(kavya);
    }
    // The same request does work for an admin, so the test really can succeed.
    const adminResult = await context.request.post(assign.url(), {
      headers: {
        "next-action": assign.headers()["next-action"],
        "content-type": assign.headers()["content-type"] ?? "text/plain;charset=UTF-8",
        accept: "text/x-component",
        origin: "http://localhost:3200",
      },
      data: assign.postData() ?? "",
    });
    expect(adminResult.status()).toBe(200);
    expect((await lead(target)).assignedToId).toBe(sandeep);
    await context.close();
  });

  test("a counsellor can't change another counsellor's lead by direct request", async ({ browser }) => {
    const own = await makeLead("Direct Own", { owner: "counsellor" });
    const others = await makeLead("Direct Other", { owner: "kavya" });
    const ownLead = await lead(own);
    const otherLead = await lead(others);

    const { context, page } = await newSignedInContext(browser, "counsellor");
    await page.goto(`/leads?q=${own}`, { waitUntil: "networkidle" });

    await page.getByRole("button", { name: "Actions for Direct Own" }).click();
    const requestPromise = page.waitForRequest(
      (request) => request.method() === "POST" && Boolean(request.headers()["next-action"]) && (request.postData() ?? "").includes(ownLead.id),
    );
    await page.getByRole("menuitem", { name: "Contacted" }).click();
    const request = await requestPromise;
    await expectToast(page, "Direct Own moved to Contacted");

    // Sends the same stage change with someone else's lead in it.
    const response = await context.request.post(request.url(), {
      headers: {
        "next-action": request.headers()["next-action"],
        "content-type": request.headers()["content-type"] ?? "text/plain;charset=UTF-8",
        accept: "text/x-component",
        origin: "http://localhost:3200",
      },
      data: (request.postData() ?? "").replace(ownLead.id, otherLead.id),
    });
    expect(await response.text()).toContain("isn't assigned to you");
    expect((await lead(others)).stage.name).toBe("New");
    await context.close();
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("the table and board fit without sideways page scrolling", async ({ page }) => {
    const problems = watchForErrors(page);
    await signIn(page, "counsellor");
    await page.goto("/leads", { waitUntil: "networkidle" });
    await noHorizontalScroll(page);
    await expect(page.getByRole("table")).toBeVisible();

    await page.goto("/leads?view=board", { waitUntil: "networkidle" });
    await noHorizontalScroll(page);
    await expect(page.locator('section[data-stage="New"]')).toBeVisible();
    expect(problems).toEqual([]);
  });

  test("a counsellor can add and move a lead in the field", async ({ page }) => {
    await signIn(page, "counsellor");
    await page.goto("/leads", { waitUntil: "networkidle" });

    const phone = newPhone();
    await submitNewLead(page, "Mobile Added Hippo", phone);
    await expectToast(page, "Lead added");
    await noHorizontalScroll(page);

    await page.goto(`/leads?view=board&q=${phone}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Actions for Mobile Added Hippo" }).tap();
    await page.getByRole("menuitem", { name: "Contacted" }).tap();
    await expectToast(page, "Mobile Added Hippo moved to Contacted");
  });
});
