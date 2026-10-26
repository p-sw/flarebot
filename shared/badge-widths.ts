// SPDX-License-Identifier: MIT
// Glyph widths in hundredths of a pixel for Verdana, code points U+0020 through U+007E.
// Measured tables from anafanafo (MIT): verdana-11px-normal, verdana-10px-normal, verdana-10px-bold.
// https://github.com/metabolize/anafanafo
// A code point outside this range uses the widest glyph in its table so the badge box stays wide enough.

const VERDANA_11 = [
  387, 433, 505, 900, 699, 1184, 799, 295, 500, 500, 699, 900, 400, 500, 400,
  500, 699, 699, 699, 699, 699, 699, 699, 699, 699, 699, 500, 500, 900, 900,
  900, 600, 1100, 752, 754, 768, 848, 696, 632, 853, 827, 463, 500, 762, 612,
  927, 823, 866, 663, 866, 765, 752, 678, 805, 752, 1088, 754, 677, 754, 500,
  500, 500, 900, 699, 699, 661, 685, 573, 685, 655, 387, 685, 696, 302, 379,
  651, 302, 1070, 696, 668, 685, 685, 469, 573, 433, 696, 651, 900, 651, 651,
  578, 698, 500, 698, 900,
] as const;

const VERDANA_10 = [
  352, 394, 459, 818, 636, 1076, 727, 269, 454, 454, 636, 818, 364, 454, 364,
  454, 636, 636, 636, 636, 636, 636, 636, 636, 636, 636, 454, 454, 818, 818,
  818, 545, 1000, 684, 686, 698, 771, 632, 575, 775, 751, 421, 455, 693, 557,
  843, 748, 787, 603, 787, 695, 684, 616, 732, 684, 989, 685, 615, 685, 454,
  454, 454, 818, 636, 636, 601, 623, 521, 623, 596, 352, 623, 633, 274, 344,
  592, 274, 973, 633, 607, 623, 623, 427, 521, 394, 633, 592, 818, 592, 592,
  525, 635, 454, 635, 818,
] as const;

const VERDANA_10_BOLD = [
  342, 402, 587, 867, 711, 1272, 862, 332, 543, 543, 711, 867, 361, 480, 361,
  689, 711, 711, 711, 711, 711, 711, 711, 711, 711, 711, 402, 402, 867, 867,
  867, 617, 964, 776, 762, 724, 830, 683, 650, 811, 837, 546, 555, 771, 637,
  948, 847, 850, 733, 850, 782, 710, 682, 812, 764, 1128, 764, 737, 692, 543,
  689, 543, 867, 711, 711, 668, 699, 588, 699, 664, 422, 699, 712, 342, 403,
  671, 342, 1058, 712, 687, 699, 699, 497, 593, 456, 712, 650, 979, 669, 651,
  597, 711, 543, 711, 867,
] as const;

export const BADGE_WIDTHS = {
  verdana11: VERDANA_11,
  verdana10: VERDANA_10,
  verdana10Bold: VERDANA_10_BOLD,
} as const;

export type BadgeFont = keyof typeof BADGE_WIDTHS;

const widest = {
  verdana11: Math.max(...VERDANA_11),
  verdana10: Math.max(...VERDANA_10),
  verdana10Bold: Math.max(...VERDANA_10_BOLD),
} as const;

export function measureHundredths(text: string, font: BadgeFont): number {
  const table = BADGE_WIDTHS[font];
  const fallback = widest[font];
  let sum = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    sum += code >= 32 && code <= 126 ? table[code - 32] : fallback;
  }
  return sum;
}
