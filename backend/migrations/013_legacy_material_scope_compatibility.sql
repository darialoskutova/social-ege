CREATE FUNCTION set_legacy_material_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.scope_type IS NULL THEN
        NEW.scope_type := CASE
            WHEN NEW.topic_id IS NOT NULL THEN 'topic'
            WHEN NEW.material_type IN ('section_plan', 'thematic_mock') THEN 'section'
            ELSE 'course'
        END;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER materials_legacy_scope_compat
BEFORE INSERT ON materials
FOR EACH ROW
EXECUTE FUNCTION set_legacy_material_scope();
