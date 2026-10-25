// SPDX-License-Identifier: MIT

export const BRAND_API = 1;

export type BrandMotionName = "calm" | "crisp" | "playful" | "none";

export type BrandConfig = {
  brandApi: number;
  name: string;
  logo: { light: string; dark: string };
  motion: BrandMotionName;
  links: { home?: string; source?: string; docs?: string };
};

export function defineBrand<T extends BrandConfig>(config: T): T {
  return config;
}

export type MotionSpring = { stiffness: number; damping: number };

export type MotionSprings = {
  soft: MotionSpring;
  snappy: MotionSpring;
  drawer?: MotionSpring;
};

export type MotionConfig = {
  spring: MotionSprings;
  page: "slide-up" | "fade" | "none";
  stagger: number;
  distance: number;
  /** Desktop sidebar width transition, in milliseconds. */
  sidebarMs?: number;
};

export type ResolvedMotion = {
  spring: {
    soft: MotionSpring;
    snappy: MotionSpring;
    drawer: MotionSpring;
  };
  page: MotionConfig["page"];
  stagger: number;
  distance: number;
  sidebarMs: number;
};

const drawerFallback: MotionSpring = { stiffness: 420, damping: 40 };

export function defineMotion(config: MotionConfig): ResolvedMotion {
  return {
    page: config.page,
    stagger: config.stagger,
    distance: config.distance,
    sidebarMs: config.sidebarMs ?? 180,
    spring: {
      soft: config.spring.soft,
      snappy: config.spring.snappy,
      drawer: config.spring.drawer ?? drawerFallback,
    },
  };
}
