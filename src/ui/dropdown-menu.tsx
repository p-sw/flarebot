// SPDX-License-Identifier: MIT

import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

export function DropdownMenuContent({
  children,
  side = "top",
  align = "start",
  portalled = true,
}: {
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  portalled?: boolean;
}) {
  const content = (
    <DropdownMenuPrimitive.Content
      side={side}
      align={align}
      sideOffset={8}
      className="z-[70] min-w-52 rounded-lg border border-border bg-card p-1 text-card-foreground shadow-lg outline-none"
    >
      {children}
    </DropdownMenuPrimitive.Content>
  );
  if (!portalled) return content;
  return <DropdownMenuPrimitive.Portal>{content}</DropdownMenuPrimitive.Portal>;
}

export function DropdownMenuItem({
  children,
  onSelect,
  asChild = false,
  className,
  disabled = false,
}: {
  children: ReactNode;
  onSelect?: (event: Event) => void;
  asChild?: boolean;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <DropdownMenuPrimitive.Item
      asChild={asChild}
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        "flex cursor-pointer items-center rounded-md px-2 py-2 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-muted",
        className,
      )}
    >
      {children}
    </DropdownMenuPrimitive.Item>
  );
}

export function DropdownMenuRadioItem({
  children,
  value,
  disabled = false,
}: {
  children: ReactNode;
  value: string;
  disabled?: boolean;
}) {
  return (
    <DropdownMenuPrimitive.RadioItem
      value={value}
      disabled={disabled}
      className="flex cursor-pointer items-center rounded-md px-2 py-2 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-muted data-[state=checked]:font-medium"
    >
      {children}
    </DropdownMenuPrimitive.RadioItem>
  );
}

export function DropdownMenuLabel({ children }: { children: ReactNode }) {
  return (
    <DropdownMenuPrimitive.Label className="px-2 py-1.5 text-xs text-muted-foreground">
      {children}
    </DropdownMenuPrimitive.Label>
  );
}

export function DropdownMenuSeparator() {
  return <DropdownMenuPrimitive.Separator className="my-1 h-px bg-border" />;
}
