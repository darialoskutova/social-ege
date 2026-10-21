ALTER TABLE materials
    ADD COLUMN scope_type VARCHAR(20),
    ADD COLUMN card_subtitle VARCHAR(180),
    ALTER COLUMN section_id DROP NOT NULL;

UPDATE materials
   SET scope_type = CASE
       WHEN topic_id IS NOT NULL THEN 'topic'
       WHEN material_type IN ('section_plan', 'thematic_mock') THEN 'section'
       ELSE 'course'
   END,
       section_id = CASE
       WHEN topic_id IS NOT NULL OR material_type IN ('section_plan', 'thematic_mock') THEN section_id
       ELSE NULL
   END,
       card_subtitle = CASE
       WHEN material_type = 'section_plan' THEN 'Задание № 24'
       ELSE NULL
   END;

ALTER TABLE materials
    ALTER COLUMN scope_type SET NOT NULL,
    ADD CONSTRAINT materials_scope_type_check
        CHECK (scope_type IN ('course', 'section', 'topic')),
    ADD CONSTRAINT materials_scope_fields_check
        CHECK (
            (scope_type = 'course' AND section_id IS NULL AND topic_id IS NULL)
            OR (scope_type = 'section' AND section_id IS NOT NULL AND topic_id IS NULL)
            OR (scope_type = 'topic' AND section_id IS NOT NULL AND topic_id IS NOT NULL)
        );

CREATE INDEX materials_scope_listing_idx
    ON materials(status, scope_type, section_id, topic_id, sort_order, id);
