CREATE TABLE users (
    id BIGSERIAL PRIMARY KEY,
    login VARCHAR(64) NOT NULL UNIQUE,
    display_name VARCHAR(120) NOT NULL,
    password_hash TEXT NOT NULL,
    role VARCHAR(16) NOT NULL DEFAULT 'student'
        CHECK (role IN ('student', 'teacher', 'admin')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    password_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (login = LOWER(login)),
    CHECK (login ~ '^[a-z0-9._-]{3,64}$')
);

CREATE TABLE user_consents (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document_type VARCHAR(32) NOT NULL
        CHECK (document_type IN ('personal_data', 'privacy', 'offer')),
    document_version VARCHAR(40) NOT NULL,
    accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, document_type, document_version)
);

CREATE TABLE auth_sessions (
    token_hash CHAR(64) PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,
    CHECK (expires_at > created_at)
);

CREATE INDEX auth_sessions_user_id_idx ON auth_sessions(user_id);
CREATE INDEX auth_sessions_active_expiry_idx
    ON auth_sessions(expires_at)
    WHERE revoked_at IS NULL;

CREATE TABLE user_progress (
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    topic_key VARCHAR(100) NOT NULL,
    test_completed_at TIMESTAMPTZ,
    homework_submitted_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, topic_key),
    CHECK (topic_key ~ '^[a-z0-9_-]{1,100}$')
);

CREATE TABLE test_drafts (
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    test_key VARCHAR(120) NOT NULL,
    topic_key VARCHAR(100) NOT NULL,
    answers JSONB NOT NULL DEFAULT '{}'::JSONB,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, test_key),
    CHECK (test_key ~ '^[a-z0-9_-]{1,120}$'),
    CHECK (topic_key ~ '^[a-z0-9_-]{1,100}$'),
    CHECK (jsonb_typeof(answers) = 'object')
);

CREATE TABLE test_attempts (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    topic_key VARCHAR(100) NOT NULL,
    test_key VARCHAR(120) NOT NULL,
    score INTEGER NOT NULL CHECK (score >= 0),
    max_score INTEGER NOT NULL CHECK (max_score > 0),
    percentage NUMERIC(5,2) NOT NULL CHECK (percentage BETWEEN 0 AND 100),
    submitted_answers JSONB NOT NULL DEFAULT '{}'::JSONB,
    incorrect_question_ids JSONB NOT NULL DEFAULT '[]'::JSONB,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (score <= max_score),
    CHECK (topic_key ~ '^[a-z0-9_-]{1,100}$'),
    CHECK (test_key ~ '^[a-z0-9_-]{1,120}$'),
    CHECK (jsonb_typeof(submitted_answers) = 'object'),
    CHECK (jsonb_typeof(incorrect_question_ids) = 'array')
);

CREATE INDEX test_attempts_user_topic_idx
    ON test_attempts(user_id, topic_key, submitted_at DESC);

CREATE TABLE homework_submissions (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    topic_key VARCHAR(100) NOT NULL,
    object_key TEXT NOT NULL UNIQUE,
    original_filename VARCHAR(255) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
    student_comment TEXT NOT NULL DEFAULT '',
    status VARCHAR(24) NOT NULL DEFAULT 'submitted'
        CHECK (status IN ('submitted', 'in_review', 'needs_revision', 'accepted')),
    teacher_comment TEXT NOT NULL DEFAULT '',
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ,
    reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    CHECK (topic_key ~ '^[a-z0-9_-]{1,100}$')
);

CREATE INDEX homework_submissions_user_topic_idx
    ON homework_submissions(user_id, topic_key, submitted_at DESC);
CREATE INDEX homework_submissions_status_idx
    ON homework_submissions(status, submitted_at);

CREATE TABLE teacher_messages (
    id BIGSERIAL PRIMARY KEY,
    student_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category VARCHAR(40) NOT NULL,
    body TEXT NOT NULL,
    teacher_reply TEXT,
    replied_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    replied_at TIMESTAMPTZ,
    CHECK (CHAR_LENGTH(body) BETWEEN 1 AND 4000),
    CHECK (teacher_reply IS NULL OR CHAR_LENGTH(teacher_reply) BETWEEN 1 AND 4000)
);

CREATE INDEX teacher_messages_student_idx
    ON teacher_messages(student_id, created_at DESC);
CREATE INDEX teacher_messages_unanswered_idx
    ON teacher_messages(created_at)
    WHERE replied_at IS NULL;

CREATE TABLE audit_log (
    id BIGSERIAL PRIMARY KEY,
    actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    target_type VARCHAR(60),
    target_id TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX audit_log_created_at_idx ON audit_log(created_at DESC);
