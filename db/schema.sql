-- ══════════════════════════════════════════════════════════════════════════════
-- SHAJA-AL-ZAHABI — Database Schema
-- Phase 1.1: Inventory + POS + CRM
-- Engine: PostgreSQL 15
-- ══════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────
-- INVENTORY SCHEMA
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE categories (
  id          SERIAL PRIMARY KEY,
  name_en     VARCHAR(100) NOT NULL,
  name_ar     VARCHAR(100) NOT NULL,
  parent_id   INTEGER REFERENCES categories(id),
  sort_order  INTEGER DEFAULT 0,
  created_at  TIMESTAMP DEFAULT NOW()
);

CREATE TABLE products (
  id            SERIAL PRIMARY KEY,
  sku           VARCHAR(50) UNIQUE NOT NULL,
  name_en       VARCHAR(200) NOT NULL,
  name_ar       VARCHAR(200) NOT NULL,
  category_id   INTEGER REFERENCES categories(id),
  unit          VARCHAR(20) NOT NULL,       -- 'metres','pieces','rolls','grams','bundles'
  description   TEXT,
  image_url     VARCHAR(500),
  barcode       VARCHAR(100),
  is_seasonal   BOOLEAN DEFAULT FALSE,
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMP DEFAULT NOW()
);

CREATE TABLE product_variants (
  id          SERIAL PRIMARY KEY,
  product_id  INTEGER REFERENCES products(id) ON DELETE CASCADE,
  colour      VARCHAR(100),
  colour_ar   VARCHAR(100),
  width_cm    DECIMAL(6,2),
  attributes  JSONB,
  sku_suffix  VARCHAR(20),
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMP DEFAULT NOW()
);

CREATE TABLE product_prices (
  id              SERIAL PRIMARY KEY,
  variant_id      INTEGER REFERENCES product_variants(id) ON DELETE CASCADE,
  retail_price    DECIMAL(10,3) NOT NULL,
  wholesale_price DECIMAL(10,3) NOT NULL,
  cost_price      DECIMAL(10,3),
  effective_from  TIMESTAMP DEFAULT NOW(),
  changed_by      INTEGER,
  notes           TEXT
);

CREATE TABLE suppliers (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(200) NOT NULL,
  contact     VARCHAR(200),
  phone       VARCHAR(50),
  country     VARCHAR(100),
  notes       TEXT,
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMP DEFAULT NOW()
);

CREATE TABLE stock_levels (
  id            SERIAL PRIMARY KEY,
  variant_id    INTEGER REFERENCES product_variants(id) ON DELETE CASCADE,
  location      VARCHAR(20) NOT NULL,        -- 'shopfloor' or 'warehouse'
  quantity      DECIMAL(10,3) NOT NULL DEFAULT 0,
  min_threshold DECIMAL(10,3) DEFAULT 0,
  updated_at    TIMESTAMP DEFAULT NOW(),
  UNIQUE(variant_id, location)
);

CREATE TABLE stock_movements (
  id            SERIAL PRIMARY KEY,
  variant_id    INTEGER REFERENCES product_variants(id),
  movement_type VARCHAR(30) NOT NULL,   -- 'sale','transfer_out','transfer_in','adjustment','purchase_in'
  quantity      DECIMAL(10,3) NOT NULL,
  from_location VARCHAR(20),
  to_location   VARCHAR(20),
  reference_id  INTEGER,
  user_id       INTEGER,
  notes         TEXT,
  created_at    TIMESTAMP DEFAULT NOW()
);

CREATE TABLE purchase_orders (
  id          SERIAL PRIMARY KEY,
  supplier_id INTEGER REFERENCES suppliers(id),
  order_date  DATE NOT NULL,
  status      VARCHAR(20) DEFAULT 'received',
  notes       TEXT,
  created_by  INTEGER,
  created_at  TIMESTAMP DEFAULT NOW()
);

CREATE TABLE purchase_order_items (
  id                SERIAL PRIMARY KEY,
  purchase_order_id INTEGER REFERENCES purchase_orders(id) ON DELETE CASCADE,
  variant_id        INTEGER REFERENCES product_variants(id),
  quantity          DECIMAL(10,3) NOT NULL,
  cost_price        DECIMAL(10,3) NOT NULL,
  location          VARCHAR(20) DEFAULT 'warehouse'
);

-- ────────────────────────────────────────────────────────────────────────────
-- POS / BILLING SCHEMA
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE transactions (
  id              SERIAL PRIMARY KEY,
  transaction_ref VARCHAR(50) UNIQUE NOT NULL,   -- e.g. SAZ-2026-00001
  customer_id     INTEGER,
  customer_type   VARCHAR(20) NOT NULL,          -- 'retail' or 'wholesale'
  status          VARCHAR(20) DEFAULT 'completed',
  subtotal        DECIMAL(10,3) NOT NULL,
  discount_amount DECIMAL(10,3) DEFAULT 0,
  total_amount    DECIMAL(10,3) NOT NULL,
  payment_method  VARCHAR(20),                   -- 'cash','knet','credit'
  amount_paid     DECIMAL(10,3) DEFAULT 0,
  credit_amount   DECIMAL(10,3) DEFAULT 0,
  notes           TEXT,
  served_by       INTEGER,
  created_at      TIMESTAMP DEFAULT NOW()
);

CREATE TABLE transaction_items (
  id             SERIAL PRIMARY KEY,
  transaction_id INTEGER REFERENCES transactions(id) ON DELETE CASCADE,
  variant_id     INTEGER REFERENCES product_variants(id),
  quantity       DECIMAL(10,3) NOT NULL,
  unit_price     DECIMAL(10,3) NOT NULL,
  line_total     DECIMAL(10,3) NOT NULL,
  discount       DECIMAL(10,3) DEFAULT 0
);

CREATE TABLE credit_payments (
  id             SERIAL PRIMARY KEY,
  customer_id    INTEGER NOT NULL,
  amount         DECIMAL(10,3) NOT NULL,
  payment_method VARCHAR(20),
  notes          TEXT,
  received_by    INTEGER,
  created_at     TIMESTAMP DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────────────────────
-- CRM SCHEMA
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE customers (
  id             SERIAL PRIMARY KEY,
  type           VARCHAR(20) NOT NULL,    -- 'retail' or 'wholesale'
  name           VARCHAR(200) NOT NULL,
  phone          VARCHAR(50),
  whatsapp       VARCHAR(50),
  location       VARCHAR(200),
  credit_limit   DECIMAL(10,3) DEFAULT 0,
  loyalty_points INTEGER DEFAULT 0,
  notes          TEXT,
  is_active      BOOLEAN DEFAULT TRUE,
  created_at     TIMESTAMP DEFAULT NOW()
);

CREATE TABLE customer_balances (
  customer_id    INTEGER PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
  outstanding_kd DECIMAL(10,3) DEFAULT 0,
  last_updated   TIMESTAMP DEFAULT NOW()
);

CREATE TABLE loyalty_transactions (
  id           SERIAL PRIMARY KEY,
  customer_id  INTEGER REFERENCES customers(id) ON DELETE CASCADE,
  points       INTEGER NOT NULL,
  reason       VARCHAR(100),
  reference_id INTEGER,
  created_at   TIMESTAMP DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────────────────────
-- USERS & AUDIT
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE users (
  id           SERIAL PRIMARY KEY,
  username     VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name         VARCHAR(200) NOT NULL,
  role         VARCHAR(30) NOT NULL,      -- 'superadmin','manager','staff'
  is_active    BOOLEAN DEFAULT TRUE,
  created_at   TIMESTAMP DEFAULT NOW()
);

CREATE TABLE audit_log (
  id          BIGSERIAL PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id),
  action      VARCHAR(100) NOT NULL,
  table_name  VARCHAR(100),
  record_id   INTEGER,
  old_values  JSONB,
  new_values  JSONB,
  created_at  TIMESTAMP DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────────────────────
-- INDEXES — for the queries the system will run most often
-- ────────────────────────────────────────────────────────────────────────────

CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_products_sku ON products(sku);
CREATE INDEX idx_variants_product ON product_variants(product_id);
CREATE INDEX idx_stock_variant ON stock_levels(variant_id);
CREATE INDEX idx_movements_variant ON stock_movements(variant_id);
CREATE INDEX idx_movements_created ON stock_movements(created_at);
CREATE INDEX idx_transactions_customer ON transactions(customer_id);
CREATE INDEX idx_transactions_created ON transactions(created_at);
CREATE INDEX idx_txn_items_transaction ON transaction_items(transaction_id);
CREATE INDEX idx_customers_type ON customers(type);

-- ────────────────────────────────────────────────────────────────────────────
-- SEED DATA — minimal data to make the system usable on first run
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO categories (name_en, name_ar, parent_id) VALUES
  ('Dasha Fabrics', 'أقمشة الدشداشة', NULL),
  ('Threads & Yarn', 'الخيوط', NULL),
  ('Laces & Trimmings', 'الدانتيل', NULL),
  ('Buttons & Fasteners', 'الأزرار', NULL),
  ('Ladies Materials', 'مواد نسائية', NULL);

INSERT INTO products (sku, name_en, name_ar, category_id, unit, barcode) VALUES
  ('FAB-HAR-001', 'Harir Fabric', 'قماش حرير', 1, 'metres', '6281000000011'),
  ('THR-WHT-001', 'White Thread 500m', 'خيط أبيض ٥٠٠م', 2, 'rolls', '6281000000028'),
  ('LAC-GLD-001', 'Gold Lace 3cm', 'دانتيل ذهبي ٣سم', 3, 'metres', '6281000000035'),
  ('BTN-GLD-001', 'Gold Buttons 18mm', 'أزرار ذهبية ١٨مم', 4, 'pieces', '6281000000042');

INSERT INTO product_variants (product_id, colour, colour_ar, width_cm, sku_suffix) VALUES
  (1, 'White', 'أبيض', 150, '-WHT-150'),
  (1, 'Cream', 'كريمي', 150, '-CRM-150'),
  (2, 'White', 'أبيض', NULL, '-WHT'),
  (3, 'Gold', 'ذهبي', NULL, '-GLD'),
  (4, 'Gold', 'ذهبي', NULL, '-GLD');

INSERT INTO product_prices (variant_id, retail_price, wholesale_price, cost_price) VALUES
  (1, 6.500, 5.200, 3.800),
  (2, 6.000, 4.800, 3.500),
  (3, 1.800, 1.400, 0.900),
  (4, 2.200, 1.700, 1.100),
  (5, 0.350, 0.250, 0.150);

INSERT INTO stock_levels (variant_id, location, quantity, min_threshold) VALUES
  (1, 'shopfloor', 12.5, 5),
  (1, 'warehouse', 80.0, 20),
  (2, 'shopfloor', 1.5, 5),
  (2, 'warehouse', 15.0, 10),
  (3, 'shopfloor', 8.0, 5),
  (3, 'warehouse', 40.0, 15),
  (4, 'shopfloor', 24.0, 10),
  (4, 'warehouse', 200.0, 50),
  (5, 'shopfloor', 150, 50),
  (5, 'warehouse', 800, 200);

INSERT INTO customers (type, name, phone, whatsapp, location, credit_limit) VALUES
  ('wholesale', 'Tailor Hassan', '+96599887766', '+96599887766', 'Farwaniya', 200.000),
  ('wholesale', 'Boutique Al-Nour', '+96599112233', '+96599112233', 'Jaleeb Al Shouyoukh', 500.000),
  ('retail', 'Walk-in Customer', NULL, NULL, NULL, 0);

INSERT INTO customer_balances (customer_id, outstanding_kd) VALUES
  (1, 67.000),
  (2, 0.000),
  (3, 0.000);

INSERT INTO users (username, password_hash, name, role) VALUES
  ('owner', '$2b$10$placeholder.hash.replace.in.real.deploy', 'Shop Owner', 'superadmin');
