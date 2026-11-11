import * as React from "react";
import { AlertCircle, CheckCircle2, Info, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

type AlertVariant = "info" | "success" | "warning" | "danger";

const variantStyles: Record<AlertVariant, string> = {
  info: "border-blue-200 bg-blue-50 text-blue-950",
  success: "border-emerald-200 bg-emerald-50 text-emerald-950",
  warning: "border-amber-200 bg-amber-50 text-amber-950",
  danger: "border-red-200 bg-red-50 text-red-950",
};

const variantIcons: Record<AlertVariant, React.ComponentType<{ className?: string }>> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: AlertCircle,
};

export function Alert({
  variant = "info",
  title,
  children,
  className,
}: {
  variant?: AlertVariant;
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const Icon = variantIcons[variant];

  return (
    <div
      role={variant === "danger" ? "alert" : "status"}
      className={cn("flex gap-3 rounded-xl border p-4 text-sm", variantStyles[variant], className)}
    >
      <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <div className="space-y-1">
        {title ? <p className="font-semibold leading-snug">{title}</p> : null}
        <div className="text-sm leading-relaxed opacity-90">{children}</div>
      </div>
    </div>
  );
}
