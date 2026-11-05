-- W8 xavfsizlik: notifications.business_ins siyosati yopildi.
--   Eski siyosat muassasa a'zosiga (masalan, ustaga) ISTALGAN foydalanuvchiga, o'z muassasasi nomidan
--   bildirishnoma (push) yozishga ruxsat berardi — soxta xabar / spam yuborish mumkin edi.
--   Ilova bildirishnomani hech qachon to'g'ridan-to'g'ri yozmaydi: hammasi bazadagi SECURITY DEFINER
--   funksiyalar orqali (eslatma, ogohlantirish, bron holati). Shuning uchun app_api ga INSERT kerak emas.
DROP POLICY business_ins ON notifications;
REVOKE INSERT, DELETE ON notifications FROM app_api;
