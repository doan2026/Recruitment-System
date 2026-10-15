CREATE TABLE IF NOT EXISTS video_call_participants (
    call_id UUID NOT NULL REFERENCES video_calls(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    left_at TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY (call_id, user_id)
);
