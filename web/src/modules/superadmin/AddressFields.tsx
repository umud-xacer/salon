// Salon manzili: ro'yxatdan tanlash, xaritada bosish va qo'lda yozish birga ishlaydi.
// Xarita viloyat va tumanni to'ldiradi. Qo'lda yozilgan manzil jimgina almashmaydi: taklif sifatida ko'rsatiladi.
import { useQuery } from "@tanstack/react-query";
import { LocateFixed } from "lucide-react";
import { useRef, useState } from "react";

import { api, ApiError } from "../../api/client";
import type { Region, ReverseAddress } from "../../api/types";
import { Button, inputClass } from "../../components/ui";
import { LocationPicker } from "./Maps";

const OTHER = "__other";

export interface AddressValue {
  region: string;
  city: string;
  address: string;
  lat: number | null;
  lng: number | null;
}

export function AddressFields({ value, onChange }: {
  value: AddressValue;
  onChange: (next: AddressValue) => void;
}) {
  const regions = useQuery({
    queryKey: ["geo-regions"],
    queryFn: () => api<Region[]>("/geo/regions"),
    staleTime: Infinity,
  });
  const districts = regions.data?.find((r) => r.name === value.region)?.districts ?? [];
  const known = districts.includes(value.city);
  const [manualCity, setManualCity] = useState(!known && value.city !== "");
  const [touched, setTouched] = useState(value.address !== "");
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [locating, setLocating] = useState(false);
  const latest = useRef(value);
  latest.current = value;
  const request = useRef(0);

  const lookup = async (lat: number, lng: number) => {
    const id = ++request.current;
    onChange({ ...latest.current, lat, lng });
    setStatus("Manzil aniqlanmoqda...");
    setSuggestion(null);
    try {
      const found = await api<ReverseAddress>(`/geo/address?lat=${lat}&lng=${lng}`);
      if (id !== request.current) return;           // shu orada boshqa joy bosildi
      const next = { ...latest.current };
      if (found.region) next.region = found.region;
      if (found.district) {
        next.city = found.district;
        setManualCity(false);
      }
      if (found.address) {
        if (touched && next.address.trim() && next.address.trim() !== found.address) setSuggestion(found.address);
        else next.address = found.address;
      }
      onChange(next);
      setStatus(found.region ? "" : "Viloyat aniqlanmadi, ro'yxatdan tanlang");
    } catch (e) {
      if (id !== request.current) return;
      const down = e instanceof ApiError && e.status === 503;
      setStatus(down ? "Manzil xizmati javob bermadi, qo'lda to'ldiring" : "Bu nuqta uchun manzil topilmadi, qo'lda to'ldiring");
    }
  };

  const locate = () => {
    if (!navigator.geolocation) {
      setStatus("Brauzer joylashuvni qo'llab-quvvatlamaydi");
      return;
    }
    setLocating(true);
    setStatus("Joylashuvingiz aniqlanmoqda...");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        void lookup(pos.coords.latitude, pos.coords.longitude);
      },
      () => {
        setLocating(false);
        setStatus("Joylashuvga ruxsat berilmadi. Xaritada bosing yoki qo'lda yozing");
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const pickRegion = (region: string) => {
    onChange({ ...value, region, city: "" });
    setManualCity(false);
  };
  const pickDistrict = (choice: string) => {
    setManualCity(choice === OTHER);
    onChange({ ...value, city: choice === OTHER ? "" : choice });
  };

  return (
    <fieldset className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">Viloyat
          <select className={inputClass} value={value.region} onChange={(e) => pickRegion(e.target.value)}>
            <option value="">Tanlang</option>
            {regions.data?.map((r) => <option key={r.name} value={r.name}>{r.name}</option>)}
          </select>
        </label>
        <label className="block text-sm">Tuman yoki shahar
          <select className={inputClass} disabled={!value.region}
            value={manualCity ? OTHER : known ? value.city : ""} onChange={(e) => pickDistrict(e.target.value)}>
            <option value="">{value.region ? "Tanlang" : "Avval viloyatni tanlang"}</option>
            {districts.map((d) => <option key={d} value={d}>{d}</option>)}
            <option value={OTHER}>Ro'yxatda yo'q</option>
          </select>
        </label>
      </div>
      {manualCity || (value.city !== "" && !known) ? (
        <label className="block text-sm">Tuman yoki shahar nomi
          <input className={inputClass} maxLength={80} value={value.city}
            onChange={(e) => onChange({ ...value, city: e.target.value })} />
        </label>
      ) : null}
      <label className="block text-sm">Manzil (ko'cha, uy)
        <input className={inputClass} maxLength={300} placeholder="Qo'lda yozing yoki xaritadan tanlang"
          value={value.address}
          onChange={(e) => {
            setTouched(e.target.value.trim() !== "");
            setSuggestion(null);
            onChange({ ...value, address: e.target.value });
          }} />
      </label>
      {suggestion && (
        <p className="flex flex-wrap items-center gap-2 rounded-lg bg-page px-3 py-2 text-sm">
          <span className="min-w-0 flex-1 break-words">Xaritadan: {suggestion}</span>
          <Button type="button" variant="secondary" className="!px-2 !py-1 text-xs"
            onClick={() => {
              onChange({ ...value, address: suggestion });
              setSuggestion(null);
              setTouched(false);
            }}>
            Shuni qo'yish
          </Button>
        </p>
      )}
      <div className="text-sm">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <span>Lokatsiya</span>
          <Button type="button" variant="secondary" disabled={locating} className="flex items-center gap-1 !px-2 !py-1 text-xs"
            onClick={locate}>
            <LocateFixed size={14} aria-hidden /> Mening joyim
          </Button>
        </div>
        <LocationPicker lat={value.lat} lng={value.lng} onChange={(lat, lng) => void lookup(lat, lng)} />
        {status && <p role="status" className="mt-1 text-xs text-muted">{status}</p>}
      </div>
    </fieldset>
  );
}
