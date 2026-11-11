import { NextResponse, type NextRequest } from "next/server";
import {
  generateCsvImportTemplate,
  generateXlsxImportTemplate,
} from "@/domain/exams/import-parser";
import { handleApiError } from "@/lib/api-helpers";
import { requireAnyRoleActor } from "@/services/auth-service";

export async function GET(request: NextRequest) {
  try {
    await requireAnyRoleActor(["teacher", "admin"]);
    const format = request.nextUrl.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";

    if (format === "xlsx") {
      const buffer = await generateXlsxImportTemplate();
      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": 'attachment; filename="template-impor-soal-ujiankita.xlsx"',
        },
      });
    }

    const csv = generateCsvImportTemplate();
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="template-impor-soal-ujiankita.csv"',
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
