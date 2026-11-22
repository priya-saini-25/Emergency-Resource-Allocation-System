import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';
import { getHealth, getEngineHealth } from '../src/controllers/healthController.js';

/**
 * Creates mock Express Request and Response objects to test handlers without requiring live network sockets.
 */
function createMockHttp(method = 'GET', url = '/', headers = {}) {
  const req = {
    method,
    url,
    originalUrl: url,
    headers,
    params: {},
    query: {},
    body: {}
  };

  let resolveResponse;
  const responsePromise = new Promise((resolve) => {
    resolveResponse = resolve;
  });

  const res = {
    statusCode: 200,
    headersSent: false,
    _headers: {},
    _body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this._headers[name.toLowerCase()] = value;
      return this;
    },
    getHeader(name) {
      return this._headers[name.toLowerCase()];
    },
    json(data) {
      this._body = data;
      this.headersSent = true;
      resolveResponse({ statusCode: this.statusCode, body: this._body });
      return this;
    },
    send(data) {
      this._body = data;
      this.headersSent = true;
      resolveResponse({ statusCode: this.statusCode, body: this._body });
      return this;
    },
    end() {
      this.headersSent = true;
      resolveResponse({ statusCode: this.statusCode, body: this._body });
    }
  };

  return { req, res, waitForResponse: () => responsePromise };
}

describe('Health and Diagnostic Endpoints API', () => {
  it('should evaluate global health via getHealth controller', async () => {
    const { req, res, waitForResponse } = createMockHttp('GET', '/api/health');

    await getHealth(req, res, (err) => {
      if (err) throw err;
    });

    const result = await waitForResponse();
    assert.ok(result.statusCode === 200 || result.statusCode === 503, `Status should be 200 or 503, got ${result.statusCode}`);

    const body = result.body;
    assert.equal(body.success, true);
    assert.ok(body.data);
    assert.ok(['healthy', 'degraded', 'critical'].includes(body.data.status));
    assert.equal(body.data.service, 'Emergency Resource Allocation & Response Management System');
    assert.ok(body.data.region.includes('Jodhpur'));
    assert.ok(typeof body.data.uptimeSeconds === 'number');
    assert.ok(body.data.components);
    assert.ok(body.data.components.database);
    assert.ok(body.data.components.cppEngine);
    assert.equal(body.data.components.cppEngine.status, 'healthy');
    assert.equal(body.data.components.cppEngine.protocolVersion, '1.0');
  });

  it('should report engine binary and dataset status via getEngineHealth controller', async () => {
    const { req, res, waitForResponse } = createMockHttp('GET', '/api/health/engine');

    await getEngineHealth(req, res, (err) => {
      if (err) throw err;
    });

    const result = await waitForResponse();
    assert.equal(result.statusCode, 200);

    const body = result.body;
    assert.equal(body.success, true);
    assert.ok(body.data);
    assert.equal(body.data.engine.status, 'healthy');
    assert.equal(body.data.executable.exists, true);
    assert.equal(body.data.dataDirectory.allDatasetsPresent, true);
    assert.ok(Array.isArray(body.data.dataDirectory.datasets));
    assert.equal(body.data.dataDirectory.datasets.length, 4);

    const graphFile = body.data.dataDirectory.datasets.find((d) => d.file === 'jodhpur_graph.json');
    assert.ok(graphFile);
    assert.equal(graphFile.exists, true);
    assert.ok(graphFile.sizeBytes > 1000000, 'Graph file size should exceed 1MB');
  });

  it('should handle unmapped routes through Express app and return 404', async () => {
    const { req, res, waitForResponse } = createMockHttp('GET', '/api/unmapped-endpoint-xyz');

    app(req, res);

    const result = await waitForResponse();
    assert.equal(result.statusCode, 404);
    assert.equal(result.body.success, false);
    assert.equal(result.body.error.status, 404);
    assert.equal(result.body.error.code, 'ROUTE_NOT_FOUND');
    assert.ok(result.body.error.message.includes('/api/unmapped-endpoint-xyz'));
  });

  it('should dispatch GET /api/health through Express app middleware chain', async () => {
    const { req, res, waitForResponse } = createMockHttp('GET', '/api/health');

    app(req, res);

    const result = await waitForResponse();
    assert.ok(result.statusCode === 200 || result.statusCode === 503);
    assert.equal(result.body.success, true);
    assert.ok(result.body.data.components.cppEngine.status === 'healthy');
  });

  it('should dispatch GET /api/health/engine through Express app middleware chain', async () => {
    const { req, res, waitForResponse } = createMockHttp('GET', '/api/health/engine');

    app(req, res);

    const result = await waitForResponse();
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.success, true);
    assert.equal(result.body.data.dataDirectory.allDatasetsPresent, true);
  });
});
