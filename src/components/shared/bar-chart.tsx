"use client";

import { Bar, BarChart as RechartsBarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { formatRupees } from "@/lib/format";

export type ValueFormat = "count" | "rupees" | "percent";

export function formatValue(value: number, format: ValueFormat) {
  if (format === "rupees") return formatRupees(value);
  if (format === "percent") return `${value.toFixed(1)}%`;
  return value.toLocaleString("en-IN");
}

/** Shortened for axis labels, where ₹12,50,000 would crowd its neighbours. */
function formatAxis(value: number, format: ValueFormat) {
  if (format === "percent") return `${value}%`;
  if (format !== "rupees") return value.toLocaleString("en-IN");
  const rupees = value / 100;
  if (rupees >= 100_000) return `₹${(rupees / 100_000).toFixed(rupees % 100_000 === 0 ? 0 : 1)}L`;
  if (rupees >= 1000) return `₹${Math.round(rupees / 1000)}K`;
  return `₹${rupees}`;
}

type TooltipPayload = { active?: boolean; label?: string; payload?: { value?: number }[] };

function ChartTooltip({ active, label, payload, format }: TooltipPayload & { format: ValueFormat }) {
  const value = payload?.[0]?.value;
  if (!active || value === undefined) return null;
  return (
    <div className="rounded-lg border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md">
      <p className="text-muted-foreground">{label}</p>
      <p className="font-medium">{formatValue(value, format)}</p>
    </div>
  );
}

/**
 * One measure, so one colour and no legend, as the card's title names it. Bars
 * lie sideways when the labels are long, such as stage and course names.
 */
export function BarChart({
  data,
  label,
  format = "count",
  horizontal = false,
}: {
  data: { label: string; value: number }[];
  label: string;
  format?: ValueFormat;
  horizontal?: boolean;
}) {
  // Each sideways bar needs room for its label, so longer lists get a taller chart.
  const height = horizontal ? Math.max(160, data.length * 38 + 32) : 240;

  return (
    <div role="img" aria-label={label} style={{ height }} className="w-full" data-chart={label}>
      <ResponsiveContainer width="100%" height="100%">
        <RechartsBarChart
          data={data}
          layout={horizontal ? "vertical" : "horizontal"}
          margin={{ top: 4, right: 12, bottom: 0, left: 0 }}
          barCategoryGap={horizontal ? 8 : "28%"}
        >
          <CartesianGrid
            horizontal={!horizontal}
            vertical={horizontal}
            stroke="var(--border)"
          />
          {horizontal ? (
            <>
              <XAxis
                type="number"
                allowDecimals={false}
                tickFormatter={(value: number) => formatAxis(value, format)}
                tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="label"
                width={128}
                tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                axisLine={false}
                tickLine={false}
              />
            </>
          ) : (
            <>
              <XAxis
                dataKey="label"
                interval={0}
                tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                allowDecimals={false}
                width={format === "rupees" ? 56 : 32}
                tickFormatter={(value: number) => formatAxis(value, format)}
                tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                axisLine={false}
                tickLine={false}
              />
            </>
          )}
          <Tooltip cursor={{ fill: "var(--muted)" }} content={<ChartTooltip format={format} />} isAnimationActive={false} />
          <Bar
            dataKey="value"
            fill="var(--chart-1)"
            maxBarSize={horizontal ? 22 : 36}
            radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
            isAnimationActive={false}
          />
        </RechartsBarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** The same numbers as text, so a chart is never the only way to read them. */
export function ChartTable({
  data,
  labelHeading,
  valueHeading,
  format = "count",
}: {
  data: { label: string; value: number }[];
  labelHeading: string;
  valueHeading: string;
  format?: ValueFormat;
}) {
  return (
    <details className="mt-2 text-sm">
      <summary className="cursor-pointer rounded text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
        View as table
      </summary>
      <table className="mt-2 w-full text-left text-sm">
        <thead>
          <tr className="border-b text-xs text-muted-foreground">
            <th className="py-1 font-medium">{labelHeading}</th>
            <th className="py-1 text-right font-medium">{valueHeading}</th>
          </tr>
        </thead>
        <tbody>
          {data.map(({ label, value }) => (
            <tr key={label} className="border-b last:border-0">
              <td className="py-1">{label}</td>
              <td className="py-1 text-right tabular-nums">{formatValue(value, format)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
