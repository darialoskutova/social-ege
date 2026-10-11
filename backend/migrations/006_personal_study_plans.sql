CREATE TABLE IF NOT EXISTS student_study_plans (
    user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    start_topic_id VARCHAR(100) NOT NULL,
    effective_from DATE NOT NULL,
    target_end_date DATE,
    lesson_weekdays SMALLINT[] NOT NULL,
    lessons_per_topic SMALLINT NOT NULL DEFAULT 2,
    timezone VARCHAR(64) NOT NULL DEFAULT 'Europe/Moscow',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (start_topic_id ~ '^[a-z0-9_-]{1,100}$'),
    CHECK (cardinality(lesson_weekdays) BETWEEN 1 AND 7),
    CHECK (lesson_weekdays <@ ARRAY[1,2,3,4,5,6,7]::SMALLINT[]),
    CHECK (lessons_per_topic BETWEEN 1 AND 3),
    CHECK (timezone = 'Europe/Moscow')
);

CREATE TABLE IF NOT EXISTS study_schedule_events (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_type VARCHAR(32) NOT NULL
        CHECK (event_type IN ('lesson', 'test_deadline', 'homework_deadline', 'thematic_mock')),
    topic_id VARCHAR(100),
    test_key VARCHAR(120),
    lesson_part SMALLINT,
    mock_id VARCHAR(120),
    mock_version VARCHAR(80),
    scheduled_date DATE NOT NULL,
    original_scheduled_date DATE,
    deadline_at TIMESTAMPTZ,
    status VARCHAR(24) NOT NULL DEFAULT 'scheduled'
        CHECK (status IN ('scheduled', 'cancelled', 'completed', 'superseded')),
    source VARCHAR(24) NOT NULL DEFAULT 'generated'
        CHECK (source IN ('generated', 'manual')),
    change_note TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    cancelled_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    CHECK (topic_id IS NULL OR topic_id ~ '^[a-z0-9_-]{1,100}$'),
    CHECK (test_key IS NULL OR test_key ~ '^[a-z0-9_-]{1,120}$'),
    CHECK (mock_id IS NULL OR mock_id ~ '^[a-z0-9_-]{1,120}$'),
    CHECK (mock_version IS NULL OR mock_version ~ '^[a-z0-9._-]{1,80}$'),
    CHECK (lesson_part IS NULL OR lesson_part BETWEEN 1 AND 3),
    CHECK (
        (event_type = 'lesson' AND topic_id IS NOT NULL AND lesson_part IS NOT NULL
            AND test_key IS NULL AND mock_id IS NULL AND mock_version IS NULL AND deadline_at IS NULL)
        OR
        (event_type = 'test_deadline' AND topic_id IS NOT NULL AND test_key IS NOT NULL
            AND lesson_part IS NULL AND mock_id IS NULL AND mock_version IS NULL AND deadline_at IS NOT NULL)
        OR
        (event_type = 'homework_deadline' AND topic_id IS NOT NULL
            AND test_key IS NULL AND lesson_part IS NULL AND mock_id IS NULL
            AND mock_version IS NULL AND deadline_at IS NOT NULL)
        OR
        (event_type = 'thematic_mock' AND topic_id IS NULL AND test_key IS NULL
            AND lesson_part IS NULL AND mock_id IS NOT NULL AND mock_version IS NOT NULL
            AND deadline_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS study_schedule_events_user_date_idx
    ON study_schedule_events(user_id, scheduled_date, id)
    WHERE status <> 'superseded';

CREATE INDEX IF NOT EXISTS study_schedule_events_user_status_idx
    ON study_schedule_events(user_id, status, scheduled_date);

CREATE INDEX IF NOT EXISTS study_schedule_events_topic_idx
    ON study_schedule_events(user_id, topic_id, event_type)
    WHERE topic_id IS NOT NULL;
