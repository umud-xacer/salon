-- Salon viloyati. city ustunida tuman yoki shahar nomi turadi, address da ko'cha va uy.
ALTER TABLE businesses
    ADD COLUMN region VARCHAR(80) CHECK (char_length(region) >= 2);
CREATE INDEX ON businesses (region);
