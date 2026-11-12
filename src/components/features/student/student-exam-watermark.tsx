"use client";

import * as React from "react";

export function StudentExamWatermark({
  enabled,
  opacity = 0.08,
  studentName,
  attemptId,
}: {
  enabled: boolean;
  opacity?: number;
  studentName: string;
  attemptId: string;
}) {
  const [stampTime, setStampTime] = React.useState<string>("");

  React.useEffect(() => {
    if (!enabled) return;
    const formatStamp = () => {
      const d = new Date();
      return d.toLocaleTimeString("id-ID", {
        hour: "2-digit",
        minute: "2-digit",
      });
    };
    const timer = window.setInterval(() => {
      setStampTime(formatStamp());
    }, 60_000);
    // Schedule initial stamp asynchronously so React 19 set-state-in-effect rule stays satisfied
    const initTimer = window.setTimeout(() => {
      setStampTime(formatStamp());
    }, 0);

    return () => {
      window.clearInterval(timer);
      window.clearTimeout(initTimer);
    };
  }, [enabled]);

  if (!enabled) return null;

  const clampedOpacity = Math.min(0.18, Math.max(0.03, opacity));
  const shortAttempt = attemptId.slice(0, 8).toUpperCase();
  const label = `${studentName || "Peserta Ujian"} • ${shortAttempt}${stampTime ? ` • ${stampTime}` : ""}`;

  return (
    <div
      aria-hidden="true"
      data-testid="student-exam-watermark"
      style={{ opacity: clampedOpacity }}
      className="pointer-events-none fixed inset-0 z-20 select-none overflow-hidden"
    >
      <div className="grid h-full w-full grid-cols-2 gap-16 p-8 sm:grid-cols-3">
        {Array.from({ length: 9 }).map((_, idx) => (
          <div
            key={idx}
            className="flex items-center justify-center -rotate-24 text-center font-mono text-xs font-semibold tracking-wider text-slate-900 sm:text-sm"
          >
            <span>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
