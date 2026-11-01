import type { Membership } from "../../api/types";
import { PageTitle } from "../../components/ui";
import { MembersPanel } from "./MembersPanel";

export function StaffPage({ membership }: { membership: Membership }) {
  return (
    <>
      <PageTitle title="Xodimlar" hint="Rollar, huquqlar, xizmatlar va parollar" />
      <MembersPanel businessId={membership.business_id} canManageManagers={membership.role === "owner"} />
    </>
  );
}
