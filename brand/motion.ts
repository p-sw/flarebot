// SPDX-License-Identifier: MIT

import { defineMotion } from "../shared/brand";

const motion = defineMotion({
  spring: {
    soft: { stiffness: 180, damping: 22 },
    snappy: { stiffness: 420, damping: 30 },
    drawer: { stiffness: 420, damping: 40 },
  },
  page: "slide-up",
  stagger: 0.04,
  distance: 8,
  sidebarMs: 180,
});

export default motion;
