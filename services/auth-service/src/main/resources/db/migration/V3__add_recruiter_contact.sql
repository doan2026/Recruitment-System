ALTER TABLE auth.users
    ADD COLUMN recruiter_full_name VARCHAR(160),
    ADD COLUMN recruiter_phone VARCHAR(32),
    ADD CONSTRAINT ck_users_recruiter_contact CHECK (
        (recruiter_full_name IS NULL AND recruiter_phone IS NULL)
        OR (
            role = 'RECRUITER'
            AND recruiter_full_name IS NOT NULL AND recruiter_phone IS NOT NULL
            AND recruiter_full_name = BTRIM(recruiter_full_name)
            AND CHAR_LENGTH(recruiter_full_name) BETWEEN 2 AND 160
            AND recruiter_phone = BTRIM(recruiter_phone)
            AND recruiter_phone ~ '^[0-9+(). -]{6,32}$'
            AND CHAR_LENGTH(REGEXP_REPLACE(recruiter_phone, '[^0-9]', '', 'g')) BETWEEN 6 AND 15
        )
    );
