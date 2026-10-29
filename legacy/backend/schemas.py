from pydantic import BaseModel
from typing import Optional


# ---- STAFF ----
class StaffBase(BaseModel):
    name: str
    phone: Optional[str] = ""
    role: Optional[str] = "Sartarosh"
    percent: Optional[float] = 30
    salary: Optional[float] = 0
    start_date: Optional[str] = ""
    kpi: Optional[float] = 80
    bio: Optional[str] = ""
    skills: Optional[str] = ""
    highlights: Optional[str] = ""
    experience: Optional[int] = 0
    portfolio: Optional[str] = ""
    rating: Optional[float] = 5.0
    review_count: Optional[int] = 0

class StaffCreate(StaffBase):
    pass

class StaffOut(StaffBase):
    id: int
    class Config:
        from_attributes = True

# Admin bo'lmaganlar uchun (maosh, foiz, KPI ko'rinmaydi)
class StaffPublic(BaseModel):
    id: int
    name: str
    phone: Optional[str] = ""
    role: Optional[str] = ""
    skills: Optional[str] = ""
    rating: Optional[float] = 5.0
    class Config:
        from_attributes = True


# ---- SERVICE ----
class ServiceBase(BaseModel):
    name: str
    category: Optional[str] = "Boshqa"
    price: float
    duration: Optional[int] = 60

class ServiceCreate(ServiceBase):
    pass

class ServiceOut(ServiceBase):
    id: int
    class Config:
        from_attributes = True


# ---- INVENTORY ----
class InventoryBase(BaseModel):
    name: str
    category: Optional[str] = "Boshqa"
    qty: Optional[float] = 0
    unit: Optional[str] = "dona"
    min_qty: Optional[float] = 3
    price: Optional[float] = 0

class InventoryCreate(InventoryBase):
    pass

class InventoryOut(InventoryBase):
    id: int
    class Config:
        from_attributes = True


# ---- CLIENT ----
class ClientBase(BaseModel):
    name: str
    phone: str
    prefs: Optional[str] = ""
    visits: Optional[int] = 0
    bonus: Optional[float] = 0
    source: Optional[str] = "admin"
    note: Optional[str] = ""
    birthday: Optional[str] = ""

class ClientCreate(ClientBase):
    pass

class ClientOut(ClientBase):
    id: int
    class Config:
        from_attributes = True


# ---- APPOINTMENT ----
class AppointmentBase(BaseModel):
    client_name: str
    client_phone: Optional[str] = ""
    service: Optional[str] = ""
    master: Optional[str] = ""
    staff_id: Optional[int] = 0
    appt_date: str
    appt_time: str
    price: Optional[float] = 0
    note: Optional[str] = ""
    source: Optional[str] = "admin"
    status: Optional[str] = "pending"

class AppointmentCreate(AppointmentBase):
    pass

class AppointmentOut(AppointmentBase):
    id: int
    class Config:
        from_attributes = True


# ---- FINANCE ----
class FinanceBase(BaseModel):
    type: str
    category: Optional[str] = "Boshqa"
    amount: float
    note: Optional[str] = ""
    fin_date: Optional[str] = ""

class FinanceCreate(FinanceBase):
    pass

class FinanceOut(FinanceBase):
    id: int
    class Config:
        from_attributes = True
