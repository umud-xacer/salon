"""Ochiq katalog uchun xotiradagi qisqa kesh (yuklama sinovi, 2026-11-18).

Xarita, "yaqin salonlar", salon sahifasi, Hot Slots va takliflar har bir mijoz kirganda bir xil hisoblanardi va
bazani band qilardi. Ularning natijasi 30–60 soniya ichida deyarli o'zgarmaydi, shuning uchun API jarayoni xotirasida
saqlanadi. Faqat FOYDALANUVCHISIZ (get_public_db) javoblar keshlanadi — shaxsiy ma'lumot bu yerga tushmaydi.

* TTL tugasa qayta hisoblanadi; maxsize oshsa eng eskisi chiqariladi.
* Bir kalitga bir vaqtda kelgan so'rovlardan faqat bittasi bazaga boradi, qolganlari uning natijasini kutadi.
* Har bir API jarayonining o'z keshi (Redis kerak emas: 1–2 jarayon, ma'lumot 30–60 soniyada yangilanadi).
* PUBLIC_CACHE_TTL=0 — kesh o'chiq (testlar).
"""
import threading
import time
from collections import OrderedDict
from typing import Callable, Hashable, TypeVar

from app.core.client_filter import hidden_kinds
from app.core.config import get_settings

T = TypeVar("T")


class TTLCache:
    def __init__(self, maxsize: int = 4096):
        self.maxsize = maxsize
        self._data: OrderedDict[Hashable, tuple[float, object]] = OrderedDict()
        self._lock = threading.Lock()
        self._key_locks: dict[Hashable, threading.Lock] = {}
        self.hits = 0
        self.misses = 0

    def _fresh(self, key: Hashable):
        v = self._data.get(key)
        if v is not None and v[0] > time.monotonic():
            self._data.move_to_end(key)
            self.hits += 1
            return True, v[1]
        return False, None

    def get_or_set(self, key: Hashable, ttl: float, compute: Callable[[], T]) -> T:
        if ttl <= 0:
            return compute()
        hidden = hidden_kinds.get()
        if hidden:                                           # mobil ilova natijasi veb keshi bilan aralashmasin
            key = ("hidden", hidden, key)
        with self._lock:
            ok, value = self._fresh(key)
            if ok:
                return value  # type: ignore[return-value]
            key_lock = self._key_locks.setdefault(key, threading.Lock())
        with key_lock:                                       # bir kalit — bitta hisob
            with self._lock:
                ok, value = self._fresh(key)
                if ok:
                    return value  # type: ignore[return-value]
            value = compute()
            with self._lock:
                self.misses += 1
                self._data[key] = (time.monotonic() + ttl, value)
                self._data.move_to_end(key)
                while len(self._data) > self.maxsize:
                    self._data.popitem(last=False)
                self._key_locks.pop(key, None)
            return value

    def clear(self) -> None:
        with self._lock:
            self._data.clear()
            self._key_locks.clear()
            self.hits = self.misses = 0


public_cache = TTLCache()


def ttl(multiplier: float = 1.0) -> float:
    """Sozlamadagi asosiy muddat (soniya) × koeffitsient. 0 — kesh o'chiq."""
    return get_settings().public_cache_ttl * multiplier


def grid(value: float, step: float = 0.001) -> float:
    """Koordinatani to'rga yaxlitlash (0.001° ≈ 110 m): yaqin turgan mijozlar bitta keshdan foydalanadi."""
    return round(round(value / step) * step, 6)
