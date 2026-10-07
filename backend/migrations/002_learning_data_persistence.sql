ALTER TABLE test_attempts
    ALTER COLUMN score DROP NOT NULL,
    ALTER COLUMN max_score DROP NOT NULL,
    ALTER COLUMN percentage DROP NOT NULL,
    ADD COLUMN legacy_client_id VARCHAR(120);

ALTER TABLE test_attempts
    ADD CONSTRAINT test_attempts_score_shape_check CHECK (
        (score IS NULL AND max_score IS NULL AND percentage IS NULL)
        OR
        (score IS NOT NULL AND max_score IS NOT NULL AND percentage IS NOT NULL)
    );

CREATE UNIQUE INDEX test_attempts_user_legacy_id_idx
    ON test_attempts(user_id, legacy_client_id)
    WHERE legacy_client_id IS NOT NULL;

ALTER TABLE homework_submissions
    ALTER COLUMN object_key DROP NOT NULL,
    ALTER COLUMN mime_type DROP NOT NULL,
    ALTER COLUMN size_bytes DROP NOT NULL,
    ADD COLUMN legacy_client_id VARCHAR(120);

CREATE UNIQUE INDEX homework_submissions_user_legacy_id_idx
    ON homework_submissions(user_id, legacy_client_id)
    WHERE legacy_client_id IS NOT NULL;

ALTER TABLE teacher_messages
    ADD COLUMN legacy_client_id VARCHAR(120);

CREATE UNIQUE INDEX teacher_messages_student_legacy_id_idx
    ON teacher_messages(student_id, legacy_client_id)
    WHERE legacy_client_id IS NOT NULL;
