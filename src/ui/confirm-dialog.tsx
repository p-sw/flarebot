// SPDX-License-Identifier: MIT

import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "motion/react";
import { useMotionPrefs } from "../motion/page";
import { Button } from "./button";

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  pending = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  pending?: boolean;
  onConfirm: () => void;
}) {
  const motionPrefs = useMotionPrefs();
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <AnimatePresence>
        {open ? (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-50 bg-black/40"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={motionPrefs.snappy}
              />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount aria-describedby={undefined}>
              <motion.div
                role="dialog"
                className="fixed top-1/2 left-1/2 z-50 w-[min(100%-2rem,28rem)] rounded-lg border border-border bg-card p-6 text-card-foreground shadow-lg outline-none"
                initial={
                  motionPrefs.still
                    ? { opacity: 0, x: "-50%", y: "-50%" }
                    : { opacity: 0, x: "-50%", y: "calc(-50% + 8px)" }
                }
                animate={{ opacity: 1, x: "-50%", y: "-50%" }}
                exit={{ opacity: 0, x: "-50%", y: "-50%" }}
                transition={motionPrefs.snappy}
              >
                <Dialog.Title className="text-lg font-medium">
                  {title}
                </Dialog.Title>
                <Dialog.Description className="mt-2 text-sm text-muted-foreground">
                  {description}
                </Dialog.Description>
                <div className="mt-6 flex justify-end gap-2">
                  <Dialog.Close asChild>
                    <Button type="button" variant="outline" disabled={pending}>
                      {cancelLabel}
                    </Button>
                  </Dialog.Close>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={pending}
                    onClick={onConfirm}
                  >
                    {confirmLabel}
                  </Button>
                </div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        ) : null}
      </AnimatePresence>
    </Dialog.Root>
  );
}
