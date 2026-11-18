-- Super Admin kirishida ikkinchi bosqich: Telegram orqali bir martalik kod (2026-11-18).
-- Parol to'g'ri bo'lsa token berilmaydi — shu jadvalda "chaqiruv" ochiladi va kod Super Admin Telegramiga boradi.
-- Kod va chaqiruv tokeni faqat xesh holida saqlanadi. Faqat app_auth (kirish jarayoni) ko'radi.
CREATE TABLE login_challenges (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    token_hash    TEXT NOT NULL UNIQUE,
    user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash     TEXT NOT NULL,
    attempts      SMALLINT NOT NULL DEFAULT 0,                 -- noto'g'ri kodlar (qayta yuborishda nolga tushmaydi)
    sends         SMALLINT NOT NULL DEFAULT 1,
    last_sent_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at    TIMESTAMPTZ NOT NULL,                         -- joriy kodning muddati
    status        VARCHAR(8) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'used', 'locked')),
    ip            INET,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON login_challenges (user_id, created_at DESC);

ALTER TABLE login_challenges ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON login_challenges TO app_auth;
CREATE POLICY auth_all ON login_challenges TO app_auth USING (true) WITH CHECK (true);
