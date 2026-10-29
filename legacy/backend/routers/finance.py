from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from database import get_db
from auth import get_salon_id, require_admin, get_current_user, check_same_salon
from datetime import date, timedelta
import models, schemas

# Moliya faqat salon egasi (admin) va superadmin uchun
router = APIRouter(prefix="/api/finance", tags=["finance"], dependencies=[Depends(require_admin)])


def _by_salon(q, model, salon_id):
    return q.filter(model.salon_id == salon_id) if salon_id else q


# ─────────────────────────────────────────────
#  CRUD
# ─────────────────────────────────────────────
@router.get("/", response_model=list[schemas.FinanceOut])
def get_all(salon_id=Depends(get_salon_id), db: Session = Depends(get_db)):
    q = db.query(models.Finance)
    if salon_id:
        q = q.filter(models.Finance.salon_id == salon_id)
    return q.order_by(models.Finance.id.desc()).all()


@router.post("/", response_model=schemas.FinanceOut)
def create(item: schemas.FinanceCreate, user=Depends(get_current_user), db: Session = Depends(get_db)):
    data = item.model_dump()
    if not data.get("fin_date"):
        data["fin_date"] = str(date.today())
    data["salon_id"] = user.get("salon_id") or 1
    obj = models.Finance(**data)
    db.add(obj); db.commit(); db.refresh(obj)
    return obj


@router.delete("/{id}")
def delete(id: int, user=Depends(get_current_user), db: Session = Depends(get_db)):
    obj = db.query(models.Finance).filter(models.Finance.id == id).first()
    if not obj:
        raise HTTPException(404, "Topilmadi")
    check_same_salon(user, obj.salon_id)
    db.delete(obj); db.commit()
    return {"ok": True}


# ─────────────────────────────────────────────
#  USTA EARNINGS — Ustaning shaxsiy daromad hisoboti
# ─────────────────────────────────────────────
@router.get("/usta-earnings")
def usta_earnings(staff_id: int, user=Depends(get_current_user), db: Session = Depends(get_db)):
    """
    Ustaning daromad tarixi, bugungi va oylik ulushi.
    To'liq shaffoflik: har bir xizmatdan qancha foiz tushgani ko'rsatiladi.
    """
    staff = db.query(models.Staff).filter(models.Staff.id == staff_id).first()
    if not staff:
        raise HTTPException(404, "Usta topilmadi")
    check_same_salon(user, staff.salon_id)

    today = str(date.today())
    month = today[:7]  # YYYY-MM
    pct = staff.percent or 30
    first_name = staff.name.split()[0]

    # Finance yozuvlarini usta nomi bo'yicha filterlash
    all_records = (
        db.query(models.Finance)
        .filter(
            models.Finance.salon_id == staff.salon_id,
            models.Finance.type == "income",
            models.Finance.note.ilike(f"%[{first_name}]%"),
        )
        .order_by(models.Finance.id.desc())
        .all()
    )

    today_records = [f for f in all_records if f.fin_date == today]
    month_records = [f for f in all_records if f.fin_date and f.fin_date.startswith(month)]

    def make_record(f):
        return {
            "id": f.id,
            "date": f.fin_date,
            "note": (f.note or "").replace(f"[{first_name}]", "").replace(f"({pct}%)", "").strip(" —"),
            "service_amount": f.amount,
            "usta_share": round(f.amount * pct / 100),
        }

    today_total = sum(f.amount for f in today_records)
    month_total = sum(f.amount for f in month_records)

    return {
        "staff_id": staff_id,
        "staff_name": staff.name,
        "percent": pct,
        "salary": staff.salary or 0,
        "kpi": staff.kpi or 80,
        "today": {
            "service_total": today_total,
            "usta_share": round(today_total * pct / 100),
            "count": len(today_records),
            "records": [make_record(f) for f in today_records],
        },
        "month": {
            "service_total": month_total,
            "usta_share": round(month_total * pct / 100),
            "salary": staff.salary or 0,
            "count": len(month_records),
            "paid": 0,
            "pending": round(month_total * pct / 100),
        },
        "history": [make_record(f) for f in all_records[:50]],
    }



# ─────────────────────────────────────────────
#  SUMMARY
# ─────────────────────────────────────────────
@router.get("/summary")
def summary(salon_id=Depends(get_salon_id), db: Session = Depends(get_db)):
    today = str(date.today())
    month = today[:7]
    q = db.query(models.Finance)
    if salon_id:
        q = q.filter(models.Finance.salon_id == salon_id)
    all_fin = q.all()
    today_fin = [f for f in all_fin if f.fin_date == today]
    month_fin = [f for f in all_fin if f.fin_date and f.fin_date.startswith(month)]
    def calc(items):
        inc = sum(f.amount for f in items if f.type == "income")
        exp = sum(f.amount for f in items if f.type == "expense")
        return {"income": inc, "expense": exp, "net": inc - exp}
    return {"today": calc(today_fin), "month": calc(month_fin), "total": calc(all_fin)}


# ─────────────────────────────────────────────
#  KPI DASHBOARD — Ustalar unumdorligi
# ─────────────────────────────────────────────
@router.get("/kpi-dashboard")
def kpi_dashboard(
    period: str = "month",   # today | week | month | all
    master_id: int = None,
    salon_id=Depends(get_salon_id),
    db: Session = Depends(get_db),
):
    today = date.today()
    if period == "today":
        start = str(today)
        end = str(today)
    elif period == "week":
        start = str(today - timedelta(days=today.weekday()))
        end = str(today)
    elif period == "month":
        start = f"{today.year}-{today.month:02d}-01"
        end = str(today)
    else:
        start = "2000-01-01"
        end = str(today)

    # Barcha ustalar
    staff_q = _by_salon(db.query(models.Staff), models.Staff, salon_id)
    if master_id:
        staff_q = staff_q.filter(models.Staff.id == master_id)
    all_staff = staff_q.all()

    # Master inventory - material xarajatlari
    master_inv = _by_salon(db.query(models.MasterInventory), models.MasterInventory, salon_id).all()
    mat_cost_by_master = {}
    for mi in master_inv:
        prod = db.query(models.Inventory).filter(models.Inventory.id == mi.product_id).first()
        cost_per_unit = prod.price if prod else 0
        mat_cost_by_master[mi.master_name] = mat_cost_by_master.get(mi.master_name, 0) + (
            mi.used_qty * cost_per_unit
        )

    # Har bir usta uchun tushum (appointments dan)
    appts_q = _by_salon(db.query(models.Appointment), models.Appointment, salon_id).filter(
        models.Appointment.status == "completed",
        models.Appointment.appt_date >= start,
        models.Appointment.appt_date <= end,
    )

    fin_base = _by_salon(db.query(models.Finance), models.Finance, salon_id)

    rows = []
    for s in all_staff:
        # Usta tusha miqdori — notes ichida usta nomi bor finance yozuvlaridan
        usta_fin = fin_base.filter(
            models.Finance.type == "income",
            models.Finance.note.ilike(f"%{s.name.split()[0]}%"),
            models.Finance.fin_date >= start,
            models.Finance.fin_date <= end,
        ).all()
        usta_income = sum(f.amount for f in usta_fin)

        # Agar income yo'q bo'lsa taxminiy hisob (appointments count * avg)
        if not usta_income:
            appt_count = appts_q.filter(
                models.Appointment.master.ilike(f"%{s.name.split()[0]}%")
            ).count()
            usta_income = appt_count * 150000  # avg service price

        percent = s.percent or 30
        usta_share = round(usta_income * percent / 100)
        mat_cost = round(mat_cost_by_master.get(s.name, 0))
        salon_profit = usta_income - usta_share - mat_cost

        rows.append({
            "id": s.id,
            "name": s.name,
            "role": s.role,
            "percent": percent,
            "salary": s.salary or 0,
            "kpi": s.kpi or 80,
            "total_income": usta_income,
            "usta_share": usta_share,
            "mat_cost": mat_cost,
            "salon_profit": salon_profit,
            # Qo'shimcha
            "pending_salary": max(0, (s.salary or 0) - usta_share),
        })

    # Global xarajatlar (ijara, svet va h.k.)
    global_expenses = fin_base.filter(
        models.Finance.type == "expense",
        models.Finance.category.in_(["Ijara", "Kommunal", "Boshqa"]),
        models.Finance.fin_date >= start,
        models.Finance.fin_date <= end,
    ).all()
    global_exp_total = sum(f.amount for f in global_expenses)

    return {
        "period": period,
        "rows": rows,
        "totals": {
            "total_income": sum(r["total_income"] for r in rows),
            "usta_share_total": sum(r["usta_share"] for r in rows),
            "mat_cost_total": sum(r["mat_cost"] for r in rows),
            "global_expenses": global_exp_total,
            "net_salon_profit": sum(r["salon_profit"] for r in rows) - global_exp_total,
        },
    }


# ─────────────────────────────────────────────
#  SMART STATS — 3 ta aqlli vidjet
# ─────────────────────────────────────────────
@router.get("/smart-stats")
def smart_stats(salon_id=Depends(get_salon_id), db: Session = Depends(get_db)):
    today = date.today()
    month_start = f"{today.year}-{today.month:02d}-01"
    sq = db.query(models.Staff)
    if salon_id:
        sq = sq.filter(models.Staff.salon_id == salon_id)
    all_staff = sq.all()
    all_fin = _by_salon(db.query(models.Finance), models.Finance, salon_id).filter(
        models.Finance.fin_date >= month_start
    ).all()
    month_income = sum(f.amount for f in all_fin if f.type == "income")
    month_expense = sum(f.amount for f in all_fin if f.type == "expense")

    # 1) Eng daromadli usta
    best = {"name": "—", "income": 0}
    for s in all_staff:
        usta_fin = [
            f for f in all_fin
            if f.type == "income" and s.name.split()[0].lower() in (f.note or "").lower()
        ]
        income = sum(f.amount for f in usta_fin)
        if income > best["income"]:
            best = {"name": s.name, "role": s.role, "income": income}

    # 2) Materiallar samaradorligi (material xarajat / daromad %)
    mat_expenses = sum(f.amount for f in all_fin if f.type == "expense" and f.category == "Xomashyo")
    mat_efficiency = round(mat_expenses / month_income * 100, 1) if month_income else 0

    # 3) To'lanishi kerak bo'lgan oyliklar
    pending_salaries = sum(s.salary or 0 for s in all_staff)

    return {
        "best_staff": best,
        "mat_efficiency": mat_efficiency,
        "mat_expenses": mat_expenses,
        "pending_salaries": pending_salaries,
        "month_income": month_income,
    }


# ─────────────────────────────────────────────
#  EXPORT — Hisobotlarni yuklab olish
# ─────────────────────────────────────────────
from fastapi.responses import StreamingResponse
import io, csv

@router.get("/export")
def export_report(
    format: str = "excel",   # excel | pdf
    period: str = "month",   # week | month | year
    salon_id=Depends(get_salon_id),
    db: Session = Depends(get_db),
):
    """Moliya hisobotini Excel (CSV) yoki PDF (HTML) formatda yuklab olish."""
    t = date.today()
    if period == "week":
        start = str(t - timedelta(days=t.weekday()))
        title = f"Haftalik hisobot ({start} — {t})"
    elif period == "year":
        start = f"{t.year}-01-01"
        title = f"{t.year}-yil yillik hisobot"
    else:
        start = f"{t.year}-{t.month:02d}-01"
        title = f"{t.year}-{t.month:02d} oylik hisobot"

    q = db.query(models.Finance).filter(models.Finance.fin_date >= start)
    if salon_id:
        q = q.filter(models.Finance.salon_id == salon_id)
    items = q.order_by(models.Finance.fin_date.desc()).all()

    total_inc = sum(f.amount for f in items if f.type == "income")
    total_exp = sum(f.amount for f in items if f.type == "expense")
    net = total_inc - total_exp

    if format == "excel":
        output = io.StringIO()
        w = csv.writer(output)
        w.writerow(["#", "Sana", "Turi", "Kategoriya", "Summa", "Izoh"])
        for i, f in enumerate(items, 1):
            w.writerow([i, f.fin_date, f.type, f.category, f.amount, f.note or ""])
        w.writerow([])
        w.writerow(["", "", "", "Jami daromad:", total_inc, ""])
        w.writerow(["", "", "", "Jami xarajat:", total_exp, ""])
        w.writerow(["", "", "", "SOF FOYDA:", net, ""])
        output.seek(0)
        return StreamingResponse(
            io.BytesIO(output.getvalue().encode("utf-8-sig")),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="hisobot_{period}.csv"'},
        )
    else:
        # PDF — HTML orqali
        rows_html = "".join(
            f"<tr><td>{i}</td><td>{f.fin_date}</td><td>{'📈' if f.type=='income' else '📉'} {f.type}</td>"
            f"<td>{f.category}</td><td style='text-align:right'>{f.amount:,.0f}</td><td>{f.note or ''}</td></tr>"
            for i, f in enumerate(items, 1)
        )
        html = f"""<!DOCTYPE html><html><head><meta charset="utf-8">
        <title>{title}</title>
        <style>
            body{{font-family:Arial,sans-serif;padding:40px;color:#1a1a2e}}
            h1{{color:#8B5CF6;font-size:22px}}
            table{{width:100%;border-collapse:collapse;margin:20px 0}}
            th,td{{padding:8px 12px;border:1px solid #ddd;font-size:13px}}
            th{{background:#f0f0f5;text-align:left}}
            .summary{{margin:20px 0;padding:16px;background:#f9f9ff;border-radius:8px}}
            .summary span{{font-weight:bold;font-size:18px}}
            .green{{color:#10B981}} .red{{color:#F43F5E}} .blue{{color:#3B82F6}}
        </style></head><body>
        <h1>💈 SalonPro — {title}</h1>
        <div class="summary">
            <p>📈 Jami daromad: <span class="green">{total_inc:,.0f} so'm</span></p>
            <p>📉 Jami xarajat: <span class="red">{total_exp:,.0f} so'm</span></p>
            <p>💎 Sof foyda: <span class="blue">{net:,.0f} so'm</span></p>
        </div>
        <table><thead><tr><th>#</th><th>Sana</th><th>Turi</th><th>Kategoriya</th><th>Summa</th><th>Izoh</th></tr></thead>
        <tbody>{rows_html}</tbody></table>
        <p style="color:#999;font-size:11px;margin-top:30px">SalonPro ERP — {t}</p>
        </body></html>"""
        return StreamingResponse(
            io.BytesIO(html.encode("utf-8")),
            media_type="text/html",
            headers={"Content-Disposition": f'attachment; filename="hisobot_{period}.html"'},
        )

