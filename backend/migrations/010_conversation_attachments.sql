CREATE TABLE conversation_attachments (
    id BIGSERIAL PRIMARY KEY,
    message_id BIGINT NOT NULL UNIQUE
        REFERENCES conversation_messages(id) ON DELETE RESTRICT,
    object_key VARCHAR(80) NOT NULL UNIQUE
        CHECK (object_key ~ '^[0-9a-f-]{36}\.(pdf|docx|jpg|png)$'),
    original_filename VARCHAR(255) NOT NULL
        CHECK (CHAR_LENGTH(BTRIM(original_filename)) BETWEEN 1 AND 255),
    mime_type VARCHAR(100) NOT NULL
        CHECK (mime_type IN (
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'image/jpeg',
            'image/png'
        )),
    size_bytes BIGINT NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
    has_message_text BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
