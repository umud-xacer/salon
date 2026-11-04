from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field

MAX_MONEY = 1_000_000_000_000
MAX_QTY = Decimal("999999999")

Qty = Field(gt=0, le=MAX_QTY, decimal_places=3)


class ProductIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    sku: str | None = Field(default=None, max_length=60)
    category: str | None = Field(default=None, max_length=80)
    barcode: str | None = Field(default=None, pattern=r"^[0-9A-Za-z-]{4,64}$")
    unit: str = Field(default="dona", min_length=1, max_length=20)
    cost_price: int = Field(default=0, ge=0, le=MAX_MONEY)
    sale_price: int = Field(default=0, ge=0, le=MAX_MONEY)
    min_qty: Decimal = Field(default=Decimal(0), ge=0, le=MAX_QTY, decimal_places=3)


class ProductUpdate(ProductIn):
    is_active: bool = True


class ProductOut(BaseModel):
    id: int
    name: str
    sku: str | None
    category: str | None = None
    barcode: str | None = None
    unit: str
    cost_price: int
    sale_price: int
    min_qty: float
    current_qty: float
    is_active: bool
    is_low: bool


class InventorySummary(BaseModel):
    products: int
    low_count: int
    stock_value: int
    low: list[ProductOut]


class MovementIn(BaseModel):
    type: Literal["purchase", "usage", "write_off"]
    qty: Decimal = Qty
    unit_cost: int | None = Field(default=None, ge=0, le=MAX_MONEY)
    note: str | None = Field(default=None, max_length=500)


class CountIn(BaseModel):
    """Sanoq: joyida sanalgan haqiqiy qoldiq. Farqni server hisoblaydi."""
    counted: Decimal = Field(ge=0, le=MAX_QTY, decimal_places=3)
    note: str = Field(min_length=3, max_length=500)


class MovementOut(BaseModel):
    id: int
    product_id: int
    product_name: str
    unit: str
    type: str
    qty: float
    unit_cost: int | None
    note: str | None
    created_by_name: str | None
    created_at: datetime
