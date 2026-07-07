describe('crm-service structure', () => {
  it('package.json has required fields', () => {
    const pkg = require('../../package.json');
    expect(pkg.name).toBe('crm-service');
    expect(pkg.main).toBeDefined();
    expect(pkg.scripts.start).toBeDefined();
    expect(pkg.scripts.test).toBeDefined();
  });

  it('error handler exports notFound and errorHandler functions', () => {
    const { notFound, errorHandler } = require('../../src/middleware/errorHandler');
    expect(typeof notFound).toBe('function');
    expect(typeof errorHandler).toBe('function');
  });

  it('db pool module exports a pool object', () => {
    jest.mock('pg', () => ({
      Pool: jest.fn().mockImplementation(() => ({
        query: jest.fn(),
        on: jest.fn(),
        end: jest.fn(),
      })),
    }));
    jest.resetModules();
    const pool = require('../../src/db/pool');
    expect(pool).toBeDefined();
  });
});
