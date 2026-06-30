// ══════════════════════════════════════════════════════════════════════════════
// /customers — tailor, boutique, and retail customer profiles
// ══════════════════════════════════════════════════════════════════════════════
const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

// GET /customers — list, filterable by type, sortable by spend
router.get('/', async (req, res, next) => {
  try {
    const { type, sort_by_spend } = req.query;

    let query = `
      SELECT c.*, cb.outstanding_kd,
        COALESCE((SELECT SUM(total_amount) FROM transactions WHERE customer_id = c.id), 0) AS lifetime_spend,
        (SELECT MAX(created_at) FROM transactions WHERE customer_id = c.id) AS last_visit
      FROM customers c
      LEFT JOIN customer_balances cb ON cb.customer_id = c.id
      WHERE c.is_active = true
    `;
    const params = [];

    if (type) {
      params.push(type);
      query += ` AND c.type = $${params.length}`;
    }

    query += sort_by_spend === 'true' ? ` ORDER BY lifetime_spend DESC` : ` ORDER BY c.name`;

    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows, meta: { total: result.rowCount } });
  } catch (err) {
    next(err);
  }
});

// GET /customers/:id — full profile with order history
router.get('/:id', async (req, res, next) => {
  try {
    const customer = await pool.query(
      `SELECT c.*, cb.outstanding_kd FROM customers c
       LEFT JOIN customer_balances cb ON cb.customer_id = c.id WHERE c.id = $1`,
      [req.params.id]
    );
    if (customer.rows.length === 0) {
      return res.status(404).json({ success: false, error: { code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found' } });
    }

    const orders = await pool.query(
      `SELECT id, transaction_ref, total_amount, payment_method, created_at
       FROM transactions WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [req.params.id]
    );

    res.json({ success: true, data: { ...customer.rows[0], recent_orders: orders.rows } });
  } catch (err) {
    next(err);
  }
});

// GET /customers/:id/balance — quick balance check (used by POS at checkout)
router.get('/:id/balance', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT c.credit_limit, COALESCE(cb.outstanding_kd, 0) AS outstanding_kd
       FROM customers c LEFT JOIN customer_balances cb ON cb.customer_id = c.id
       WHERE c.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: { code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found' } });
    }
    const { credit_limit, outstanding_kd } = result.rows[0];
    res.json({
      success: true,
      data: {
        credit_limit,
        outstanding_kd,
        available_credit: parseFloat(credit_limit) - parseFloat(outstanding_kd),
        over_limit: parseFloat(outstanding_kd) > parseFloat(credit_limit),
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /customers — create a new tailor/customer profile
router.post('/', async (req, res, next) => {
  try {
    const { type, name, phone, whatsapp, location, credit_limit = 0, notes } = req.body;

    if (!type || !name) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'type and name are required' } });
    }
    if (!['retail', 'wholesale'].includes(type)) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: "type must be 'retail' or 'wholesale'" } });
    }

    const result = await pool.query(
      `INSERT INTO customers (type, name, phone, whatsapp, location, credit_limit, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [type, name, phone, whatsapp, location, credit_limit, notes]
    );

    await pool.query(
      `INSERT INTO customer_balances (customer_id, outstanding_kd) VALUES ($1, 0)`,
      [result.rows[0].id]
    );

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// PATCH /customers/:id — update profile
router.patch('/:id', async (req, res, next) => {
  try {
    const fields = ['name', 'phone', 'whatsapp', 'location', 'credit_limit', 'notes', 'is_active'];
    const updates = [];
    const values = [];

    fields.forEach((field) => {
      if (req.body[field] !== undefined) {
        values.push(req.body[field]);
        updates.push(`${field} = $${values.length}`);
      }
    });

    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: { code: 'NO_FIELDS', message: 'No valid fields to update' } });
    }

    values.push(req.params.id);
    const result = await pool.query(
      `UPDATE customers SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: { code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found' } });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
