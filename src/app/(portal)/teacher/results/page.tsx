import { redirect } from "next/navigation";
import { requireRoleActor } from "@/services/auth-service";

export const dynamic = "force-dynamic";

export default async function TeacherResultsRedirectPage() {
  await requireRoleActor("teacher");
  redirect("/teacher/grading");
}
