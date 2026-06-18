"use client";

import { ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ActionTooltipProps {
  label: string;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  disabled?: boolean;
}

export function ActionTooltip({
  label,
  children,
  side = "bottom",
  disabled = false,
}: ActionTooltipProps) {
  if (disabled) return <>{children}</>;

  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={side}>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
