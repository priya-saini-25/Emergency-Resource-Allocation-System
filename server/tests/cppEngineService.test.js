import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import {
  checkEngineHealth,
  executeBatchDispatch,
  EngineError,
  EngineValidationError,
  EngineDatasetError,
  EngineExecutionError,
  EngineTimeoutError
} from '../src/services/cppEngineService.js';
import { env } from '../src/config/env.js';

describe('C++ Decision Engine Bridge Service', () => {
  it('should verify engine health via --version protocol negotiation', async () => {
    const health = await checkEngineHealth();
    assert.equal(health.status, 'healthy');
    assert.ok(health.versionInfo, 'Version info must be returned');
    assert.equal(health.versionInfo.protocol_version, '1.0');
    assert.equal(health.versionInfo.engine, 'Jodhpur Emergency Dispatch Engine');
    assert.ok(Array.isArray(health.versionInfo.supported_operations));
    assert.ok(health.versionInfo.supported_operations.includes('dispatch_batch'));
    assert.ok(typeof health.wallClockMs === 'number');
  });

  it('should successfully execute a live multi-incident dispatch optimization batch', async () => {
    const payload = {
      evaluated_at_ms: Date.now(),
      incidents: [
        {
          incident_id: 201,
          category: 'ROAD_ACCIDENT',
          severity: 4,
          victim_count: 2,
          created_at_ms: Date.now() - 45000,
          latitude: 26.2918,
          longitude: 73.0168
        },
        {
          incident_id: 202,
          category: 'MEDICAL',
          severity: 3,
          victim_count: 1,
          created_at_ms: Date.now() - 20000,
          latitude: 26.2800,
          longitude: 73.0200
        }
      ],
      resources: [
        {
          resource_id: 701,
          resource_type: 'ALS_AMBULANCE',
          status: 'AVAILABLE',
          capacity: 1,
          latitude: 26.2950,
          longitude: 73.0210
        },
        {
          resource_id: 702,
          resource_type: 'BLS_AMBULANCE',
          status: 'AVAILABLE',
          capacity: 1,
          latitude: 26.2850,
          longitude: 73.0150
        },
        {
          resource_id: 703,
          resource_type: 'RESCUE_VEHICLE',
          status: 'AVAILABLE',
          capacity: 1,
          latitude: 26.2900,
          longitude: 73.0100
        }
      ],
      hospitals: [
        {
          hospital_id: 801,
          hospital_name: 'AIIMS Jodhpur Proxy Hospital',
          status: 'OPERATIONAL',
          capabilities: ['TRAUMA', 'ICU', 'GENERAL_EMERGENCY'],
          icu_beds_total: 20,
          icu_beds_available: 10,
          general_beds_total: 100,
          general_beds_available: 50,
          oxygen_beds_total: 40,
          oxygen_beds_available: 20,
          latitude: 26.2550,
          longitude: 73.0050
        }
      ]
    };

    const response = await executeBatchDispatch(payload);

    assert.equal(response.protocol_version, '1.0');
    assert.equal(response.operation, 'dispatch_batch');
    assert.equal(response.status, 'success');
    assert.equal(response.success, true);

    // Verify response data
    assert.ok(response.data, 'Response must contain data section');
    assert.ok(Array.isArray(response.data.incident_results), 'Must include incident_results array');
    assert.equal(response.data.incident_results.length, 2, 'Should process both incidents');

    // Incident 1 verification
    const inc1 = response.data.incident_results.find((i) => i.incident_id === 201);
    assert.ok(inc1, 'Incident 201 must be present in results');
    assert.ok(inc1.priority, 'Priority evaluation must be present');
    assert.ok(typeof inc1.priority.total_priority_score === 'number');
    assert.ok(inc1.resource_allocation, 'Resource allocation must be present');
    assert.ok(inc1.hospital_matching, 'Hospital matching must be present');

    // Telemetry verification
    assert.ok(response.telemetry, 'Telemetry must be present');
    assert.ok(typeof response.telemetry.total_engine_time_ms === 'number');
    assert.ok(typeof response.telemetry.process_bridge_wall_clock_ms === 'number');
  });

  it('should map engine Exit Code 1 to EngineValidationError with statusCode 400', async () => {
    // Malformed incident payload (missing required severity and invalid category)
    const malformedPayload = {
      evaluated_at_ms: Date.now(),
      incidents: [
        {
          incident_id: 999,
          category: 'INVALID_CATEGORY_NAME'
        }
      ],
      resources: [],
      hospitals: []
    };

    await assert.rejects(
      async () => {
        await executeBatchDispatch(malformedPayload);
      },
      (err) => {
        assert.ok(err instanceof EngineValidationError, `Expected EngineValidationError, got ${err.constructor.name}`);
        assert.equal(err.statusCode, 400);
        return true;
      }
    );
  });

  it('should map invalid dataset directory (Exit Code 2) to EngineDatasetError with statusCode 503', async () => {
    const validPayload = {
      evaluated_at_ms: Date.now(),
      incidents: [],
      resources: [],
      hospitals: []
    };

    // Point to non-existent directory
    const fakeDataDir = path.resolve('C:\\non_existent_emergency_dir_12345');

    await assert.rejects(
      async () => {
        await executeBatchDispatch(validPayload, { dataDir: fakeDataDir });
      },
      (err) => {
        assert.ok(err instanceof EngineDatasetError, `Expected EngineDatasetError, got ${err.constructor.name}`);
        assert.equal(err.statusCode, 503);
        return true;
      }
    );
  });

  it('should reject with EngineTimeoutError if engine execution exceeds timeout threshold', async () => {
    const payload = {
      evaluated_at_ms: Date.now(),
      incidents: [
        {
          incident_id: 301,
          category: 'MEDICAL',
          severity: 3,
          victim_count: 1,
          created_at_ms: Date.now(),
          latitude: 26.2918,
          longitude: 73.0168
        }
      ],
      resources: [],
      hospitals: []
    };

    // Extremely low timeout to force timeout handler to trigger
    await assert.rejects(
      async () => {
        await executeBatchDispatch(payload, { timeoutMs: 1 });
      },
      (err) => {
        assert.ok(err instanceof EngineTimeoutError, `Expected EngineTimeoutError, got ${err.constructor.name}`);
        assert.equal(err.statusCode, 504);
        return true;
      }
    );
  });
});

