import { describe, expect, test } from "vitest";
import { defineMotion } from "./brand";

describe("defineMotion", () => {
  test("fills drawer spring and sidebar duration when omitted", () => {
    const motion = defineMotion({
      spring: {
        soft: { stiffness: 10, damping: 8 },
        snappy: { stiffness: 20, damping: 12 },
      },
      page: "fade",
      stagger: 0.02,
      distance: 4,
    });
    expect(motion.spring.drawer.stiffness).toBeGreaterThan(0);
    expect(motion.spring.drawer.damping).toBeGreaterThan(0);
    expect(motion.sidebarMs).toBe(180);
    expect(motion.spring.soft.stiffness).toBe(10);
  });

  test("keeps an explicit drawer spring and sidebar duration", () => {
    const motion = defineMotion({
      spring: {
        soft: { stiffness: 10, damping: 8 },
        snappy: { stiffness: 20, damping: 12 },
        drawer: { stiffness: 100, damping: 20 },
      },
      page: "none",
      stagger: 0,
      distance: 0,
      sidebarMs: 0,
    });
    expect(motion.spring.drawer).toEqual({ stiffness: 100, damping: 20 });
    expect(motion.sidebarMs).toBe(0);
  });
});
