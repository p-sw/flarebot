// SPDX-License-Identifier: AGPL-3.0-only

export const BRAND_API = 1;

export type BrandMotionName = "calm" | "crisp" | "playful" | "none";

export type BrandConfig = {
  brandApi: number;
  name: string;
  logo: { light: string; dark: string };
  defaultLocale: "en" | "ko";
  motion: BrandMotionName;
  links: { home?: string; source: string; docs?: string };
};

export function defineBrand<T extends BrandConfig>(config: T): T {
  return config;
}

export type MotionSprings = {
  soft: { stiffness: number; damping: number };
  snappy: { stiffness: number; damping: number };
};

export type MotionConfig = {
  spring: MotionSprings;
  page: "slide-up" | "fade" | "none";
  stagger: number;
  distance: number;
};

export function defineMotion<T extends MotionConfig>(config: T): T {
  return config;
}
