ALTER TABLE users
    ADD COLUMN first_name VARCHAR(60),
    ADD COLUMN last_name VARCHAR(60),
    ADD COLUMN middle_name VARCHAR(60),
    ADD CONSTRAINT users_structured_name_check CHECK (
        (first_name IS NULL AND last_name IS NULL AND middle_name IS NULL)
        OR (first_name IS NOT NULL AND last_name IS NOT NULL)
    );

COMMENT ON COLUMN users.first_name IS
    'Structured student first name; legacy accounts continue to use display_name.';
COMMENT ON COLUMN users.last_name IS
    'Structured student last name; legacy accounts continue to use display_name.';
COMMENT ON COLUMN users.middle_name IS
    'Optional student middle name or patronymic.';
