CREATE TABLE editable_tests (
    test_key VARCHAR(120) PRIMARY KEY,
    version INTEGER NOT NULL CHECK (version >= 2),
    definition JSONB NOT NULL,
    answer_key JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    CHECK (test_key ~ '^[a-z0-9_-]{1,120}$'),
    CHECK (jsonb_typeof(definition) = 'object'),
    CHECK (jsonb_typeof(answer_key) = 'object')
);

CREATE TABLE editable_test_versions (
    test_key VARCHAR(120) NOT NULL,
    version INTEGER NOT NULL CHECK (version >= 2),
    definition JSONB NOT NULL,
    answer_key JSONB NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    changed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    PRIMARY KEY (test_key, version),
    CHECK (test_key ~ '^[a-z0-9_-]{1,120}$'),
    CHECK (jsonb_typeof(definition) = 'object'),
    CHECK (jsonb_typeof(answer_key) = 'object')
);

CREATE INDEX editable_test_versions_changed_at_idx
    ON editable_test_versions(changed_at DESC);

ALTER TABLE test_attempts
    ADD COLUMN test_version INTEGER,
    ADD COLUMN result_snapshot JSONB;

ALTER TABLE test_attempts
    ADD CONSTRAINT test_attempts_version_check
        CHECK (test_version IS NULL OR test_version >= 1),
    ADD CONSTRAINT test_attempts_result_snapshot_check
        CHECK (result_snapshot IS NULL OR jsonb_typeof(result_snapshot) = 'object');
