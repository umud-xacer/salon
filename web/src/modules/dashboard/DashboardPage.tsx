import type { Membership } from "../../api/types";
import { BookingList } from "../../components/BookingList";
import { ROLE_LABELS } from "../../components/format";
import { PageTitle } from "../../components/ui";

export function DashboardPage({ membership }: { membership: Membership }) {
  return (
    <>
      <PageTitle title={membership.business_name} hint={ROLE_LABELS[membership.role]} />
      {membership.permissions.includes("appointments.view_all") && (
        <BookingList businessId={membership.business_id} showMaster />
      )}
    </>
  );
}
