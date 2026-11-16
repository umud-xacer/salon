import { MapPin } from "lucide-react";
import { Link } from "react-router-dom";

import type { BusinessCard } from "../api";
import { distanceText, money } from "../util";
import { Img, RatingLine } from "./ui";

/** Fresha kartasi: katta rasm, nom, reyting, manzil, yo'nalish */
export function SalonCard({ b, wide, onHover }: { b: BusinessCard; wide?: boolean; onHover?: (id: number | null) => void }) {
  return (
    <Link to={`/s/${b.slug}`} onMouseEnter={() => onHover?.(b.id)} onMouseLeave={() => onHover?.(null)}
      className={`group block shrink-0 snap-start ${wide ? "w-full" : "w-[78vw] sm:w-[300px]"}`}>
      <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-soft">
        <Img src={b.photos?.[0]} alt={b.name} className="transition duration-500 group-hover:scale-[1.04]" />
        {b.is_open_now && (
          <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-white/95 px-2.5 py-1 text-xs font-bold text-ok"><i className="h-1.5 w-1.5 rounded-full bg-ok" />Hozir ochiq</span>
        )}
      </div>
      <div className="mt-3 space-y-1">
        <h3 className="truncate text-[16px] font-bold">{b.name}{b.branch_name ? <span className="font-medium text-muted"> · {b.branch_name}</span> : null}</h3>
        <RatingLine avg={b.rating_avg} count={b.rating_count} />
        <p className="flex items-center gap-1 truncate text-sm text-muted">
          <MapPin size={14} className="shrink-0" />
          <span className="truncate">{[distanceText(b.distance_m), b.address].filter(Boolean).join(" · ")}</span>
        </p>
        <p className="truncate text-sm text-muted">
          {b.category_name}{b.min_price ? ` · ${money(b.min_price)} dan` : ""}
        </p>
      </div>
    </Link>
  );
}
