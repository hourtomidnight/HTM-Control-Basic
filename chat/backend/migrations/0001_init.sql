-- Core schema for HTM Chat

CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    avatar_url TEXT,
    role TEXT NOT NULL DEFAULT 'member', -- 'admin' | 'member'
    status_message TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    expires_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE channels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    topic TEXT,
    is_private INTEGER NOT NULL DEFAULT 0,
    is_dm INTEGER NOT NULL DEFAULT 0, -- 1:1 direct message channel
    is_archived INTEGER NOT NULL DEFAULT 0,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE channel_members (
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    last_read_message_id TEXT,
    PRIMARY KEY (channel_id, user_id)
);
CREATE INDEX idx_channel_members_user ON channel_members(user_id);

CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id),
    content TEXT NOT NULL,
    thread_parent_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
    edited_at TEXT,
    deleted_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_messages_channel_created ON messages(channel_id, created_at);
CREATE INDEX idx_messages_thread ON messages(thread_parent_id);

CREATE TABLE reactions (
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (message_id, user_id, emoji)
);

CREATE TABLE push_subscriptions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL,
    p256dh_key TEXT NOT NULL,
    auth_key TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (user_id, endpoint)
);

-- Attention Messages: mandatory read/confirm gating feature.
CREATE TABLE attention_messages (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    severity INTEGER NOT NULL DEFAULT 3, -- 1=FYI, 2=Important, 3=Mandatory (only 3 gates in MVP)
    target_type TEXT NOT NULL, -- 'channel' | 'user' | 'role'
    target_id TEXT NOT NULL,
    expires_at TEXT, -- nullable; null = never auto-expires
    withdrawn_at TEXT -- nullable; admin cancel
);
CREATE INDEX idx_attention_messages_target ON attention_messages(target_type, target_id);

CREATE TABLE attention_receipts (
    attention_message_id TEXT NOT NULL REFERENCES attention_messages(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    seen_at TEXT,
    confirmed_at TEXT,
    escalated_at TEXT, -- last time a push-nudge escalation was sent
    PRIMARY KEY (attention_message_id, user_id)
);
CREATE INDEX idx_attention_receipts_user ON attention_receipts(user_id);
