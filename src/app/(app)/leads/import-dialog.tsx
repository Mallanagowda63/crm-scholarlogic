"use client";

import { FileUp, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS } from "@/lib/leads";
import { commitLeadImport, previewLeadImport, type ImportPreview } from "@/server/actions/leads";

type ReadyPreview = Extract<ImportPreview, { ok: true }>;

const TEMPLATE =
  "Name,Phone,Alternate Phone,Email,Parent Name,Parent Phone,City,Class,Board,School,Target Exam,Course,Source,Budget,Preferred Intake,Notes\n" +
  "Sample Student,9000000000,,sample@example.com,Sample Parent,9000000001,Bengaluru,11th,CBSE,Sample School,JEE,JEE-2Y,Website,150000,June 2027,Prefers evening batches\n";

export function ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [text, setText] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<ReadyPreview | null>(null);
  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  function clear() {
    setText(null);
    setFileName("");
    setPreview(null);
    setIncludeDuplicates(false);
  }

  function close() {
    onOpenChange(false);
    clear();
  }

  async function chooseFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      toast.error("Choose a CSV file smaller than 900 KB.");
      return;
    }
    setIsBusy(true);
    try {
      const content = await file.text();
      const result = await previewLeadImport(content);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setText(content);
      setFileName(file.name);
      setPreview(result);
    } catch {
      toast.error("Couldn't read that file. Please try again.");
    } finally {
      setIsBusy(false);
    }
  }

  async function runImport() {
    setIsBusy(true);
    try {
      const result = await commitLeadImport(text, includeDuplicates);
      if (result.ok) {
        toast.success(`${result.count.toLocaleString("en-IN")} ${result.count === 1 ? "lead" : "leads"} imported`);
        close();
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("The import didn't finish, and no leads were added. Please try again.");
    } finally {
      setIsBusy(false);
    }
  }

  const importCount = preview ? preview.valid + (includeDuplicates ? preview.duplicates : 0) : 0;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import leads</DialogTitle>
          <DialogDescription>
            Upload a CSV with up to {MAX_IMPORT_ROWS.toLocaleString("en-IN")} rows. Only Name and Phone are required. New
            leads start at the New stage.
          </DialogDescription>
        </DialogHeader>

        {!preview ? (
          <div className="space-y-3">
            <Label
              htmlFor="import-file"
              className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed p-8 text-center font-normal text-muted-foreground transition-colors hover:border-primary/50 hover:bg-muted/50 has-focus-visible:ring-3 has-focus-visible:ring-ring/50"
            >
              {isBusy ? <Loader2 className="size-6 animate-spin" aria-hidden /> : <FileUp className="size-6" aria-hidden />}
              {isBusy ? "Checking your file..." : "Choose a CSV file"}
              <input
                id="import-file"
                type="file"
                accept=".csv,text/csv"
                disabled={isBusy}
                className="sr-only"
                onChange={(event) => {
                  void chooseFile(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </Label>
            <a
              href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`}
              download="scholarlogic-import-template.csv"
              className="inline-block text-sm text-primary-soft-foreground underline-offset-4 hover:underline"
            >
              Download a template
            </a>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <p className="truncate font-medium">{fileName}</p>
            <dl className="grid grid-cols-3 gap-2 text-center">
              <Stat label="Ready to import" value={preview.valid} />
              <Stat label="Possible duplicates" value={preview.duplicates} />
              <Stat label="With errors" value={preview.errorCount} />
            </dl>

            {preview.duplicates > 0 && (
              <div className="flex items-start gap-2">
                <Checkbox
                  id="include-duplicates"
                  checked={includeDuplicates}
                  onCheckedChange={(checked) => setIncludeDuplicates(checked)}
                  className="mt-0.5"
                />
                <Label htmlFor="include-duplicates" className="font-normal">
                  Also import the possible duplicates, whose phone or email is already in the system
                </Label>
              </div>
            )}

            {preview.errorCount > 0 && (
              <div>
                <p className="mb-1 font-medium">Rows with errors won&apos;t be imported:</p>
                <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg border p-2 text-xs text-muted-foreground">
                  {preview.errors.map(({ line, message }) => (
                    <li key={line}>
                      <span className="font-medium text-foreground">Line {line}:</span> {message}
                    </li>
                  ))}
                </ul>
                {preview.errorCount > preview.errors.length && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Showing the first {preview.errors.length} of {preview.errorCount}.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {preview && (
            <Button variant="ghost" size="lg" onClick={clear} disabled={isBusy}>
              Choose another file
            </Button>
          )}
          <Button variant="outline" size="lg" onClick={close} disabled={isBusy}>
            Cancel
          </Button>
          {preview && (
            <Button size="lg" onClick={runImport} disabled={isBusy || importCount === 0}>
              {isBusy && <Loader2 className="animate-spin" aria-hidden />}
              Import {importCount.toLocaleString("en-IN")} {importCount === 1 ? "lead" : "leads"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border p-2">
      <dd className="text-lg font-semibold">{value.toLocaleString("en-IN")}</dd>
      <dt className="text-xs text-muted-foreground">{label}</dt>
    </div>
  );
}
