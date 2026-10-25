// SPDX-License-Identifier: MIT

import presetsSource from "@brand/motion";
import type { MotionConfig as BrandMotion } from "@shared/brand";
import { MotionConfig, motion } from "motion/react";
import type { ReactNode } from "react";

const presets: BrandMotion = presetsSource;

const spring = (kind: "soft" | "snappy") => ({
  type: "spring" as const,
  stiffness: presets.spring[kind].stiffness,
  damping: presets.spring[kind].damping,
});

export function MotionRoot({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

export function PageEnter({ children }: { children: ReactNode }) {
  const distance = presets.page === "none" ? 0 : presets.distance;
  const initial =
    presets.page === "fade"
      ? { opacity: 0 }
      : presets.page === "none"
        ? false
        : { opacity: 0, y: distance };
  return (
    <motion.div
      initial={initial}
      animate={{ opacity: 1, y: 0 }}
      transition={spring("soft")}
    >
      {children}
    </motion.div>
  );
}

export function Stagger({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="show"
      variants={{ show: { transition: { staggerChildren: presets.stagger } } }}
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
  return (
    <motion.div
      className={className}
      variants={{
        hidden: {
          opacity: 0,
          y: presets.page === "none" ? 0 : presets.distance,
        },
        show: { opacity: 1, y: 0, transition: spring("snappy") },
      }}
    >
      {children}
    </motion.div>
  );
}
