-- Telegram orqali kirgan foydalanuvchining bot chat_id si saqlanadi: keyingi kirishlarda tasdiqlash
-- kodi SMS o'rniga @ChronixUzBot orqali yuboriladi (raqam egasi Telegram kontakti bilan tasdiqlangan).
ALTER TABLE user_identities ADD COLUMN chat_id BIGINT;

-- Bugungacha Telegram orqali kirganlar: oxirgi muvaffaqiyatli so'rovdan (telegram_logins) tiklanadi
INSERT INTO user_identities (user_id, provider, subject, chat_id)
SELECT DISTINCT ON (u.id) u.id, 'telegram', tl.tg_user_id::TEXT, tl.tg_chat_id
  FROM telegram_logins tl
  JOIN users u ON u.phone = tl.phone AND u.status = 'active'
 WHERE tl.status = 'used' AND tl.tg_user_id IS NOT NULL AND tl.tg_chat_id IS NOT NULL
 ORDER BY u.id, tl.created_at DESC
ON CONFLICT DO NOTHING;
