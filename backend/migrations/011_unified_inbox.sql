ALTER TABLE test_attempts
    ADD COLUMN teacher_seen_at TIMESTAMPTZ;

ALTER TABLE homework_submissions
    ADD COLUMN teacher_seen_revision INTEGER NOT NULL DEFAULT 0;

ALTER TABLE mock_submissions
    ADD COLUMN teacher_seen_revision INTEGER NOT NULL DEFAULT 0;

-- Everything that existed before this migration is historical, not new Inbox work.
UPDATE test_attempts
   SET teacher_seen_at = NOW()
 WHERE teacher_seen_at IS NULL;

UPDATE homework_submissions
   SET teacher_seen_revision = file_revision;

UPDATE mock_submissions
   SET teacher_seen_revision = file_revision;

ALTER TABLE homework_submissions
    ADD CONSTRAINT homework_teacher_seen_revision_check
        CHECK (teacher_seen_revision BETWEEN 0 AND file_revision);

ALTER TABLE mock_submissions
    ADD CONSTRAINT mock_teacher_seen_revision_check
        CHECK (teacher_seen_revision BETWEEN 0 AND file_revision);

CREATE INDEX test_attempts_teacher_unseen_idx
    ON test_attempts(submitted_at DESC, id DESC)
    WHERE teacher_seen_at IS NULL;

CREATE INDEX homework_submissions_teacher_unseen_idx
    ON homework_submissions(updated_at DESC, id DESC)
    WHERE teacher_seen_revision < file_revision;

CREATE INDEX mock_submissions_teacher_unseen_idx
    ON mock_submissions(updated_at DESC, id DESC)
    WHERE teacher_seen_revision < file_revision;
