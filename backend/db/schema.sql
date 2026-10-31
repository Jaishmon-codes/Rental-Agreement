-- ====================================================================
-- RENTSPHERE PRODUCTION DATABASE SCHEMA (POSTGRESQL 15+)
-- Target: Amazon RDS PostgreSQL / Cloud SQL
-- ====================================================================

-- Enable UUID extension if available
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. USERS & IDENTITY
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    verified BOOLEAN DEFAULT TRUE,
    verification_token VARCHAR(255),
    reset_token VARCHAR(255),
    reset_token_expires_at TIMESTAMPTZ,
    token_version INTEGER DEFAULT 1,
    status VARCHAR(50) DEFAULT 'ACTIVE', -- ACTIVE, SUSPENDED, DEACTIVATED
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- 2. ROLES & GRANULAR PERMISSIONS (RBAC)
CREATE TABLE IF NOT EXISTS roles (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS permissions (
    id VARCHAR(50) PRIMARY KEY,
    code VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS role_permissions (
    role_id VARCHAR(50) NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id VARCHAR(50) NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS user_roles (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id VARCHAR(50) NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, role_id)
);

-- 3. WALLETS (DECOUPLED IDENTITY)
CREATE TABLE IF NOT EXISTS wallets (
    id VARCHAR(50) PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    wallet_address VARCHAR(42) UNIQUE NOT NULL,
    wallet_type VARCHAR(50) DEFAULT 'EVM',
    network VARCHAR(50) DEFAULT 'Sepolia',
    status VARCHAR(50) DEFAULT 'VERIFIED',
    nonce VARCHAR(64),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_wallets_address ON wallets(wallet_address);
CREATE INDEX IF NOT EXISTS idx_wallets_user ON wallets(user_id);

-- 4. PROPERTIES & UNITS DOMAIN MODEL
CREATE TABLE IF NOT EXISTS properties (
    id VARCHAR(50) PRIMARY KEY,
    landlord_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    title VARCHAR(255) NOT NULL,
    address TEXT NOT NULL,
    city VARCHAR(100) NOT NULL,
    state VARCHAR(100),
    postal_code VARCHAR(20),
    property_type VARCHAR(50) DEFAULT 'APARTMENT',
    status VARCHAR(50) DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_properties_landlord ON properties(landlord_id);

CREATE TABLE IF NOT EXISTS units (
    id VARCHAR(50) PRIMARY KEY,
    property_id VARCHAR(50) NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    unit_number VARCHAR(50) NOT NULL,
    rent_inr NUMERIC(12, 2) NOT NULL,
    security_deposit_inr NUMERIC(12, 2) NOT NULL,
    status VARCHAR(50) DEFAULT 'VACANT', -- VACANT, OCCUPIED, MAINTENANCE
    current_tenant_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_units_property ON units(property_id);
CREATE INDEX IF NOT EXISTS idx_units_tenant ON units(current_tenant_id);

-- 5. RENTAL AGREEMENTS
CREATE TABLE IF NOT EXISTS agreements (
    id VARCHAR(50) PRIMARY KEY,
    company_id VARCHAR(100) NOT NULL,
    contract_address VARCHAR(42),
    landlord_address VARCHAR(255) NOT NULL,
    tenant_address VARCHAR(255),
    property_id VARCHAR(50) REFERENCES properties(id) ON DELETE SET NULL,
    unit_id VARCHAR(50) REFERENCES units(id) ON DELETE SET NULL,
    rent_inr NUMERIC(12, 2) NOT NULL,
    security_deposit_inr NUMERIC(12, 2) NOT NULL,
    duration_days INTEGER NOT NULL,
    property_details TEXT NOT NULL,
    current_document_hash VARCHAR(64) NOT NULL,
    status VARCHAR(50) DEFAULT 'Draft', -- Draft, Pending_Signature, Active, Expired, Terminated
    version INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agreements_landlord ON agreements(landlord_address);
CREATE INDEX IF NOT EXISTS idx_agreements_tenant ON agreements(tenant_address);
CREATE INDEX IF NOT EXISTS idx_agreements_status ON agreements(status);

-- 6. DOCUMENTS & S3 STORAGE METADATA
CREATE TABLE IF NOT EXISTS documents (
    id VARCHAR(50) PRIMARY KEY,
    agreement_id VARCHAR(50) REFERENCES agreements(id) ON DELETE SET NULL,
    storage_key VARCHAR(512) NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    sha256 VARCHAR(64) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    size_bytes BIGINT NOT NULL,
    uploaded_by VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_documents_agreement ON documents(agreement_id);
CREATE INDEX IF NOT EXISTS idx_documents_sha256 ON documents(sha256);

-- 7. PAYMENTS & AUTHORITATIVE LEDGER
CREATE TABLE IF NOT EXISTS payments (
    id VARCHAR(50) PRIMARY KEY,
    agreement_id VARCHAR(50) NOT NULL REFERENCES agreements(id) ON DELETE RESTRICT,
    amount_inr NUMERIC(12, 2) NOT NULL,
    payer_address VARCHAR(255),
    payment_gateway VARCHAR(50) NOT NULL,
    transaction_id VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'PENDING',
    tenant_id VARCHAR(255),
    landlord_id VARCHAR(255),
    currency VARCHAR(10) DEFAULT 'INR',
    gross_amount BIGINT DEFAULT 0, -- Minor units (paise)
    platform_fee_percentage NUMERIC(5, 4) DEFAULT 0.0300,
    platform_fee_amount BIGINT DEFAULT 0, -- Minor units (paise)
    gateway_fee_amount BIGINT DEFAULT 0, -- Minor units (paise)
    landlord_amount BIGINT DEFAULT 0, -- Minor units (paise)
    razorpay_order_id VARCHAR(255),
    razorpay_payment_id VARCHAR(255),
    razorpay_transfer_id VARCHAR(255),
    failure_reason TEXT,
    blockchain_tx_hash VARCHAR(66),
    captured_at TIMESTAMPTZ,
    settled_at TIMESTAMPTZ,
    refunded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payments_agreement ON payments(agreement_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_razorpay_order ON payments(razorpay_order_id);
CREATE INDEX IF NOT EXISTS idx_payments_razorpay_payment ON payments(razorpay_payment_id);

-- 8. REFUNDS
CREATE TABLE IF NOT EXISTS refunds (
    id VARCHAR(50) PRIMARY KEY,
    payment_id VARCHAR(50) NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
    razorpay_refund_id VARCHAR(255),
    amount BIGINT NOT NULL, -- Minor units (paise)
    reason TEXT,
    status VARCHAR(50) NOT NULL, -- PROCESSED, FAILED, PENDING
    initiated_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_refunds_payment ON refunds(payment_id);

-- 9. LANDLORD SETTLEMENT ACCOUNTS (RAZORPAY ROUTE)
CREATE TABLE IF NOT EXISTS landlord_accounts (
    id VARCHAR(50) PRIMARY KEY,
    landlord_id VARCHAR(255) NOT NULL,
    account_number_masked VARCHAR(50),
    ifsc VARCHAR(20),
    razorpay_account_id VARCHAR(255),
    status VARCHAR(50) DEFAULT 'REGISTERED',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_landlord_accounts_landlord ON landlord_accounts(landlord_id);

-- 10. PLATFORM FEE CONFIGURATION
CREATE TABLE IF NOT EXISTS platform_fees (
    id VARCHAR(50) PRIMARY KEY,
    fee_percentage NUMERIC(5, 4) NOT NULL,
    fee_type VARCHAR(50) DEFAULT 'PERCENTAGE',
    active BOOLEAN DEFAULT TRUE,
    description TEXT,
    updated_by VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 11. WEBHOOK EVENTS (IDEMPOTENCY)
CREATE TABLE IF NOT EXISTS webhook_events (
    id VARCHAR(255) PRIMARY KEY,
    event_type VARCHAR(100) NOT NULL,
    payload TEXT NOT NULL,
    processed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 12. FINANCIAL RECONCILIATION
CREATE TABLE IF NOT EXISTS reconciliation_records (
    id VARCHAR(100) PRIMARY KEY,
    payment_id VARCHAR(50) REFERENCES payments(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL, -- MATCHED, MISMATCH, MANUAL_REVIEW, PENDING
    details TEXT,
    checked_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 13. NOTIFICATIONS
CREATE TABLE IF NOT EXISTS notifications (
    id VARCHAR(50) PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    type VARCHAR(50) DEFAULT 'INFO',
    is_read BOOLEAN DEFAULT FALSE,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);

-- 14. AUDIT & SECURITY LOGS
CREATE TABLE IF NOT EXISTS audit_logs (
    id VARCHAR(100) PRIMARY KEY,
    action VARCHAR(100) NOT NULL,
    description TEXT NOT NULL,
    user_email VARCHAR(255),
    agreement_id VARCHAR(50),
    ip_address VARCHAR(45),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_email);

CREATE TABLE IF NOT EXISTS security_events (
    id VARCHAR(100) PRIMARY KEY,
    event_type VARCHAR(100) NOT NULL,
    severity VARCHAR(50) DEFAULT 'INFO',
    user_email VARCHAR(255),
    ip_address VARCHAR(45),
    user_agent TEXT,
    details TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_security_events_type ON security_events(event_type);
