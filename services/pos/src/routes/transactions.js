// ══════════════════════════════════════════════════════════════════════════════
// /transactions — the billing engine
// Handles: dual pricing (retail/wholesale), discounts, payment methods,
//          credit tracking, and stock deduction via inventory-service
// ══════════════════════════════════════════════════════════════════════════════
const express = require('express');
const router = express.Router();
const axios = require('axios');
const pool = require('../db/pool');

const INVENTORY_URL = process.env.INVENTORY_SERVICE_URL || 'http://inventory-service:3001';
const CRM_URL = process.env.CRM_SERVICE_URL || 'http://crm-service:3003';

// Generate a human-readable transaction reference: SAZ-2026-00001
async function generateTransactionRef(client) {
  const year = new Date().getFullYear();
  const result = await client.query(
    `SELECT COUNT(*) AS count FROM transactions WHERE transaction_ref LIKE $1`,
    [`SAZ-${year}-%`]
  );
  const nextNum = parseInt(result.rows[0].count, 10) + 1;
  return `SAZ-${year}-${String(nextNum).padStart(5, '0')}`;
}

// GET /transactions — list with filters
router.get('/', async (req, res, next) => {
  try {
    const { customer_id, from_date, to_date, limit = 50 } = req.query;
    let query = `SELECT t.*, c.name AS customer_name FROM transactions t
                 LEFT JOIN customers c ON c.id = t.customer_id WHERE 1=1`;
    const params = [];

    if (customer_id) { params.push(customer_id); query += ` AND t.customer_id = $${params.length}`; }
    if (from_date)    { params.push(from_date);    query += ` AND t.created_at >= $${params.length}`; }
    if (to_date)      { params.push(to_date);       query += ` AND t.created_at <= $${params.length}`; }

    params.push(limit);
    query += ` ORDER BY t.created_at DESC LIMIT $${params.length}`;

    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows, meta: { total: result.rowCount } });
  } catch (err) {
    next(err);
  }
});

// GET /transactions/:id — full detail with line items
router.get('/:id', async (req, res, next) => {
  try {
    const txn = await pool.query(`SELECT * FROM transactions WHERE id = $1`, [req.params.id]);
    if (txn.rows.length === 0) {
      return res.status(404).json({ success: false, error: { code: 'TRANSACTION_NOT_FOUND', message: 'Transaction not found' } });
    }
    const items = await pool.query(`SELECT * FROM transaction_items WHERE transaction_id = $1`, [req.params.id]);
    res.json({ success: true, data: { ...txn.rows[0], items: items.rows } });
  } catch (err) {
    next(err);
  }
});

// POST /transactions — create and complete a new sale
// body: { customer_id, customer_type, items: [{variant_id, quantity, unit_price?}],
//         discount_amount, payment_method, amount_paid, served_by, notes }
router.post('/', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const {
      customer_id, customer_type = 'retail', items,
      discount_amount = 0, payment_method = 'cash',
      amount_paid, served_by, notes,
    } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'items array is required and cannot be empty' },
      });
    }
    if (!['retail', 'wholesale'].includes(customer_type)) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: "customer_type must be 'retail' or 'wholesale'" },
      });
    }

    await client.query('BEGIN');

    // ── Resolve prices for every line item ───────────────────────────────────
    // DevOps/Business note: prices ALWAYS come from the DB, never trusted from
    // the client, UNLESS staff explicitly overrides per line (unit_price provided)
    let subtotal = 0;
    const resolvedItems = [];

    for (const item of items) {
      let unitPrice = item.unit_price;

      if (unitPrice === undefined || unitPrice === null) {
        const priceResult = await client.query(
          `SELECT retail_price, wholesale_price FROM product_prices
           WHERE variant_id = $1 ORDER BY effective_from DESC LIMIT 1`,
          [item.variant_id]
        );
        if (priceResult.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({
            success: false,
            error: { code: 'PRICE_NOT_FOUND', message: `No price found for variant ${item.variant_id}` },
          });
        }
        unitPrice = customer_type === 'wholesale'
          ? priceResult.rows[0].wholesale_price
          : priceResult.rows[0].retail_price;
      }

      const lineTotal = parseFloat(unitPrice) * parseFloat(item.quantity) - (item.discount || 0);
      subtotal += lineTotal;
      resolvedItems.push({ ...item, unit_price: unitPrice, line_total: lineTotal });
    }

    const totalAmount = subtotal - discount_amount;
    const paid = amount_paid !== undefined ? amount_paid : (payment_method === 'credit' ? 0 : totalAmount);
    const creditAmount = totalAmount - paid;

    if (creditAmount > 0 && !customer_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        error: { code: 'CUSTOMER_REQUIRED', message: 'A customer must be specified for credit transactions' },
      });
    }

    // ── Insert transaction ────────────────────────────────────────────────────
    const transactionRef = await generateTransactionRef(client);
    const txnResult = await client.query(
      `INSERT INTO transactions
        (transaction_ref, customer_id, customer_type, subtotal, discount_amount,
         total_amount, payment_method, amount_paid, credit_amount, notes, served_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [transactionRef, customer_id, customer_type, subtotal, discount_amount,
       totalAmount, payment_method, paid, creditAmount, notes, served_by]
    );
    const transaction = txnResult.rows[0];

    // ── Insert line items ─────────────────────────────────────────────────────
    for (const item of resolvedItems) {
      await client.query(
        `INSERT INTO transaction_items (transaction_id, variant_id, quantity, unit_price, line_total, discount)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [transaction.id, item.variant_id, item.quantity, item.unit_price, item.line_total, item.discount || 0]
      );
    }

    // ── Update customer credit balance if applicable ──────────────────────────
    if (creditAmount > 0 && customer_id) {
      await client.query(
        `INSERT INTO customer_balances (customer_id, outstanding_kd)
         VALUES ($1, $2)
         ON CONFLICT (customer_id)
         DO UPDATE SET outstanding_kd = customer_balances.outstanding_kd + $2, last_updated = NOW()`,
        [customer_id, creditAmount]
      );
    }

    await client.query('COMMIT');

    // ── Deduct stock via inventory-service (after commit — best effort) ──────
    // DevOps note: this is a cross-service call. In Phase 1.2 this becomes
    // an async SQS-style event; for now it's a direct HTTP call with error tolerance
    for (const item of resolvedItems) {
      try {
        await axios.post(`${INVENTORY_URL}/stock/deduct`, {
          variant_id: item.variant_id,
          quantity: item.quantity,
          location: 'shopfloor',
          reference_id: transaction.id,
          user_id: served_by,
        });
      } catch (stockErr) {
        console.error(`[pos-service] Stock deduction failed for variant ${item.variant_id}:`, stockErr.message);
        // Transaction already committed — flag for manual reconciliation rather than fail the sale
      }
    }

    res.status(201).json({ success: true, data: { ...transaction, items: resolvedItems } });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;
