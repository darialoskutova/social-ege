CREATE TABLE materials (
    id BIGSERIAL PRIMARY KEY,
    legacy_key VARCHAR(180) UNIQUE,
    title VARCHAR(300) NOT NULL,
    material_type VARCHAR(40) NOT NULL,
    section_id VARCHAR(40) NOT NULL,
    topic_id VARCHAR(100),
    reference_key VARCHAR(160),
    content_version VARCHAR(80),
    storage_kind VARCHAR(20) NOT NULL,
    legacy_path TEXT,
    object_key VARCHAR(80),
    original_filename VARCHAR(255) NOT NULL,
    mime_type VARCHAR(120) NOT NULL,
    size_bytes BIGINT,
    status VARCHAR(20) NOT NULL DEFAULT 'published',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (material_type IN ('notes', 'section_plan', 'additional', 'homework', 'thematic_mock')),
    CHECK (section_id IN ('human_society', 'social_relations', 'economics', 'politics', 'law')),
    CHECK (status IN ('published', 'hidden', 'archived')),
    CHECK (storage_kind IN ('legacy', 'uploaded')),
    CHECK (size_bytes IS NULL OR size_bytes > 0),
    CHECK (
      (storage_kind = 'legacy' AND legacy_path IS NOT NULL AND object_key IS NULL)
      OR (storage_kind = 'uploaded' AND legacy_path IS NULL AND object_key IS NOT NULL)
    )
);

CREATE INDEX materials_filters_idx
    ON materials(status, section_id, material_type, topic_id, sort_order, id);

CREATE INDEX materials_reference_idx
    ON materials(reference_key, content_version)
    WHERE reference_key IS NOT NULL;
