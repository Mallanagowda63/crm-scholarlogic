"use client";

import { Loader2, Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { cancelDemo, recordAttendance, rescheduleDemo, scheduleDemo, type DemoResult } from "@/server/actions/demos";
import type { DemoOptions } from "@/server/students";

async function report(action: Promise<DemoResult>, success: string) {
  try {
    const result = await action;
    if (result.ok) toast.success(success);
    else toast.error(result.error);
    return result.ok;
  } catch {
    toast.error("Something went wrong. Please try again.");
    return false;
  }
}

/** The value a date input needs, in the time zone of whoever is using it. */
function toLocalInput(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function ScheduleDemoButton({ studentId, options }: { studentId: string; options: DemoOptions }) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("");
  const [when, setWhen] = useState("");
  const [isPending, startTransition] = useTransition();

  function close() {
    setOpen(false);
    setTarget("");
    setWhen("");
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Plus aria-hidden />
        Schedule demo
      </Button>
      <Dialog open={open} onOpenChange={(next) => !next && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule a demo class</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              startTransition(async () => {
                const input = { target, scheduledAt: new Date(when).toISOString() };
                if (await report(scheduleDemo(studentId, input), "Demo class scheduled")) close();
              });
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="demo-target">Batch or course</Label>
              <NativeSelect
                id="demo-target"
                value={target}
                onChange={(event) => setTarget(event.target.value)}
                className="w-full [&>select]:h-10"
              >
                <NativeSelectOption value="">Choose one</NativeSelectOption>
                <NativeSelectOptGroup label="Batches">
                  {options.batches.map(({ id, name, course, timing }) => (
                    <NativeSelectOption key={id} value={`batch:${id}`}>
                      {course.name}, {name}
                      {timing ? ` (${timing})` : ""}
                    </NativeSelectOption>
                  ))}
                </NativeSelectOptGroup>
                <NativeSelectOptGroup label="Courses, batch undecided">
                  {options.courses.map(({ id, name }) => (
                    <NativeSelectOption key={id} value={`course:${id}`}>
                      {name}
                    </NativeSelectOption>
                  ))}
                </NativeSelectOptGroup>
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="demo-when">When</Label>
              <Input
                id="demo-when"
                type="datetime-local"
                value={when}
                onChange={(event) => setWhen(event.target.value)}
                className="h-10"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" size="lg" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" size="lg" disabled={!target || !when || isPending}>
                {isPending && <Loader2 className="animate-spin" aria-hidden />}
                Schedule
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function DemoActions({
  demoId,
  scheduledAt,
  hasHappened,
}: {
  demoId: string;
  scheduledAt: Date;
  hasHappened: boolean;
}) {
  const [dialog, setDialog] = useState<"attendance" | "reschedule" | null>(null);
  const [attended, setAttended] = useState("yes");
  const [feedback, setFeedback] = useState("");
  const [when, setWhen] = useState("");
  const [isPending, startTransition] = useTransition();

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {hasHappened && (
        <Button variant="outline" onClick={() => setDialog("attendance")}>
          Record attendance
        </Button>
      )}
      <Button
        variant="outline"
        onClick={() => {
          setWhen(toLocalInput(new Date(scheduledAt)));
          setDialog("reschedule");
        }}
      >
        Reschedule
      </Button>
      <Button
        variant="ghost"
        disabled={isPending}
        onClick={() => startTransition(() => report(cancelDemo(demoId), "Demo class cancelled").then(() => undefined))}
      >
        Cancel demo
      </Button>

      <Dialog open={dialog === "attendance"} onOpenChange={(next) => !next && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record attendance</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              startTransition(async () => {
                if (await report(recordAttendance(demoId, { attended, feedback }), "Attendance recorded")) setDialog(null);
              });
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="demo-attended">Did they attend?</Label>
              <NativeSelect
                id="demo-attended"
                value={attended}
                onChange={(event) => setAttended(event.target.value)}
                className="w-full [&>select]:h-10"
              >
                <NativeSelectOption value="yes">Yes, attended</NativeSelectOption>
                <NativeSelectOption value="no">No, didn&apos;t attend</NativeSelectOption>
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="demo-feedback">Feedback (optional)</Label>
              <Textarea
                id="demo-feedback"
                rows={3}
                maxLength={2000}
                value={feedback}
                onChange={(event) => setFeedback(event.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" size="lg" onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button type="submit" size="lg" disabled={isPending}>
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "reschedule"} onOpenChange={(next) => !next && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reschedule the demo class</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              startTransition(async () => {
                const moved = await report(rescheduleDemo(demoId, new Date(when).toISOString()), "Demo class rescheduled");
                if (moved) setDialog(null);
              });
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="demo-new-time">New date and time</Label>
              <Input
                id="demo-new-time"
                type="datetime-local"
                value={when}
                onChange={(event) => setWhen(event.target.value)}
                className="h-10"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" size="lg" onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button type="submit" size="lg" disabled={!when || isPending}>
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
