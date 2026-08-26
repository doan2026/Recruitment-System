CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE auth.users (
    id UUID PRIMARY KEY,
    email VARCHAR(320) NOT NULL,
    normalized_email VARCHAR(320) NOT NULL,
    password_hash VARCHAR(255),
    role VARCHAR(20) NOT NULL,
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    verified_at TIMESTAMPTZ,
    is_locked BOOLEAN NOT NULL DEFAULT FALSE,
    locked_at TIMESTAMPTZ,
    locked_reason VARCHAR(500),
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_users_email_format CHECK (
        email = BTRIM(email)
        AND CHAR_LENGTH(email) BETWEEN 3 AND 320
        AND email ~ '^[^[:space:]@]+@[^[:space:]@]+$'
    ),
    CONSTRAINT ck_users_normalized_email CHECK (
        normalized_email = LOWER(BTRIM(normalized_email))
        AND normalized_email = LOWER(email)
        AND CHAR_LENGTH(normalized_email) BETWEEN 3 AND 320
        AND normalized_email ~ '^[^[:space:]@]+@[^[:space:]@]+$'
    ),
    CONSTRAINT ck_users_password_hash CHECK (
        password_hash IS NULL
        OR password_hash ~ '^[$]2[aby][$]10[$][./A-Za-z0-9]{53}$'
    ),
    CONSTRAINT ck_users_role CHECK (role IN ('CANDIDATE', 'RECRUITER', 'ADMIN')),
    CONSTRAINT ck_users_verification_state CHECK (
        (is_verified = FALSE AND verified_at IS NULL)
        OR (is_verified = TRUE AND verified_at IS NOT NULL)
    ),
    CONSTRAINT ck_users_lock_state CHECK (
        (is_locked = FALSE AND locked_at IS NULL AND locked_reason IS NULL)
        OR (
            is_locked = TRUE
            AND locked_at IS NOT NULL
            AND NULLIF(BTRIM(locked_reason), '') IS NOT NULL
        )
    ),
    CONSTRAINT ck_users_version CHECK (version >= 0),
    CONSTRAINT ck_users_timestamps CHECK (updated_at >= created_at)
);

CREATE UNIQUE INDEX uq_users_normalized_email ON auth.users (normalized_email);
CREATE INDEX ix_users_role ON auth.users (role);
CREATE INDEX ix_users_locked ON auth.users (is_locked) WHERE is_locked = TRUE;

CREATE TABLE auth.refresh_sessions (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    family_id UUID NOT NULL,
    token_hash VARCHAR(64) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    revocation_reason VARCHAR(32),
    parent_session_id UUID,
    version BIGINT NOT NULL DEFAULT 0,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_refresh_sessions_user
        FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE RESTRICT,
    CONSTRAINT uq_refresh_sessions_identity UNIQUE (id, user_id, family_id),
    CONSTRAINT fk_refresh_sessions_parent
        FOREIGN KEY (parent_session_id, user_id, family_id)
        REFERENCES auth.refresh_sessions (id, user_id, family_id)
        ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT uq_refresh_sessions_token_hash UNIQUE (token_hash),
    CONSTRAINT uq_refresh_sessions_parent UNIQUE (parent_session_id),
    CONSTRAINT ck_refresh_sessions_token_hash CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_refresh_sessions_expiry CHECK (expires_at > issued_at),
    CONSTRAINT ck_refresh_sessions_revocation CHECK (
        (revoked_at IS NULL AND revocation_reason IS NULL)
        OR (
            revoked_at IS NOT NULL
            AND revocation_reason IN (
                'ROTATED',
                'LOGOUT',
                'REUSE_DETECTED',
                'PASSWORD_RESET',
                'ADMIN_LOCK',
                'EXPIRED'
            )
        )
    ),
    CONSTRAINT ck_refresh_sessions_consumed_time CHECK (
        consumed_at IS NULL
        OR (consumed_at >= issued_at AND consumed_at < expires_at)
    ),
    CONSTRAINT ck_refresh_sessions_revoked_time CHECK (
        revoked_at IS NULL OR revoked_at >= issued_at
    ),
    CONSTRAINT ck_refresh_sessions_parent CHECK (
        parent_session_id IS NULL OR parent_session_id <> id
    ),
    CONSTRAINT ck_refresh_sessions_version CHECK (version >= 0)
);

CREATE INDEX ix_refresh_sessions_user_active
    ON auth.refresh_sessions (user_id, expires_at)
    WHERE revoked_at IS NULL;
CREATE INDEX ix_refresh_sessions_family ON auth.refresh_sessions (family_id, issued_at);
CREATE INDEX ix_refresh_sessions_expiry ON auth.refresh_sessions (expires_at);

CREATE TABLE auth.oauth_accounts (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    provider VARCHAR(32) NOT NULL,
    provider_subject VARCHAR(255) NOT NULL,
    provider_email VARCHAR(320) NOT NULL,
    provider_email_verified BOOLEAN NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_oauth_accounts_user
        FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE RESTRICT,
    CONSTRAINT uq_oauth_accounts_identity UNIQUE (provider, provider_subject),
    CONSTRAINT uq_oauth_accounts_user_provider UNIQUE (user_id, provider),
    CONSTRAINT ck_oauth_accounts_provider CHECK (provider IN ('GOOGLE')),
    CONSTRAINT ck_oauth_accounts_subject CHECK (
        provider_subject = BTRIM(provider_subject)
        AND CHAR_LENGTH(provider_subject) BETWEEN 1 AND 255
    ),
    CONSTRAINT ck_oauth_accounts_email CHECK (
        provider_email = LOWER(BTRIM(provider_email))
        AND CHAR_LENGTH(provider_email) BETWEEN 3 AND 320
        AND provider_email ~ '^[^[:space:]@]+@[^[:space:]@]+$'
    ),
    CONSTRAINT ck_oauth_accounts_verified_email CHECK (
        provider <> 'GOOGLE' OR provider_email_verified = TRUE
    ),
    CONSTRAINT ck_oauth_accounts_timestamps CHECK (updated_at >= created_at)
);

CREATE INDEX ix_oauth_accounts_user ON auth.oauth_accounts (user_id);
