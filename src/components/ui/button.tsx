import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 min-h-[42px] px-4 py-2 cursor-pointer",
  {
    variants: {
      variant: {
        default: "bg-blue-700 text-white hover:bg-blue-800 shadow-xs",
        secondary:
          "bg-slate-100 text-slate-900 hover:bg-slate-200 border border-slate-200",
        outline:
          "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50",
        ghost: "text-slate-700 hover:bg-slate-100 hover:text-slate-900",
        destructive: "bg-red-700 text-white hover:bg-red-800 shadow-xs",
      },
      size: {
        default: "min-h-[42px] px-4 py-2",
        sm: "min-h-[36px] px-3 text-xs",
        lg: "min-h-[48px] px-6 text-base",
        icon: "h-10 w-10 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";
