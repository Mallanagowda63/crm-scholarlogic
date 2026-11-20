import { expect, test, type Page } from "@playwright/test";

import { db, emailOf, expectToast, path, signIn } from "./helpers";

let lastStamp = 0;
/** A fresh valid number, far from the ones in the sample data. */
const newPhone = () => {
  lastStamp = Math.max(lastStamp + 1, Date.now());
  return `7${String(lastStamp % 1_000_000_000).padStart(9, "0")}`;
};
const stored = (phone: string) => `+91${phone}`;
const userId = async (who: string) => (await db.user.findUniqueOrThrow({ where: { email: emailOf(who) } })).id;

async function makeLead(name: string, owner: string) {
  const phone = newPhone();
  const stage = await db.pipelineStage.findUniqueOrThrow({ where: { name: "Contacted" } });
  const student = await db.student.create({
    data: { name, phone: stored(phone), stageId: stage.id, assignedToId: await userId(owner) },
  });
  return { phone, student };
}

async function openCallEnquiry(page: Page) {
  await page.goto("/leads", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Call enquiry" }).click();
  await expect(page.getByRole("dialog", { name: "Call enquiry" })).toBeVisible();
}

test.describe("Call enquiry", () => {
  test("a new number becomes a Phone Call lead with the call on its timeline", async ({ page }) => {
    const phone = newPhone();
    await signIn(page, "admin");
    await openCallEnquiry(page);

    const dialog = page.getByRole("dialog", { name: "Call enquiry" });
    await dialog.getByLabel(/^Phone/).fill(phone);
    await dialog.getByLabel(/Caller's name/).fill("Phone Caller Finch");
    await dialog.getByLabel("Course of interest").selectOption({ label: "Python Full Stack Development" });
    await dialog.getByLabel("What did they ask?").fill("Asked about weekend batches.");
    await dialog.getByRole("button", { name: "Add lead" }).click();
    await expectToast(page, "Phone Caller Finch added from a call");

    const lead = await db.student.findFirstOrThrow({
      where: { phone: stored(phone) },
      include: { source: true, courseInterest: true, stage: true, activities: true },
    });
    expect(lead.name).toBe("Phone Caller Finch");
    expect(lead.source?.key).toBe("phone_call");
    expect(lead.courseInterest?.name).toBe("Python Full Stack Development");
    expect(lead.stage.name).toBe("New");
    expect(lead.lastContactedAt).not.toBeNull();
    expect(lead.activities).toEqual([expect.objectContaining({ type: "CALL", body: "Asked about weekend batches." })]);

    // An admin's call goes round robin, and that counsellor is told about it.
    expect(lead.assignedToId).not.toBeNull();
    const notice = await db.notification.findFirstOrThrow({ where: { link: `/students/${lead.id}` } });
    expect(notice.userId).toBe(lead.assignedToId);
    expect(notice.title).toBe("New call enquiry");
    expect(notice.message).toContain("Phone Caller Finch called about Python Full Stack Development");
  });

  test("a counsellor's call stays with them and needs a name", async ({ page }) => {
    const phone = newPhone();
    await signIn(page, "counsellor");
    await openCallEnquiry(page);

    const dialog = page.getByRole("dialog", { name: "Call enquiry" });
    await dialog.getByLabel(/^Phone/).fill(phone);
    await dialog.getByRole("button", { name: "Add lead" }).click();
    await expect(dialog.getByText("Enter the caller's name")).toBeVisible();
    expect(await db.student.count({ where: { phone: stored(phone) } })).toBe(0);

    await dialog.getByLabel(/Caller's name/).fill("Own Call Sparrow");
    await dialog.getByRole("button", { name: "Add lead" }).click();
    await expectToast(page, "Own Call Sparrow added from a call");

    const lead = await db.student.findFirstOrThrow({ where: { phone: stored(phone) }, include: { activities: true } });
    expect(lead.assignedToId).toBe(await userId("counsellor"));
    expect(lead.activities[0]?.body).toBe("Called to ask about a course.");
    expect(await db.notification.count({ where: { link: `/students/${lead.id}` } })).toBe(0);
    await expect(page.getByRole("row", { name: /Own Call Sparrow/ })).toBeVisible();
  });

  test("a known number logs the call on the existing profile instead of a duplicate", async ({ page }) => {
    const { phone, student } = await makeLead("Known Caller Robin", "kavya");
    await signIn(page, "admin");
    await openCallEnquiry(page);

    const dialog = page.getByRole("dialog", { name: "Call enquiry" });
    // Typed the way people often say it, with a leading zero.
    await dialog.getByLabel(/^Phone/).fill(`0${phone}`);
    await expect(dialog.getByText("Already in the CRM: Known Caller Robin")).toBeVisible();
    await expect(dialog.getByLabel(/Caller's name/)).toHaveCount(0);
    await dialog.getByLabel("What did they ask?").fill("Wants to know the demo timing.");
    await dialog.getByRole("button", { name: "Log call" }).click();

    await expectToast(page, "Call logged on Known Caller Robin's profile");
    await page.waitForURL(`**/students/${student.id}`);
    expect(path(page)).toBe(`/students/${student.id}`);
    await expect(page.getByRole("main")).toContainText("Wants to know the demo timing.");

    expect(await db.student.count({ where: { phone: stored(phone) } })).toBe(1);
    const call = await db.activity.findFirstOrThrow({ where: { studentId: student.id, type: "CALL" } });
    expect(call.body).toBe("Wants to know the demo timing.");
    const notice = await db.notification.findFirstOrThrow({ where: { link: `/students/${student.id}` } });
    expect(notice.userId).toBe(await userId("kavya"));
    const admin = await db.user.findUniqueOrThrow({ where: { email: emailOf("admin") } });
    expect(notice.message).toBe(`Known Caller Robin called again. ${admin.name} logged it.`);
  });

  test("a counsellor can't log a call on another counsellor's lead", async ({ page }) => {
    const { phone, student } = await makeLead("Other Owner Lark", "kavya");
    await signIn(page, "counsellor");
    await openCallEnquiry(page);

    const dialog = page.getByRole("dialog", { name: "Call enquiry" });
    await dialog.getByLabel(/^Phone/).fill(phone);
    await expect(dialog.getByText("Already in the CRM: Other Owner Lark")).toBeVisible();
    await expect(dialog.getByText("This lead belongs to another counsellor.", { exact: false })).toBeVisible();
    await expect(dialog.getByRole("link", { name: "Open profile" })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Log call" })).toBeDisabled();
    expect(await db.activity.count({ where: { studentId: student.id } })).toBe(0);
  });

  test("the Phone Call source can be renamed without breaking quick add", async ({ page }) => {
    const source = await db.leadSource.findUniqueOrThrow({ where: { key: "phone_call" } });
    await db.leadSource.update({ where: { id: source.id }, data: { name: "Inbound Call" } });
    try {
      const phone = newPhone();
      await signIn(page, "admin");
      await openCallEnquiry(page);
      const dialog = page.getByRole("dialog", { name: "Call enquiry" });
      await dialog.getByLabel(/^Phone/).fill(phone);
      await dialog.getByLabel(/Caller's name/).fill("Renamed Source Tern");
      await dialog.getByRole("button", { name: "Add lead" }).click();
      await expectToast(page, "Renamed Source Tern added from a call");
      const lead = await db.student.findFirstOrThrow({ where: { phone: stored(phone) } });
      expect(lead.sourceId).toBe(source.id);
    } finally {
      await db.leadSource.update({ where: { id: source.id }, data: { name: source.name } });
    }
  });
});
