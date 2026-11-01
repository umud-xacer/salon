// Super Admin: obuna va modullar. Salonni to'xtatish ma'lumotni o'chirmaydi, shuning uchun bu amal qaytariladi.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { api, json } from "../../api/client";
import type { BusinessAdmin, ModuleInfo } from "../../api/types";
import { formatDate } from "../../components/format";
import { Badge, Button, Card, Empty, ErrorNote, PageTitle, Spinner } from "../../components/ui";

const KEY = ["superadmin", "businesses"];

function StatusBadge({ b }: { b: BusinessAdmin }) {
  if (b.status === "blocked") return <Badge tone="red">Bloklangan</Badge>;
  if (!b.operational) return <Badge tone="amber">To'xtatilgan</Badge>;
  return <Badge tone="green">Faol</Badge>;
}

function BusinessCard({ business: b, modules }: { business: BusinessAdmin; modules: ModuleInfo[] }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: KEY });
  const base = `/superadmin/businesses/${b.id}`;

  const renew = useMutation({
    mutationFn: (days: number) => api(`${base}/subscription/renew`, json("POST", { days })),
    onSettled: refresh,
  });
  const setActive = useMutation({
    mutationFn: (is_active: boolean) => api(`${base}/subscription`, json("PATCH", { is_active })),
    onSettled: () => {
      setConfirming(false);
      return refresh();
    },
  });
  const toggle = useMutation({
    mutationFn: ({ code, enabled }: { code: string; enabled: boolean }) =>
      api(`${base}/modules/${code}`, json("PUT", { enabled })),
    onSettled: refresh,
  });
  const error = renew.error ?? setActive.error ?? toggle.error;
  const busy = renew.isPending || setActive.isPending;

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">
            {b.name} <StatusBadge b={b} />
          </h2>
          <p className="mt-1 text-sm text-muted">
            {b.owner_name ?? "Egasi yo'q"}
            {b.owner_phone ? ` · ${b.owner_phone}` : ""} · {b.staff_count} xodim
          </p>
          <p className="mt-1 text-sm">
            Obuna: {b.subscription_ends_at ? `${formatDate(b.subscription_ends_at)} gacha` : "muddatsiz"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => renew.mutate(30)}>
            +30 kun
          </Button>
          {b.is_active ? (
            confirming ? (
              <>
                <Button variant="danger" disabled={busy} onClick={() => setActive.mutate(false)}>
                  Ha, to'xtatish
                </Button>
                <Button variant="secondary" onClick={() => setConfirming(false)}>
                  Yo'q
                </Button>
              </>
            ) : (
              <Button variant="danger" onClick={() => setConfirming(true)}>
                To'xtatish
              </Button>
            )
          ) : (
            <Button variant="secondary" disabled={busy} onClick={() => setActive.mutate(true)}>
              Yoqish
            </Button>
          )}
        </div>
      </div>

      <fieldset className="mt-4 border-t border-line pt-3">
        <legend className="sr-only">Modullar</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {modules.map((m) => (
            <label key={m.code} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={b.modules.includes(m.code)}
                disabled={toggle.isPending}
                onChange={(e) => toggle.mutate({ code: m.code, enabled: e.target.checked })}
                className="size-4 accent-primary"
              />
              {m.name}
            </label>
          ))}
        </div>
      </fieldset>
      {error && (
        <div className="mt-3">
          <ErrorNote error={error} />
        </div>
      )}
    </Card>
  );
}

export function BusinessesPage() {
  const businesses = useQuery({ queryKey: KEY, queryFn: () => api<BusinessAdmin[]>("/superadmin/businesses") });
  const modules = useQuery({
    queryKey: ["superadmin", "modules"],
    queryFn: () => api<ModuleInfo[]>("/superadmin/modules"),
  });

  return (
    <>
      <PageTitle title="Bizneslar" hint="To'xtatilgan salon ma'lumotlari saqlanadi, uzaytirilsa shu joyidan davom etadi" />
      {(businesses.isPending || modules.isPending) && <Spinner />}
      {(businesses.error || modules.error) && <ErrorNote error={businesses.error ?? modules.error} />}
      {businesses.data?.length === 0 && <Empty>Hali biznes yo'q</Empty>}
      <div className="space-y-3">
        {modules.data &&
          businesses.data?.map((b) => <BusinessCard key={b.id} business={b} modules={modules.data} />)}
      </div>
    </>
  );
}
