process.env.NODE_ENV = 'test';
import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { errorHandler } from '../src/middleware/errorHandler.js';
import {
  EngineValidationError,
  EngineDatasetError,
  EngineExecutionError,
  EngineTimeoutError,
  EngineBufferOverflowError,
  EngineError
} from '../src/services/cppEngineService.js';

function createMockResponse() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    }
  };
  return res;
}

describe('Error Handler Middleware', () => {
  it('should map SyntaxError (malformed body) to 400 INVALID_JSON_BODY', () => {
    const err = new SyntaxError('Unexpected token in JSON at position 12');
    err.status = 400;
    err.body = '{ bad json';
    const res = createMockResponse();

    errorHandler(err, {}, res, () => {});

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'INVALID_JSON_BODY');
  });

  it('should map EngineValidationError to 400 ENGINE_VALIDATION_ERROR', () => {
    const err = new EngineValidationError('Missing required field', { field: 'severity' });
    const res = createMockResponse();

    errorHandler(err, {}, res, () => {});

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error.code, 'ENGINE_VALIDATION_ERROR');
    assert.deepEqual(res.body.error.details, { field: 'severity' });
  });

  it('should map EngineDatasetError to 503 ENGINE_DATASET_UNAVAILABLE', () => {
    const err = new EngineDatasetError('Failed to load jodhpur_graph.json');
    const res = createMockResponse();

    errorHandler(err, {}, res, () => {});

    assert.equal(res.statusCode, 503);
    assert.equal(res.body.error.code, 'ENGINE_DATASET_UNAVAILABLE');
  });

  it('should map EngineExecutionError to 500 ENGINE_EXECUTION_FAILURE', () => {
    const err = new EngineExecutionError('Algorithm core dump');
    const res = createMockResponse();

    errorHandler(err, {}, res, () => {});

    assert.equal(res.statusCode, 500);
    assert.equal(res.body.error.code, 'ENGINE_EXECUTION_FAILURE');
  });

  it('should map EngineTimeoutError to 504 ENGINE_GATEWAY_TIMEOUT', () => {
    const err = new EngineTimeoutError('Process timeout', 10000);
    const res = createMockResponse();

    errorHandler(err, {}, res, () => {});

    assert.equal(res.statusCode, 504);
    assert.equal(res.body.error.code, 'ENGINE_GATEWAY_TIMEOUT');
    assert.equal(res.body.error.status, 504);
  });

  it('should map EngineBufferOverflowError to 500 ENGINE_BUFFER_OVERFLOW', () => {
    const err = new EngineBufferOverflowError('stdout', 10485760);
    const res = createMockResponse();

    errorHandler(err, {}, res, () => {});

    assert.equal(res.statusCode, 500);
    assert.equal(res.body.error.code, 'ENGINE_BUFFER_OVERFLOW');
  });

  it('should map generic Error to 500 INTERNAL_SERVER_ERROR', () => {
    const err = new Error('Generic unhandled error');
    const res = createMockResponse();

    errorHandler(err, {}, res, () => {});

    assert.equal(res.statusCode, 500);
    assert.equal(res.body.error.code, 'INTERNAL_SERVER_ERROR');
  });
});
