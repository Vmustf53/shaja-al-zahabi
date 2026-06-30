// ══════════════════════════════════════════════════════════════════════════════
// /stock — stock levels, transfers between warehouse and shop floor, adjustments
// This is the heart of the "sync shop floor with warehouse" business requirement
// ══════════════════════════════════════════════════════════════════════════════
const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

// GET /stock/low — items below their minimum threshold (either location)
router.get('/low', async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT
        p.name_en, p.name_ar, p.sku, p.unit,
        v.id AS variant_id, v.colour, v.colour_ar,
        sl.location, sl.quantity, sl.min_threshold
      FROM stock_levels sl
      JOIN product_variants v ON v.id = sl.variant_id
      JOIN products p ON p.id = v.product_id
      WHERE sl.quantity <= sl.min_threshold
      ORDER BY (sl.quantity / GREATEST(sl.min_threshold, 0.01)) ASC
    `);
    res.json({ success: true, data: result.rows, meta: { total: result.rowCount } });
  } catch (err) {
    next(err);
  }
});

// GET /stock/:variantId — current stock levels for one variant (both locations)
router.get('/:variantId', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT location, quantity, min_threshold, updated_at
       FROM stock_levels WHERE variant_id = $1`,
      [req.params.variantId]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
});

// POST /stock/transfer — move stock from warehouse to shop floor (or reverse)
// DevOps/Business note: this MUST be atomic — both location updates succeed
// together or neither does. We use a transaction.
router.post('/transfer', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { variant_id, quantity, from_location, to_location, user_id, notes } = req.body;

    if (!variant_id || !quantity || !from_location || !to_location) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'variant_id, quantity, from_location, to_location are required' },
      });
    }
    if (quantity <= 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_QUANTITY', message: 'Transfer quantity must be greater than zero' },
      });
    }

    await client.query('BEGIN');

    // Check source has enough stock
    const sourceCheck = await client.query(
      `SELECT quantity FROM stock_levels WHERE variant_id = $1 AND location = $2 FOR UPDATE`,
      [variant_id, from_location]
    );
    if (sourceCheck.rows.length === 0 || parseFloat(sourceCheck.rows[0].quantity) < parseFloat(quantity)) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        error: {
          code: 'INSUFFICIENT_STOCK',
          message: `Not enough stock at ${from_location} for this transfer`,
          message_ar: 'المخزون غير كافي لإتمام النقل',
        },
      });
    }

    // Deduct from source
    await client.query(
      `UPDATE stock_levels SET quantity = quantity - $1, updated_at = NOW()
       WHERE variant_id = $2 AND location = $3`,
      [quantity, variant_id, from_location]
    );

    // Add to destination (upsert in case the row doesn't exist yet)
    await client.query(
      `INSERT INTO stock_levels (variant_id, location, quantity)
       VALUES ($1, $2, $3)
       ON CONFLICT (variant_id, location)
       DO UPDATE SET quantity = stock_levels.quantity + $3, updated_at = NOW()`,
      [variant_id, to_location, quantity]
    );

    // Log the movement
    await client.query(
      `INSERT INTO stock_movements (variant_id, movement_type, quantity, from_location, to_location, user_id, notes)
       VALUES ($1, 'transfer', $2, $3, $4, $5, $6)`,
      [variant_id, quantity, from_location, to_location, user_id, notes]
    );

    await client.query('COMMIT');
    res.json({ success: true, data: { variant_id, quantity, from_location, to_location } });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// POST /stock/deduct — used internally by pos-service when a sale completes
router.post('/deduct', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { variant_id, quantity, location = 'shopfloor', reference_id, user_id } = req.body;

    await client.query('BEGIN');

    const check = await client.query(
      `SELECT quantity FROM stock_levels WHERE variant_id = $1 AND location = $2 FOR UPDATE`,
      [variant_id, location]
    );
    if (check.rows.length === 0 || parseFloat(check.rows[0].quantity) < parseFloat(quantity)) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        error: { code: 'INSUFFICIENT_STOCK', message: `Not enough stock for variant ${variant_id}` },
      });
    }

    await client.query(
      `UPDATE stock_levels SET quantity = quantity - $1, updated_at = NOW()
       WHERE variant_id = $2 AND location = $3`,
      [quantity, variant_id, location]
    );

    await client.query(
      `INSERT INTO stock_movements (variant_id, movement_type, quantity, from_location, reference_id, user_id)
       VALUES ($1, 'sale', $2, $3, $4, $5)`,
      [variant_id, quantity, location, reference_id, user_id]
    );

    await client.query('COMMIT');
    res.json({ success: true, data: { variant_id, quantity, location } });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// POST /stock/adjust — manual correction (owner/manager only — enforced at API gateway)
router.post('/adjust', async (req, res, next) => {
  try {
    const { variant_id, location, new_quantity, user_id, reason } = req.body;

    if (!reason) {
      return res.status(400).json({
        success: false,
        error: { code: 'REASON_REQUIRED', message: 'A reason note is required for manual stock adjustments' },
      });
    }

    const result = await pool.query(
      `INSERT INTO stock_levels (variant_id, location, quantity)
       VALUES ($1, $2, $3)
       ON CONFLICT (variant_id, location)
       DO UPDATE SET quantity = $3, updated_at = NOW()
       RETURNING *`,
      [variant_id, location, new_quantity]
    );

    await pool.query(
      `INSERT INTO stock_movements (variant_id, movement_type, quantity, to_location, user_id, notes)
       VALUES ($1, 'adjustment', $2, $3, $4, $5)`,
      [variant_id, new_quantity, location, user_id, reason]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
