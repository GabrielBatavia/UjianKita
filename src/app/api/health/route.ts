import { NextResponse } from "next/server";
import { getSystemHealthReport } from "@/services/health-service";

export const dynamic = "force-dynamic";

export async function GET() {
  const report = await getSystemHealthReport();
  const statusCode = report.supabase.configured && !report.supabase.reachable ? 503 : 200;
  return NextResponse.json(report, { status: statusCode });
}
