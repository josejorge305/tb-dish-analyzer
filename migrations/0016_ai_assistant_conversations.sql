-- ============================
-- AI Assistant Conversations Schema
-- Stores conversation history for the Ask AI feature
-- ============================

-- ============================================
-- AI CONVERSATIONS (Chat sessions with the assistant)
-- ============================================
CREATE TABLE IF NOT EXISTS ai_conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,

    -- Conversation metadata
    title TEXT,                            -- Auto-generated from first message
    started_at INTEGER DEFAULT (strftime('%s','now')),
    last_message_at INTEGER DEFAULT (strftime('%s','now')),

    -- Status
    is_active INTEGER DEFAULT 1,           -- 1 = active, 0 = archived

    FOREIGN KEY (user_id) REFERENCES user_profiles(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ai_conversations_user
    ON ai_conversations(user_id, last_message_at DESC);

-- ============================================
-- AI MESSAGES (Individual messages in a conversation)
-- ============================================
CREATE TABLE IF NOT EXISTS ai_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,

    -- Message content
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,

    -- Context snapshot (what data was used to generate response)
    context_snapshot TEXT,                 -- JSON: { meals, summary, allergens, etc. }

    -- AI metadata
    model_used TEXT,                       -- e.g., 'gpt-4o-mini', 'llama-3.1-8b'
    tokens_used INTEGER,
    response_time_ms INTEGER,

    -- Timestamps
    created_at INTEGER DEFAULT (strftime('%s','now')),

    FOREIGN KEY (conversation_id) REFERENCES ai_conversations(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES user_profiles(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation
    ON ai_messages(conversation_id, created_at ASC);

-- ============================================
-- AI ASSISTANT FEEDBACK (User ratings)
-- ============================================
CREATE TABLE IF NOT EXISTS ai_assistant_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,

    -- Feedback
    rating INTEGER CHECK (rating IN (1, -1)),  -- thumbs up/down
    feedback_text TEXT,

    created_at INTEGER DEFAULT (strftime('%s','now')),

    FOREIGN KEY (message_id) REFERENCES ai_messages(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES user_profiles(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ai_feedback_message
    ON ai_assistant_feedback(message_id);
