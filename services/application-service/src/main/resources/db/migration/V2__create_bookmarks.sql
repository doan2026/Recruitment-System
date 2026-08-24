CREATE TABLE bookmarks (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    job_id UUID NOT NULL,
    created_at TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT bookmarks_user_job_unique UNIQUE (user_id, job_id)
);

CREATE INDEX bookmarks_user_created_idx
    ON bookmarks(user_id, created_at DESC);
