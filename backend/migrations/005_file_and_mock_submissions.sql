ALTER TABLE homework_submissions
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS file_revision INTEGER NOT NULL DEFAULT 1
        CHECK (file_revision > 0);

CREATE TABLE IF NOT EXISTS mock_submissions (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mock_id VARCHAR(120) NOT NULL,
    mock_version VARCHAR(80) NOT NULL,
    mock_snapshot JSONB NOT NULL,
    object_key TEXT NOT NULL UNIQUE,
    original_filename VARCHAR(255) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
    file_revision INTEGER NOT NULL DEFAULT 1 CHECK (file_revision > 0),
    student_comment TEXT NOT NULL DEFAULT '',
    status VARCHAR(24) NOT NULL DEFAULT 'submitted'
        CHECK (status IN ('submitted', 'in_review', 'needs_revision', 'accepted')),
    teacher_comment TEXT NOT NULL DEFAULT '',
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ,
    reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    CHECK (mock_id ~ '^[a-z0-9_-]{1,120}$'),
    CHECK (mock_version ~ '^[a-z0-9._-]{1,80}$'),
    CHECK (jsonb_typeof(mock_snapshot) = 'object'),
    UNIQUE (user_id, mock_id, mock_version)
);

CREATE INDEX IF NOT EXISTS mock_submissions_user_idx
    ON mock_submissions(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS mock_submissions_status_idx
    ON mock_submissions(status, updated_at DESC);
