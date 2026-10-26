// SPDX-License-Identifier: MIT

export const alertVariantNames = [
  "default",
  "destructive",
  "warning",
  "maintenance",
] as const;

export type AlertVariant = (typeof alertVariantNames)[number];

const destructiveSignals = new Set(["investigating", "major_outage", "down"]);
const warningSignals = new Set([
  "identified",
  "monitoring",
  "degraded",
  "partial_outage",
  "pending",
]);

export function incidentAlertVariant(
  status: string,
  impact?: string | null,
  monitors?: { impact: string }[],
): AlertVariant {
  const signals = [
    status,
    impact ?? "",
    ...(monitors?.map((monitor) => monitor.impact) ?? []),
  ];
  if (signals.some((signal) => destructiveSignals.has(signal))) {
    return "destructive";
  }
  if (signals.some((signal) => warningSignals.has(signal))) return "warning";
  if (signals.some((signal) => signal === "maintenance")) return "maintenance";
  return "default";
}
