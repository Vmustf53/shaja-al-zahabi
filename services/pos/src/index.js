// ══════════════════════════════════════════════════════════════════════════════
// SHAJA-AL-ZAHABI — POS Service
// Port: 3002
// Responsibility: billing, dual pricing engine, payments, credit tracking
// ══════════════════════════════════════════════════════════════════════════════
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const pool = require('./db/pool');
const transactionsRouter = require('./routes/transactions');
const pricingRouter = require('./routes/pricing');
const paymentsRouter = require('./routes/payments');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 3002;

app.use(helmet());
app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  req.id = Math.random().toString(36).slice(2, 10);
  const start = Date.now();
  res.on('finish', () => {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: res.statusCode >= 500 ? 'ERROR' : res.statusCode >= 400 ? 'WARN' : 'INFO',
      service: 'pos-service',
      requestId: req.id,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: Date.now() - start,
    }));
  });
  next();
});

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'healthy', service: 'pos-service', db: 'connected', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'unhealthy', service: 'pos-service', db: 'disconnected', error: err.message });
  }
});

app.use('/transactions', transactionsRouter);
app.use('/pricing', pricingRouter);
app.use('/payments', paymentsRouter);

app.use(notFound);
app.use(errorHandler);

const server = app.listen(PORT, () => {
  console.log(`[pos-service] Listening on port ${PORT}`);
});

process.on('SIGTERM', () => {
  console.log('[pos-service] SIGTERM received, shutting down gracefully...');
  server.close(() => {
    pool.end(() => {
      console.log('[pos-service] Shutdown complete');
      process.exit(0);
    });
  });
});

module.exports = app;
