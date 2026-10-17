CREATE TABLE IF NOT EXISTS conversation_threads (
    id BIGSERIAL PRIMARY KEY,
    student_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject_type VARCHAR(32) NOT NULL
        CHECK (subject_type IN ('homework', 'mock', 'test_attempt')),
    subject_id BIGINT NOT NULL CHECK (subject_id > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (subject_type, subject_id)
);

CREATE INDEX IF NOT EXISTS conversation_threads_student_idx
    ON conversation_threads(student_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS conversation_messages (
    id BIGSERIAL PRIMARY KEY,
    thread_id BIGINT NOT NULL REFERENCES conversation_threads(id) ON DELETE CASCADE,
    sender_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    sender_role VARCHAR(16) NOT NULL CHECK (sender_role IN ('student', 'teacher')),
    body TEXT NOT NULL CHECK (CHAR_LENGTH(BTRIM(body)) BETWEEN 1 AND 6000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    student_read_at TIMESTAMPTZ,
    teacher_read_at TIMESTAMPTZ,
    legacy_source VARCHAR(120),
    CHECK (sender_role <> 'student' OR student_read_at IS NOT NULL),
    CHECK (sender_role <> 'teacher' OR teacher_read_at IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS conversation_messages_legacy_source_idx
    ON conversation_messages(thread_id, legacy_source)
    WHERE legacy_source IS NOT NULL;
CREATE INDEX IF NOT EXISTS conversation_messages_thread_idx
    ON conversation_messages(thread_id, created_at, id);
CREATE INDEX IF NOT EXISTS conversation_messages_teacher_unread_idx
    ON conversation_messages(thread_id, created_at)
    WHERE sender_role = 'student' AND teacher_read_at IS NULL;
CREATE INDEX IF NOT EXISTS conversation_messages_student_unread_idx
    ON conversation_messages(thread_id, created_at)
    WHERE sender_role = 'teacher' AND student_read_at IS NULL;

INSERT INTO conversation_threads (student_id, subject_type, subject_id, created_at, updated_at)
SELECT user_id, 'homework', id, submitted_at, COALESCE(updated_at, submitted_at)
  FROM homework_submissions
 WHERE BTRIM(student_comment) <> '' OR BTRIM(teacher_comment) <> ''
ON CONFLICT (subject_type, subject_id) DO NOTHING;

INSERT INTO conversation_threads (student_id, subject_type, subject_id, created_at, updated_at)
SELECT user_id, 'mock', id, submitted_at, COALESCE(updated_at, submitted_at)
  FROM mock_submissions
 WHERE BTRIM(student_comment) <> '' OR BTRIM(teacher_comment) <> ''
ON CONFLICT (subject_type, subject_id) DO NOTHING;

INSERT INTO conversation_messages (
    thread_id, sender_user_id, sender_role, body, created_at,
    student_read_at, teacher_read_at, legacy_source
)
SELECT t.id, h.user_id, 'student', BTRIM(h.student_comment), h.submitted_at,
       h.submitted_at, h.submitted_at, 'homework:' || h.id || ':student-initial'
  FROM homework_submissions AS h
  JOIN conversation_threads AS t
    ON t.subject_type = 'homework' AND t.subject_id = h.id
 WHERE BTRIM(h.student_comment) <> ''
ON CONFLICT (thread_id, legacy_source) WHERE legacy_source IS NOT NULL DO NOTHING;

INSERT INTO conversation_messages (
    thread_id, sender_user_id, sender_role, body, created_at,
    student_read_at, teacher_read_at, legacy_source
)
SELECT t.id, COALESCE(
           h.reviewed_by,
           (SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1),
           h.user_id
       ), 'teacher', BTRIM(h.teacher_comment),
       COALESCE(h.reviewed_at, h.updated_at, h.submitted_at),
       COALESCE(h.reviewed_at, h.updated_at, h.submitted_at),
       COALESCE(h.reviewed_at, h.updated_at, h.submitted_at),
       'homework:' || h.id || ':teacher-initial'
  FROM homework_submissions AS h
  JOIN conversation_threads AS t
    ON t.subject_type = 'homework' AND t.subject_id = h.id
 WHERE BTRIM(h.teacher_comment) <> ''
ON CONFLICT (thread_id, legacy_source) WHERE legacy_source IS NOT NULL DO NOTHING;

INSERT INTO conversation_messages (
    thread_id, sender_user_id, sender_role, body, created_at,
    student_read_at, teacher_read_at, legacy_source
)
SELECT t.id, m.user_id, 'student', BTRIM(m.student_comment), m.submitted_at,
       m.submitted_at, m.submitted_at, 'mock:' || m.id || ':student-initial'
  FROM mock_submissions AS m
  JOIN conversation_threads AS t
    ON t.subject_type = 'mock' AND t.subject_id = m.id
 WHERE BTRIM(m.student_comment) <> ''
ON CONFLICT (thread_id, legacy_source) WHERE legacy_source IS NOT NULL DO NOTHING;

INSERT INTO conversation_messages (
    thread_id, sender_user_id, sender_role, body, created_at,
    student_read_at, teacher_read_at, legacy_source
)
SELECT t.id, COALESCE(
           m.reviewed_by,
           (SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1),
           m.user_id
       ), 'teacher', BTRIM(m.teacher_comment),
       COALESCE(m.reviewed_at, m.updated_at, m.submitted_at),
       COALESCE(m.reviewed_at, m.updated_at, m.submitted_at),
       COALESCE(m.reviewed_at, m.updated_at, m.submitted_at),
       'mock:' || m.id || ':teacher-initial'
  FROM mock_submissions AS m
  JOIN conversation_threads AS t
    ON t.subject_type = 'mock' AND t.subject_id = m.id
 WHERE BTRIM(m.teacher_comment) <> ''
ON CONFLICT (thread_id, legacy_source) WHERE legacy_source IS NOT NULL DO NOTHING;
