// SPDX-License-Identifier: MIT

import { defineMotion } from "../shared/brand";

const motion = defineMotion({
  spring: {
    soft: { stiffness: 180, damping: 22 },
    snappy: { stiffness: 420, damping: 30 },
  },
  page: "slide-up",
  stagger: 0.04,
  distance: 8,
});

export default motion;
