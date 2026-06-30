// ══════════════════════════════════════════════════════════════════════════════
// /pricing — view and update retail/wholesale prices, with full history
// ══════════════════════════════════════════════════════════════════════════════
const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

// GET /pricing/:variantId/history — full price change history (audit trail)
router.get('/:variantId/history', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT * FROM product_prices WHERE variant_id = $1 ORDER BY effective_from DESC`,
      [req.params.variantId]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
});

// POST /pricing/:variantId — set a new price (creates a new row — history preserved)
router.post('/:variantId', async (req, res, next) => {
  try {
    const { retail_price, wholesale_price, changed_by, notes } = req.body;

    if (retail_price === undefined || wholesale_price === undefined) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'retail_price and wholesale_price are required' },
      });
    }
    if (parseFloat(retail_price) < parseFloat(wholesale_price)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_PRICING', message: 'Retail price should not be lower than wholesale price', message_ar: 'يجب أن يكون سعر التجزئة أعلى من سعر الجملة' },
      });
    }

    const result = await pool.query(
      `INSERT INTO product_prices (variant_id, retail_price, wholesale_price, changed_by, notes)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.params.variantId, retail_price, wholesale_price, changed_by, notes]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
