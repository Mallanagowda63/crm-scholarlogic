"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { LOST_REASONS } from "@/lib/leads";

const OTHER = "Other";

export function LostReasonDialog({
  subject,
  onResult,
}: {
  subject: string | null;
  onResult: (reason: string | null) => void;
}) {
  const [choice, setChoice] = useState("");
  const [other, setOther] = useState("");
  const reason = choice === OTHER ? other.trim() : choice;

  function finish(result: string | null) {
    onResult(result);
    setChoice("");
    setOther("");
  }

  return (
    <Dialog open={subject !== null} onOpenChange={(open) => !open && finish(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark {subject} as lost?</DialogTitle>
          <DialogDescription>The reason feeds your conversion reports.</DialogDescription>
        </DialogHeader>
        <form
          id="lost-reason"
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (reason) finish(reason);
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="lost-reason-choice">Reason</Label>
            <NativeSelect
              id="lost-reason-choice"
              value={choice}
              onChange={(event) => setChoice(event.target.value)}
              className="w-full [&>select]:h-10"
            >
              <NativeSelectOption value="">Choose a reason</NativeSelectOption>
              {LOST_REASONS.map((option) => (
                <NativeSelectOption key={option} value={option}>
                  {option}
                </NativeSelectOption>
              ))}
              <NativeSelectOption value={OTHER}>{OTHER}</NativeSelectOption>
            </NativeSelect>
          </div>
          {choice === OTHER && (
            <div className="space-y-1.5">
              <Label htmlFor="lost-reason-other">Tell us more</Label>
              <Input
                id="lost-reason-other"
                value={other}
                maxLength={200}
                onChange={(event) => setOther(event.target.value)}
                className="h-10"
              />
            </div>
          )}
        </form>
        <DialogFooter>
          <Button variant="outline" size="lg" onClick={() => finish(null)}>
            Cancel
          </Button>
          <Button type="submit" form="lost-reason" size="lg" disabled={!reason}>
            Mark as lost
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
