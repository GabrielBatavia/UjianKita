import { redirect } from "next/navigation";
import { getDefaultPortalPath } from "@/policies/authorization";
import { getCurrentActor } from "@/services/auth-service";

export const dynamic = "force-dynamic";

export default async function DashboardRedirectPage() {
  const actor = await getCurrentActor();
  if (!actor) {
    redirect("/login");
  }
  redirect(getDefaultPortalPath(actor.roles));
}
