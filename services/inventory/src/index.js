// ══════════════════════════════════════════════════════════════════════════════
// SHAJA-AL-ZAHABI — Inventory Service
// Port: 3001
// Responsibility: products, variants, pricing, stock levels, transfers, suppliers
// ══════════════════════════════════════════════════════════════════════════════
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const pool = require('./db/pool');
const productsRouter = require('./routes/products');
const stockRouter = require('./routes/stock');
const categoriesRouter = require('./routes/categories');
const suppliersRouter = require('./routes/suppliers');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors());
app.use(express.json());

// Request ID + structured logging (matches SDD v1.0 Section 7.2 log format)
app.use((req, res, next) => {
  req.id = Math.random().toString(36).slice(2, 10);
  const start = Date.now();
  res.on('finish', () => {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: res.statusCode >= 500 ? 'ERROR' : res.statusCode >= 400 ? 'WARN' : 'INFO',
      service: 'inventory-service',
      requestId: req.id,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: Date.now() - start,
    }));
  });
  next();
});

// ── Health check — used by Docker/Kubernetes liveness & readiness probes ────
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'healthy', service: 'inventory-service', db: 'connected', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'unhealthy', service: 'inventory-service', db: 'disconnected', error: err.message });
  }
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/products', productsRouter);
app.use('/stock', stockRouter);
app.use('/categories', categoriesRouter);
app.use('/suppliers', suppliersRouter);

// ── 404 + error handling (must be last) ──────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ── Graceful shutdown — important for Kubernetes rolling deployments ────────
const server = app.listen(PORT, () => {
  console.log(`[inventory-service] Listening on port ${PORT}`);
});

process.on('SIGTERM', () => {
  console.log('[inventory-service] SIGTERM received, shutting down gracefully...');
  server.close(() => {
    pool.end(() => {
      console.log('[inventory-service] Shutdown complete');
      process.exit(0);
    });
  });
});

module.exports = app;
