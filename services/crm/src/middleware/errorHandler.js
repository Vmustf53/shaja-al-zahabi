// ══════════════════════════════════════════════════════════════════════════════
// Standard error envelope — every error response across all services
// follows this exact shape (see SDD v1.0 Section 8.2)
// ══════════════════════════════════════════════════════════════════════════════

function notFound(req, res) {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} does not exist`,
      message_ar: 'المسار غير موجود',
    },
  });
}

function errorHandler(err, req, res, next) {
  console.error(`[crm-service] Error on ${req.method} ${req.path}:`, err.message);

  const status = err.status || 500;
  res.status(status).json({
    success: false,
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: err.message || 'An unexpected error occurred',
      message_ar: err.message_ar || 'حدث خطأ غير متوقع',
      requestId: req.id,
    },
  });
}

module.exports = { notFound, errorHandler };
