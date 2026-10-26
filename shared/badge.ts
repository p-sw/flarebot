// SPDX-License-Identifier: MIT

import type { BadgeStyle } from "./badge-link";
import { measureHundredths } from "./badge-widths";
import type { HistoryWindow } from "./history";
import { visibleStatus } from "./monitor-status";

export const BADGE_LABEL_COLOR = "#555";
export const BADGE_COLOR_UP = "#4c1";
export const BADGE_COLOR_GREEN = "#97ca00";
export const BADGE_COLOR_YELLOWGREEN = "#a4a61d";
export const BADGE_COLOR_YELLOW = "#dfb317";
export const BADGE_COLOR_ORANGE = "#fe7d37";
export const BADGE_COLOR_RED = "#e05d44";
export const BADGE_COLOR_MUTED = "#9f9f9f";

export const BADGE_STATUSES = [
  "up",
  "down",
  "paused",
  "degraded",
  "unknown",
] as const;
export type BadgeStatus = (typeof BADGE_STATUSES)[number];

const FONT_FAMILY = "Verdana,Geneva,DejaVu Sans,sans-serif";

export function badgeStatusFromRuntime(
  paused: boolean,
  runtime: string | null | undefined,
): Exclude<BadgeStatus, "unknown"> {
  const visible = visibleStatus(paused, runtime);
  if (visible === "up") return "up";
  if (visible === "down") return "down";
  if (visible === "paused") return "paused";
  return "degraded";
}

export function statusColor(status: BadgeStatus): string {
  switch (status) {
    case "up":
      return BADGE_COLOR_UP;
    case "down":
      return BADGE_COLOR_RED;
    case "paused":
      return BADGE_COLOR_YELLOW;
    case "degraded":
      return BADGE_COLOR_ORANGE;
    default:
      return BADGE_COLOR_MUTED;
  }
}

export function uptimeColor(value: number | null): string {
  if (value == null) return BADGE_COLOR_MUTED;
  if (value >= 99.9) return BADGE_COLOR_UP;
  if (value >= 99) return BADGE_COLOR_GREEN;
  if (value >= 95) return BADGE_COLOR_YELLOWGREEN;
  if (value >= 90) return BADGE_COLOR_YELLOW;
  return BADGE_COLOR_RED;
}

export function responseColor(value: number | null): string {
  if (value == null) return BADGE_COLOR_MUTED;
  if (value < 100) return BADGE_COLOR_UP;
  if (value < 200) return BADGE_COLOR_GREEN;
  if (value < 300) return BADGE_COLOR_YELLOW;
  if (value < 500) return BADGE_COLOR_ORANGE;
  return BADGE_COLOR_RED;
}

export function effectiveWindowLabel(window: HistoryWindow): string {
  if (window.configured === "24h" || window.shownDays <= 1) return "24h";
  return `${window.shownDays}d`;
}

function roundUpToOdd(value: number): number {
  return value % 2 === 0 ? value + 1 : value;
}

function preferredWidth(
  text: string,
  font: "verdana11" | "verdana10" | "verdana10Bold",
): number {
  return roundUpToOdd(Math.floor(measureHundredths(text, font) / 100));
}

function charCount(text: string): number {
  return [...text].length;
}

export type BadgeLayout = {
  width: number;
  height: number;
  left: number;
  right: number;
  label: string;
  message: string;
  labelTextWidth: number;
  messageTextWidth: number;
  labelX: number;
  messageX: number;
  textY: number;
  fontSize: number;
  messageBold: boolean;
  radius: number;
  gradient: boolean;
};

export function layoutBadge(input: {
  label: string;
  message: string;
  style: BadgeStyle;
}): BadgeLayout {
  if (input.style === "for-the-badge") return layoutForTheBadge(input);
  const horiz = 5;
  const label = input.label;
  const message = input.message;
  const labelTextWidth = label ? preferredWidth(label, "verdana11") : 0;
  const messageTextWidth = message ? preferredWidth(message, "verdana11") : 0;
  const left = label ? labelTextWidth + horiz * 2 : 0;
  const right = messageTextWidth + horiz * 2;
  const labelMargin = 1;
  let messageMargin = left - (message ? 1 : 0);
  if (!label) messageMargin += 1;
  return {
    width: left + right,
    height: 20,
    left,
    right,
    label,
    message,
    labelTextWidth,
    messageTextWidth,
    labelX: 10 * (labelMargin + labelTextWidth / 2 + horiz),
    messageX: 10 * (messageMargin + messageTextWidth / 2 + horiz),
    textY: 140,
    fontSize: 110,
    messageBold: false,
    radius: input.style === "flat" ? 3 : 0,
    gradient: input.style === "flat",
  };
}

function layoutForTheBadge(input: {
  label: string;
  message: string;
}): BadgeLayout {
  const label = input.label.toUpperCase();
  const message = input.message.toUpperCase();
  const letter = 1.25;
  const labelTextWidth = label
    ? Math.floor(measureHundredths(label, "verdana10") / 100) +
      letter * charCount(label)
    : 0;
  const messageTextWidth = message
    ? Math.floor(measureHundredths(message, "verdana10Bold") / 100) +
      letter * charCount(message)
    : 0;
  const textMargin = 12;
  const left = label ? textMargin + labelTextWidth + textMargin : 0;
  const messageTextMinX = left + textMargin;
  const right = textMargin * 2 + messageTextWidth;
  return {
    width: left + right,
    height: 28,
    left,
    right,
    label,
    message,
    labelTextWidth,
    messageTextWidth,
    labelX: 10 * (textMargin + labelTextWidth / 2),
    messageX: 10 * (messageTextMinX + messageTextWidth / 2),
    textY: 175,
    fontSize: 100,
    messageBold: true,
    radius: 0,
    gradient: false,
  };
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function px(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  if (Object.is(rounded, -0)) return "0";
  return String(rounded);
}

export function renderBadge(input: {
  label: string;
  message: string;
  color: string;
  style: BadgeStyle;
}): string {
  const layout = layoutBadge(input);
  const labelColor = layout.label ? BADGE_LABEL_COLOR : input.color;
  const accessible = escapeXml(
    layout.label ? `${layout.label}: ${layout.message}` : layout.message,
  );
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px(layout.width)}" height="${layout.height}" role="img" aria-label="${accessible}">`,
    `<title>${accessible}</title>`,
  ];
  if (layout.gradient) {
    parts.push(
      '<linearGradient id="s" x2="0" y2="100%">',
      '<stop offset="0" stop-color="#bbb" stop-opacity=".1"/>',
      '<stop offset="1" stop-opacity=".1"/>',
      "</linearGradient>",
      '<clipPath id="r">',
      `<rect width="${px(layout.width)}" height="${layout.height}" rx="${layout.radius}"/>`,
      "</clipPath>",
      '<g clip-path="url(#r)">',
    );
  } else {
    parts.push('<g shape-rendering="crispEdges">');
  }
  if (layout.left > 0) {
    parts.push(
      `<rect width="${px(layout.left)}" height="${layout.height}" fill="${labelColor}"/>`,
    );
  }
  parts.push(
    `<rect x="${px(layout.left)}" width="${px(layout.right)}" height="${layout.height}" fill="${input.color}"/>`,
  );
  if (layout.gradient) {
    parts.push(
      `<rect width="${px(layout.width)}" height="${layout.height}" fill="url(#s)"/>`,
    );
  }
  parts.push("</g>");
  parts.push(
    `<g fill="#fff" text-anchor="middle" font-family="${FONT_FAMILY}" text-rendering="geometricPrecision" font-size="${layout.fontSize}">`,
  );
  if (layout.label) {
    parts.push(
      `<text x="${px(layout.labelX)}" y="${layout.textY}" textLength="${px(layout.labelTextWidth * 10)}" lengthAdjust="spacingAndGlyphs" transform="scale(.1)">${escapeXml(layout.label)}</text>`,
    );
  }
  const weight = layout.messageBold ? ' font-weight="bold"' : "";
  parts.push(
    `<text x="${px(layout.messageX)}" y="${layout.textY}" textLength="${px(layout.messageTextWidth * 10)}" lengthAdjust="spacingAndGlyphs" transform="scale(.1)"${weight}>${escapeXml(layout.message)}</text>`,
    "</g></svg>",
  );
  return parts.join("");
}

export function etagOf(body: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < body.length; index += 1) {
    hash ^= body.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `"${(hash >>> 0).toString(16)}-${body.length}"`;
}

export function etagMatches(header: string | null, etag: string): boolean {
  if (!header) return false;
  return header.split(",").some((part) => {
    const token = part.trim().replace(/^W\//, "");
    return token === etag;
  });
}
