import * as React from "react";
import { renderSafeQuestionHtml } from "@/lib/question-content";
import { cn } from "@/lib/utils";

/**
 * Safely renders formatted question stems, options, and explanations with KaTeX math.
 * HTML input is escaped before math/markdown formatting so untrusted markup never executes.
 */
export function QuestionContentRenderer({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  const safeHtml = React.useMemo(() => renderSafeQuestionHtml(content), [content]);

  return (
    <div
      className={cn(
        "prose-sm max-w-none break-words text-slate-800 leading-relaxed",
        "[&_.katex-display]:my-2 [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden [&_.katex-display]:py-1",
        "[&_.katex]:max-w-full [&_.katex]:overflow-x-auto [&_.katex]:overflow-y-hidden [&_.katex]:inline-block [&_.katex]:align-middle",
        className
      )}
      dangerouslySetInnerHTML={{ __html: safeHtml }}
    />
  );
}
