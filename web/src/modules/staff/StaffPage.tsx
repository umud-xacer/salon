import type { Membership } from "../../api/types";
import { PageTitle } from "../../components/ui";
import { vocabFor } from "../vocab";
import { MembersPanel } from "./MembersPanel";

import { t } from "../../i18n";
export function StaffPage({ membership }: { membership: Membership }) {
  return (
    <>
      <PageTitle title={vocabFor(membership.business_kind).staff} hint={t("Rollar, huquqlar, xizmatlar va parollar")} />
      <MembersPanel businessId={membership.business_id} canManageManagers={membership.role === "owner"} />
    </>
  );
}
