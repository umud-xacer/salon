// Ishlash formati (062_solo_mode.sql): yakka — direktor o'zi yagona usta/shifokor (mijoz mutaxassis tanlamaydi,
// barcha bronlar, mijozlar va kassa unga); jamoa — xodimlar bilan. Xodim qo'shilsa jamoaga o'zi o'tadi,
// oxirgi xodim olib tashlansa — yana yakka.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { User, Users } from "lucide-react";

import { api, json } from "../../api/client";
import { Card, ErrorNote } from "../../components/ui";
import { useVocab } from "../vocab";

import { t } from "../../i18n";

export function WorkModeCard({ businessId, solo }: { businessId: number; solo: boolean }) {
  const v = useVocab();
  const queryClient = useQueryClient();
  const change = useMutation({
    mutationFn: (value: boolean) => api(`/businesses/${businessId}/work-mode`, json("PUT", { solo: value })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["biz-profile", businessId] });
      await queryClient.invalidateQueries({ queryKey: ["calendar", businessId] });
      await queryClient.invalidateQueries({ queryKey: ["members", businessId] });
    },
  });
  const options = [
    { value: true, icon: User, title: t("O'zim yakka ishlayman"),
      hint: t("Siz yagona {a}siz: mijoz mutaxassis tanlamaydi, barcha bronlar va mijozlar sizga yoziladi.", { a: v.staffOne.toLowerCase() }) },
    { value: false, icon: Users, title: t("Jamoam bilan ishlayman"),
      hint: t("Mijoz {a}ni tanlab yoziladi. Xodim qo'shsangiz bu rejim o'zi yoqiladi.", { a: v.staffOne.toLowerCase() }) },
  ];
  return (
    <Card>
      <h2 className="text-sm font-medium">{t("Ishlash formati")}</h2>
      <p className="mb-3 text-xs text-muted">
        {t("{a} bo'limi doim ochiq: yangi xodim qo'shsangiz, ilova va saytda mutaxassis tanlash o'zi yoqiladi.", { a: v.staffMany })}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((o) => (
          <button key={String(o.value)} type="button" disabled={change.isPending || solo === o.value}
            onClick={() => change.mutate(o.value)}
            className={`flex items-start gap-3 rounded-lg border p-3 text-left ${solo === o.value ? "border-primary bg-primary/5" : "border-line hover:bg-page"}`}>
            <o.icon size={18} className={solo === o.value ? "text-primary" : "text-muted"} aria-hidden />
            <span>
              <span className="block text-sm font-medium">{o.title}{solo === o.value && ` · ${t("hozir")}`}</span>
              <span className="block text-xs text-muted">{o.hint}</span>
            </span>
          </button>
        ))}
      </div>
      {change.error && <div className="mt-2"><ErrorNote error={change.error} /></div>}
    </Card>
  );
}
