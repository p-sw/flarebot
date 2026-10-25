// SPDX-License-Identifier: MIT

import presetsSource from "@brand/motion";
import type { ResolvedMotion } from "@shared/brand";
import { MotionConfig, motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

const presets: ResolvedMotion = presetsSource;

type Spring = {
  type: "spring";
  stiffness: number;
  damping: number;
};

function springOf(value: { stiffness: number; damping: number }): Spring {
  return {
    type: "spring",
    stiffness: value.stiffness,
    damping: value.damping,
  };
}

export function useMotionPrefs() {
  const reduce = useReducedMotion() === true;
  const still = reduce || presets.page === "none";
  return {
    reduce,
    still,
    distance: still ? 0 : presets.distance,
    sidebarMs: still ? 0 : presets.sidebarMs,
    soft: springOf(presets.spring.soft),
    snappy: springOf(presets.spring.snappy),
    drawer: springOf(presets.spring.drawer),
    page: presets.page,
    stagger: still ? 0 : presets.stagger,
  };
}

export function MotionRoot({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

export function Stagger({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const motionPrefs = useMotionPrefs();
  if (motionPrefs.still) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="show"
      variants={{
        show: { transition: { staggerChildren: motionPrefs.stagger } },
      }}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const motionPrefs = useMotionPrefs();
  if (motionPrefs.still) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      variants={{
        hidden: { opacity: 0, y: motionPrefs.distance },
        show: {
          opacity: 1,
          y: 0,
          transition: motionPrefs.snappy,
        },
      }}
    >
      {children}
    </motion.div>
  );
}
