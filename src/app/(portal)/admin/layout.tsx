import { redirect } from "next/navigation";
import { AccessDenied } from "@/components/layout/access-denied";
import { PortalShell } from "@/components/layout/portal-shell";
import { hasRole } from "@/policies/authorization";
import { getCurrentActor } from "@/services/auth-service";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const actor = await getCurrentActor();
  if (!actor) {
    redirect("/login");
  }
  if (!hasRole(actor.roles, "admin")) {
    return <AccessDenied requiredRole="admin" currentRole={actor.primaryRole} />;
  }
  return <PortalShell actor={actor}>{children}</PortalShell>;
}
