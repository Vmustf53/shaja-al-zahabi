// ══════════════════════════════════════════════════════════════════════════════
// Database connection pool — shared across all routes
// DevOps note: connection details come from environment variables,
// injected via Docker Compose locally or Kubernetes Secrets/ConfigMaps in prod
// ══════════════════════════════════════════════════════════════════════════════
const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.DB_HOST || 'localhost',
  port:     process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'shaja_db',
  user:     process.env.DB_USER || 'shaja_admin',
  password: process.env.DB_PASSWORD || 'changeme',
  max: 10,                      // connection pool size — fine for a small shop
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('[pos-service] Unexpected DB pool error:', err.message);
});

module.exports = pool;
