// ══════════════════════════════════════════════════════════════════════════════
// /payments — record incoming credit payments from tailors/wholesale clients
// ══════════════════════════════════════════════════════════════════════════════
const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

// POST /payments — record a payment against a customer's outstanding balance
router.post('/', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { customer_id, amount, payment_method, received_by, notes } = req.body;

    if (!customer_id || !amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'customer_id and a positive amount are required' },
      });
    }

    await client.query('BEGIN');

    const payment = await client.query(
      `INSERT INTO credit_payments (customer_id, amount, payment_method, received_by, notes)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [customer_id, amount, payment_method, received_by, notes]
    );

    const balance = await client.query(
      `UPDATE customer_balances SET outstanding_kd = GREATEST(outstanding_kd - $1, 0), last_updated = NOW()
       WHERE customer_id = $2 RETURNING outstanding_kd`,
      [amount, customer_id]
    );

    await client.query('COMMIT');
    res.status(201).json({
      success: true,
      data: { payment: payment.rows[0], new_balance: balance.rows[0]?.outstanding_kd ?? 0 },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// GET /payments/customer/:customerId — payment history for one customer
router.get('/customer/:customerId', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT * FROM credit_payments WHERE customer_id = $1 ORDER BY created_at DESC`,
      [req.params.customerId]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
