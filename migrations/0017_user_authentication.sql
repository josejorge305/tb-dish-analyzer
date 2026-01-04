-- ============================
-- User Authentication Schema
-- Adds secure token-based authentication
-- ============================

-- ============================================
-- USER CREDENTIALS (Email/password login)
-- ============================================
CREATE TABLE IF NOT EXISTS user_credentials (
    user_id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,           -- bcrypt/scrypt hash
    email_verified INTEGER DEFAULT 0,       -- 0 = unverified, 1 = verified
    created_at INTEGER DEFAULT (strftime('%s','now')),
    updated_at INTEGER DEFAULT (strftime('%s','now')),
    last_login_at INTEGER,

    FOREIGN KEY (user_id) REFERENCES user_profiles(user_id) ON DELETE CASCADE
);

-- Index for email lookups during login
CREATE INDEX IF NOT EXISTS idx_user_credentials_email ON user_credentials(email);

-- ============================================
-- AUTH TOKENS (Session management)
-- ============================================
CREATE TABLE IF NOT EXISTS auth_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    token_hash TEXT UNIQUE NOT NULL,        -- SHA-256 hash of the token
    device_info TEXT,                       -- Optional device identifier
    expires_at INTEGER NOT NULL,            -- Unix timestamp
    created_at INTEGER DEFAULT (strftime('%s','now')),
    revoked_at INTEGER,                     -- NULL if active, timestamp if revoked

    FOREIGN KEY (user_id) REFERENCES user_profiles(user_id) ON DELETE CASCADE
);

-- Index for token lookups
CREATE INDEX IF NOT EXISTS idx_auth_tokens_hash ON auth_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_expires ON auth_tokens(expires_at);

-- ============================================
-- PASSWORD RESET TOKENS
-- ============================================
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    token_hash TEXT UNIQUE NOT NULL,        -- SHA-256 hash
    expires_at INTEGER NOT NULL,            -- 1 hour expiry
    used_at INTEGER,                        -- NULL if unused
    created_at INTEGER DEFAULT (strftime('%s','now')),

    FOREIGN KEY (user_id) REFERENCES user_profiles(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_password_reset_hash ON password_reset_tokens(token_hash);

-- ============================================
-- DEVICE TOKENS (For anonymous-to-account migration)
-- Links old anonymous user_ids to new authenticated accounts
-- ============================================
CREATE TABLE IF NOT EXISTS device_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    old_user_id TEXT NOT NULL,              -- The anonymous user_id from device
    new_user_id TEXT NOT NULL,              -- The authenticated user_id
    migrated_at INTEGER DEFAULT (strftime('%s','now')),

    FOREIGN KEY (new_user_id) REFERENCES user_profiles(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_device_migrations_old ON device_migrations(old_user_id);
