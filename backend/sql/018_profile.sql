-- Mijoz profili va sevimli salonlar.
ALTER TABLE users
    ADD COLUMN birth_date DATE CHECK (birth_date >= DATE '1900-01-01'),
    ADD COLUMN gender     VARCHAR(10) CHECK (gender IN ('male', 'female'));

GRANT UPDATE (birth_date, gender) ON users TO app_api;

CREATE TABLE favorite_businesses (
    user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    business_id  BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, business_id)
);
CREATE INDEX ON favorite_businesses (business_id);

ALTER TABLE favorite_businesses ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON favorite_businesses TO app_api;
CREATE POLICY own ON favorite_businesses TO app_api USING (user_id = app.uid()) WITH CHECK (user_id = app.uid());
