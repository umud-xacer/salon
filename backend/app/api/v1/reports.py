"""Hisobotlar (direktor): davr bo'yicha pul, bronlar, xizmatlar, xodimlar, mijozlar va Excel eksport.

Huquq: 'finance.view'. Barcha sanalar biznesning o'z vaqt mintaqasida hisoblanadi.
Pul qoidasi kunlik kassa bilan bir xil: to'lov to'langan kuniga, qaytarish qaytarilgan kuniga yoziladi.
Oylik to'langanda u xarajatlarga avtomatik yoziladi (015_payroll.sql), shuning uchun alohida qo'shilmaydi.
"""
import io
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_permission
from app.schemas.reports import (BookingStats, CategoryRow, ClientStats, DayRow, ExpenseRow, MethodRow, MoneyStats, ReportOut,
                                 ServiceRow, StaffRow)

router = APIRouter(prefix="/businesses/{business_id}/reports", tags=["reports"])

_finance = require_permission("finance.view")

MAX_DAYS = 366
_TZ = "(SELECT timezone FROM businesses WHERE id = :b) z(timezone)"
# [f, t] oralig'idagi mahalliy kunlar: indeksdan foydalanish uchun ustun o'zgartirilmaydi
_IN = ("{col} >= CAST(:f AS timestamp) AT TIME ZONE z.timezone "
       "AND {col} < CAST(:t1 AS timestamp) AT TIME ZONE z.timezone")
_LOCAL_DAY = "CAST({col} AT TIME ZONE z.timezone AS date)"

def _period(date_from: date = Query(), date_to: date = Query()) -> tuple[date, date]:
    if date_to < date_from or (date_to - date_from).days >= MAX_DAYS:
        raise HTTPException(422, detail={"code": "invalid_period", "message": "Davr noto'g'ri (ko'pi bilan 1 yil)"})
    return date_from, date_to


def _params(business_id: int, f: date, t: date) -> dict:
    return {"b": business_id, "f": f, "t": t, "t1": t + timedelta(days=1)}


def _money(db: Session, p: dict) -> tuple[int, int, int]:
    """(tushum, qaytarish, xarajat) davr uchun."""
    row = db.execute(text(f"""
        SELECT coalesce(sum(amount) FILTER (WHERE {_IN.format(col="paid_at")}), 0)::bigint AS income,
               coalesce(sum(amount) FILTER (WHERE {_IN.format(col="refunded_at")}), 0)::bigint AS refunds
          FROM payments CROSS JOIN {_TZ}
         WHERE business_id = :b AND (({_IN.format(col="paid_at")}) OR ({_IN.format(col="refunded_at")}))
    """), p).mappings().one()
    expenses = db.scalar(text("SELECT coalesce(sum(amount), 0)::bigint FROM expenses "
                              "WHERE business_id = :b AND spent_at BETWEEN :f AND :t"), p)
    return row["income"], row["refunds"], expenses


def build_report(db: Session, business_id: int, f: date, t: date) -> ReportOut:
    p = _params(business_id, f, t)
    income, refunds, expenses = _money(db, p)
    length = (t - f).days + 1
    prev_income, prev_refunds, prev_expenses = _money(
        db, _params(business_id, f - timedelta(days=length), f - timedelta(days=1)))

    methods = db.execute(text(f"""
        SELECT method::text AS method,
               coalesce(sum(amount) FILTER (WHERE {_IN.format(col="paid_at")}), 0)::bigint AS income,
               coalesce(sum(amount) FILTER (WHERE {_IN.format(col="refunded_at")}), 0)::bigint AS refunds
          FROM payments CROSS JOIN {_TZ}
         WHERE business_id = :b AND (({_IN.format(col="paid_at")}) OR ({_IN.format(col="refunded_at")}))
         GROUP BY method ORDER BY income DESC, method
    """), p).mappings()

    expense_rows = db.execute(text("""
        SELECT coalesce(c.name, 'Toifasiz') AS name, sum(e.amount)::bigint AS amount
          FROM expenses e LEFT JOIN expense_categories c ON c.id = e.category_id
         WHERE e.business_id = :b AND e.spent_at BETWEEN :f AND :t
         GROUP BY 1 ORDER BY 2 DESC, 1
    """), p).mappings()

    in_period = _IN.format(col="a.starts_at")
    statuses = {r["status"]: r["n"] for r in db.execute(text(f"""
        SELECT a.status::text AS status, count(*) AS n FROM appointments a CROSS JOIN {_TZ}
         WHERE a.business_id = :b AND {in_period} GROUP BY 1
    """), p).mappings()}
    sources = {r["source"]: r["n"] for r in db.execute(text(f"""
        SELECT a.source::text AS source, count(*) AS n FROM appointments a CROSS JOIN {_TZ}
         WHERE a.business_id = :b AND {in_period} AND a.status <> 'cancelled' GROUP BY 1
    """), p).mappings()}
    done = db.execute(text(f"""
        SELECT count(*) AS n, coalesce(sum(a.total_price - a.discount), 0)::bigint AS revenue
          FROM appointments a CROSS JOIN {_TZ}
         WHERE a.business_id = :b AND {in_period} AND a.status = 'completed'
    """), p).mappings().one()

    services = db.execute(text(f"""
        SELECT s.service_name AS name, max(nullif(btrim(sv.name_ru), '')) AS name_ru,
               count(*) AS count, sum(s.price)::bigint AS revenue
          FROM appointment_services s JOIN appointments a ON a.id = s.appointment_id
          LEFT JOIN services sv ON sv.id = s.service_id CROSS JOIN {_TZ}
         WHERE a.business_id = :b AND {in_period} AND a.status = 'completed'
         GROUP BY s.service_name ORDER BY revenue DESC, count DESC, name LIMIT 20
    """), p).mappings()

    # Bo'limlar: xizmatlar bilan bir xil qoida (bajarilgan bronlar), faqat xizmat bo'limi bo'yicha guruhlangan
    categories = db.execute(text(f"""
        SELECT sc.id AS category_id, sc.name, nullif(btrim(sc.name_ru), '') AS name_ru,
               count(*) AS count, sum(s.price)::bigint AS revenue
          FROM appointment_services s JOIN appointments a ON a.id = s.appointment_id
          LEFT JOIN services sv ON sv.id = s.service_id
          LEFT JOIN service_categories sc ON sc.id = sv.category_id CROSS JOIN {_TZ}
         WHERE a.business_id = :b AND {in_period} AND a.status = 'completed'
         GROUP BY sc.id, sc.name, sc.name_ru ORDER BY revenue DESC, count DESC, sc.name NULLS LAST
    """), p).mappings()

    staff = db.execute(text(f"""
        SELECT a.member_id, coalesce(u.full_name, 'Xodim') AS name,
               count(*) FILTER (WHERE a.status <> 'cancelled') AS bookings,
               count(*) FILTER (WHERE a.status = 'completed') AS completed,
               count(*) FILTER (WHERE a.status = 'no_show') AS no_show,
               coalesce(sum(a.total_price - a.discount) FILTER (WHERE a.status = 'completed'), 0)::bigint AS revenue
          FROM appointments a
          JOIN business_members m ON m.id = a.member_id
          LEFT JOIN users u ON u.id = m.user_id
         CROSS JOIN {_TZ}
         WHERE a.business_id = :b AND {in_period}
         GROUP BY a.member_id, u.full_name ORDER BY revenue DESC, completed DESC, name
    """), p).mappings()

    clients = db.execute(text(f"""
        WITH seen AS (
            SELECT DISTINCT a.client_id FROM appointments a CROSS JOIN {_TZ}
             WHERE a.business_id = :b AND {in_period} AND a.status <> 'cancelled'
        )
        SELECT count(*) AS total,
               count(*) FILTER (WHERE NOT EXISTS (
                   SELECT 1 FROM appointments o CROSS JOIN {_TZ}
                    WHERE o.business_id = :b AND o.client_id = seen.client_id AND o.status <> 'cancelled'
                      AND o.starts_at < CAST(:f AS timestamp) AT TIME ZONE z.timezone)) AS new
          FROM seen
    """), p).mappings().one()

    daily = db.execute(text(f"""
        WITH days AS (SELECT CAST(d AS date) AS day FROM generate_series(CAST(:f AS date), CAST(:t AS date), '1 day') d),
        pay AS (
            SELECT {_LOCAL_DAY.format(col="paid_at")} AS day, sum(amount) AS income FROM payments CROSS JOIN {_TZ}
             WHERE business_id = :b AND {_IN.format(col="paid_at")} GROUP BY 1),
        ref AS (
            SELECT {_LOCAL_DAY.format(col="refunded_at")} AS day, sum(amount) AS refunds FROM payments CROSS JOIN {_TZ}
             WHERE business_id = :b AND {_IN.format(col="refunded_at")} GROUP BY 1),
        exp AS (
            SELECT spent_at AS day, sum(amount) AS expenses FROM expenses
             WHERE business_id = :b AND spent_at BETWEEN :f AND :t GROUP BY 1),
        bk AS (
            SELECT {_LOCAL_DAY.format(col="a.starts_at")} AS day, count(*) AS bookings
              FROM appointments a CROSS JOIN {_TZ}
             WHERE a.business_id = :b AND {in_period} AND a.status <> 'cancelled' GROUP BY 1)
        SELECT days.day AS date, coalesce(pay.income, 0)::bigint AS income, coalesce(ref.refunds, 0)::bigint AS refunds,
               coalesce(exp.expenses, 0)::bigint AS expenses, coalesce(bk.bookings, 0)::int AS bookings
          FROM days LEFT JOIN pay USING (day) LEFT JOIN ref USING (day) LEFT JOIN exp USING (day)
          LEFT JOIN bk USING (day)
         ORDER BY days.day
    """), p).mappings()

    total = sum(statuses.values())
    return ReportOut(
        date_from=f, date_to=t,
        money=MoneyStats(income=income, refunds=refunds, net_income=income - refunds, expenses=expenses,
                         profit=income - refunds - expenses,
                         prev_net_income=prev_income - prev_refunds,
                         prev_profit=prev_income - prev_refunds - prev_expenses),
        methods=[MethodRow(**m) for m in methods],
        expenses_by_category=[ExpenseRow(**e) for e in expense_rows],
        bookings=BookingStats(total=total, by_status=statuses, by_source=sources, completed=done["n"],
                              completed_revenue=done["revenue"],
                              avg_check=done["revenue"] // done["n"] if done["n"] else 0,
                              cancel_rate=round(100 * statuses.get("cancelled", 0) / total, 1) if total else 0.0),
        services=[ServiceRow(**s) for s in services],
        categories=[CategoryRow(**c) for c in categories],
        staff=[StaffRow(**s) for s in staff],
        clients=ClientStats(total=clients["total"], new=clients["new"], returning=clients["total"] - clients["new"]),
        daily=[DayRow(**d) for d in daily],
    )


@router.get("", response_model=ReportOut)
def report(period: tuple[date, date] = Depends(_period), business_id: int = Depends(_finance),
           db: Session = Depends(get_db)):
    return build_report(db, business_id, *period)


@router.get("/export.xlsx")
def export(period: tuple[date, date] = Depends(_period), business_id: int = Depends(_finance),
           db: Session = Depends(get_db)):
    from app.services.report_excel import build_workbook   # og'ir kutubxona faqat kerak bo'lganda

    f, t = period
    r = build_report(db, business_id, f, t)
    payments = db.execute(text(f"""
        SELECT p.paid_at AT TIME ZONE z.timezone AS paid_at, c.full_name AS client, p.method::text AS method,
               p.amount, p.status::text AS status, p.refunded_at AT TIME ZONE z.timezone AS refunded_at,
               p.refund_reason, u.full_name AS received_by
          FROM payments p
          LEFT JOIN business_clients c  ON c.id = p.client_id
          LEFT JOIN business_members m  ON m.id = p.received_by
          LEFT JOIN users u             ON u.id = m.user_id
         CROSS JOIN {_TZ}
         WHERE p.business_id = :b AND (({_IN.format(col="p.paid_at")}) OR ({_IN.format(col="p.refunded_at")}))
         ORDER BY p.paid_at
    """), _params(business_id, f, t)).mappings().all()
    name = db.scalar(text("SELECT name FROM businesses WHERE id = :b"), {"b": business_id})
    data = build_workbook(name, r, payments)
    filename = f"hisobot_{f.isoformat()}_{t.isoformat()}.xlsx"
    return StreamingResponse(io.BytesIO(data),
                             media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": f'attachment; filename="{filename}"'})
