// ══════════════════════════════════════════════════════════════════════════════
// /categories — product category tree
// ══════════════════════════════════════════════════════════════════════════════
const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

router.get('/', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, name_en, name_ar, parent_id, sort_order FROM categories ORDER BY sort_order, id`
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { name_en, name_ar, parent_id } = req.body;
    if (!name_en || !name_ar) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'name_en and name_ar are required' },
      });
    }
    const result = await pool.query(
      `INSERT INTO categories (name_en, name_ar, parent_id) VALUES ($1, $2, $3) RETURNING *`,
      [name_en, name_ar, parent_id || null]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
