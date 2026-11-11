import { Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function UpcomingModuleCard({
  title,
  phaseLabel = "Dijadwalkan pada Fase 2",
  description,
  plannedCapabilities,
}: {
  title: string;
  phaseLabel?: string;
  description: string;
  plannedCapabilities: string[];
}) {
  return (
    <Card className="border-slate-200 bg-white">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{title}</CardTitle>
          <Badge variant="warning">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{phaseLabel}</span>
          </Badge>
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2 text-sm text-slate-700">
          {plannedCapabilities.map((item) => (
            <li key={item} className="flex items-start gap-2">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-600" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
