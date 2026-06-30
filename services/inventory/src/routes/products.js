// ══════════════════════════════════════════════════════════════════════════════
// /products — product catalogue CRUD
// ══════════════════════════════════════════════════════════════════════════════
const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

// GET /products — list all products with variants, stock, and current price
router.get('/', async (req, res, next) => {
  try {
    const { category_id, search } = req.query;

    let query = `
      SELECT
        p.id, p.sku, p.name_en, p.name_ar, p.unit, p.barcode, p.image_url,
        p.is_active, c.name_en AS category_en, c.name_ar AS category_ar,
        json_agg(
          json_build_object(
            'variant_id', v.id,
            'colour', v.colour,
            'colour_ar', v.colour_ar,
            'width_cm', v.width_cm,
            'retail_price', pr.retail_price,
            'wholesale_price', pr.wholesale_price,
            'shopfloor_qty', COALESCE(sf.quantity, 0),
            'warehouse_qty', COALESCE(wh.quantity, 0)
          )
        ) AS variants
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN product_variants v ON v.product_id = p.id AND v.is_active = true
      LEFT JOIN LATERAL (
        SELECT retail_price, wholesale_price FROM product_prices
        WHERE variant_id = v.id ORDER BY effective_from DESC LIMIT 1
      ) pr ON true
      LEFT JOIN stock_levels sf ON sf.variant_id = v.id AND sf.location = 'shopfloor'
      LEFT JOIN stock_levels wh ON wh.variant_id = v.id AND wh.location = 'warehouse'
      WHERE p.is_active = true
    `;
    const params = [];

    if (category_id) {
      params.push(category_id);
      query += ` AND p.category_id = $${params.length}`;
    }
    if (search) {
      params.push(`%${search}%`);
      query += ` AND (p.name_en ILIKE $${params.length} OR p.name_ar ILIKE $${params.length} OR p.sku ILIKE $${params.length})`;
    }

    query += ` GROUP BY p.id, c.name_en, c.name_ar ORDER BY p.id`;

    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows, meta: { total: result.rowCount } });
  } catch (err) {
    next(err);
  }
});

// GET /products/:id — single product detail
router.get('/:id', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT p.*, c.name_en AS category_en, c.name_ar AS category_ar
       FROM products p LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { code: 'PRODUCT_NOT_FOUND', message: 'Product not found', message_ar: 'المنتج غير موجود' },
      });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// POST /products — create a new product
router.post('/', async (req, res, next) => {
  try {
    const { sku, name_en, name_ar, category_id, unit, description, barcode } = req.body;

    if (!sku || !name_en || !name_ar || !unit) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'sku, name_en, name_ar, and unit are required' },
      });
    }

    const result = await pool.query(
      `INSERT INTO products (sku, name_en, name_ar, category_id, unit, description, barcode)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [sku, name_en, name_ar, category_id, unit, description, barcode]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({
        success: false,
        error: { code: 'DUPLICATE_SKU', message: 'A product with this SKU already exists' },
      });
    }
    next(err);
  }
});

// PATCH /products/:id — partial update
router.patch('/:id', async (req, res, next) => {
  try {
    const fields = ['name_en', 'name_ar', 'category_id', 'description', 'barcode', 'is_active'];
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
      `UPDATE products SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: { code: 'PRODUCT_NOT_FOUND', message: 'Product not found' } });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
