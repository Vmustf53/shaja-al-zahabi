// ══════════════════════════════════════════════════════════════════════════════
// /loyalty — loyalty points for wholesale tailors and boutiques
// ══════════════════════════════════════════════════════════════════════════════
const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

// POST /loyalty/award — award points (e.g. 1 point per KD spent — configurable by caller)
router.post('/award', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { customer_id, points, reason, reference_id } = req.body;

    if (!customer_id || !points) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'customer_id and points are required' } });
    }

    await client.query('BEGIN');

    await client.query(
      `INSERT INTO loyalty_transactions (customer_id, points, reason, reference_id) VALUES ($1,$2,$3,$4)`,
      [customer_id, points, reason, reference_id]
    );

    const result = await client.query(
      `UPDATE customers SET loyalty_points = loyalty_points + $1 WHERE id = $2 RETURNING loyalty_points`,
      [points, customer_id]
    );

    await client.query('COMMIT');
    res.json({ success: true, data: { new_balance: result.rows[0]?.loyalty_points ?? 0 } });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// GET /loyalty/:customerId — point history
router.get('/:customerId', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT * FROM loyalty_transactions WHERE customer_id = $1 ORDER BY created_at DESC`,
      [req.params.customerId]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
