ALTER TABLE users
    ALTER COLUMN password_hash DROP NOT NULL,
    ALTER COLUMN password_changed_at DROP NOT NULL,
    ADD COLUMN account_status VARCHAR(24) NOT NULL DEFAULT 'active'
        CHECK (account_status IN ('pending_activation', 'active', 'blocked', 'archived')),
    ADD COLUMN activated_at TIMESTAMPTZ,
    ADD COLUMN disabled_at TIMESTAMPTZ,
    ADD COLUMN archived_at TIMESTAMPTZ;

UPDATE users
   SET account_status = CASE WHEN is_active THEN 'active' ELSE 'blocked' END,
       disabled_at = CASE WHEN is_active THEN NULL ELSE NOW() END;

UPDATE users
   SET activated_at = COALESCE(password_changed_at, created_at)
 WHERE password_hash IS NOT NULL
   AND activated_at IS NULL;

ALTER TABLE users
    ADD CONSTRAINT users_account_status_state_check CHECK (
        (account_status = 'active' AND is_active = TRUE AND password_hash IS NOT NULL)
        OR (account_status = 'pending_activation' AND is_active = FALSE AND password_hash IS NULL)
        OR (account_status IN ('blocked', 'archived') AND is_active = FALSE)
    );

CREATE INDEX users_role_status_idx
    ON users(role, account_status, created_at DESC);

CREATE TABLE account_tokens (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash CHAR(64) NOT NULL UNIQUE,
    purpose VARCHAR(24) NOT NULL
        CHECK (purpose IN ('activation', 'password_reset')),
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (expires_at > created_at),
    CHECK (used_at IS NULL OR used_at >= created_at),
    CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX account_tokens_user_purpose_idx
    ON account_tokens(user_id, purpose, created_at DESC);

CREATE INDEX account_tokens_active_expiry_idx
    ON account_tokens(expires_at)
    WHERE used_at IS NULL AND revoked_at IS NULL;
