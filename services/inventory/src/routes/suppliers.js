// ══════════════════════════════════════════════════════════════════════════════
// /suppliers — supplier profiles and purchase order recording
// ══════════════════════════════════════════════════════════════════════════════
const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

router.get('/', async (req, res, next) => {
  try {
    const result = await pool.query(`SELECT * FROM suppliers WHERE is_active = true ORDER BY name`);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { name, contact, phone, country, notes } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'name is required' } });
    }
    const result = await pool.query(
      `INSERT INTO suppliers (name, contact, phone, country, notes) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, contact, phone, country, notes]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// POST /suppliers/:id/purchase-orders — record a new stock arrival
router.post('/:id/purchase-orders', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { order_date, items, created_by, notes } = req.body;
    // items: [{ variant_id, quantity, cost_price, location }]

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'items array is required and cannot be empty' },
      });
    }

    await client.query('BEGIN');

    const poResult = await client.query(
      `INSERT INTO purchase_orders (supplier_id, order_date, notes, created_by) VALUES ($1, $2, $3, $4) RETURNING id`,
      [req.params.id, order_date || new Date(), notes, created_by]
    );
    const poId = poResult.rows[0].id;

    for (const item of items) {
      const location = item.location || 'warehouse';

      await client.query(
        `INSERT INTO purchase_order_items (purchase_order_id, variant_id, quantity, cost_price, location)
         VALUES ($1, $2, $3, $4, $5)`,
        [poId, item.variant_id, item.quantity, item.cost_price, location]
      );

      // Add to stock
      await client.query(
        `INSERT INTO stock_levels (variant_id, location, quantity)
         VALUES ($1, $2, $3)
         ON CONFLICT (variant_id, location)
         DO UPDATE SET quantity = stock_levels.quantity + $3, updated_at = NOW()`,
        [item.variant_id, location, item.quantity]
      );

      // Log movement
      await client.query(
        `INSERT INTO stock_movements (variant_id, movement_type, quantity, to_location, reference_id)
         VALUES ($1, 'purchase_in', $2, $3, $4)`,
        [item.variant_id, item.quantity, location, poId]
      );

      // Update cost price on the price record
      await client.query(
        `UPDATE product_prices SET cost_price = $1
         WHERE variant_id = $2 AND id = (
           SELECT id FROM product_prices WHERE variant_id = $2 ORDER BY effective_from DESC LIMIT 1
         )`,
        [item.cost_price, item.variant_id]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ success: true, data: { purchase_order_id: poId, items_count: items.length } });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;
