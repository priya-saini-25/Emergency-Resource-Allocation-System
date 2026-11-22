import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { env } from '../config/env.js';

/**
 * Base custom error for C++ Decision Engine integration failures.
 */
export class EngineError extends Error {
  constructor(message, statusCode = 500, details = null) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.details = details;
  }
}

/**
 * Error indicating protocol or request payload validation rejection (Exit Code 1 -> HTTP 400).
 */
export class EngineValidationError extends EngineError {
  constructor(message, details = null) {
    super(message || 'C++ Decision Engine rejected request validation or protocol format', 400, details);
  }
}

/**
 * Error indicating dataset loading or graph initialization failure (Exit Code 2 -> HTTP 503).
 */
export class EngineDatasetError extends EngineError {
  constructor(message, details = null) {
    super(message || 'C++ Decision Engine failed to load graph datasets or service area boundaries', 503, details);
  }
}

/**
 * Error indicating internal algorithmic execution failure (Exit Code 3 -> HTTP 500).
 */
export class EngineExecutionError extends EngineError {
  constructor(message, details = null) {
    super(message || 'C++ Decision Engine encountered an internal execution failure', 500, details);
  }
}

/**
 * Error indicating engine process timeout (HTTP 504 Gateway Timeout).
 */
export class EngineTimeoutError extends EngineError {
  constructor(message, timeoutMs) {
    super(message || `C++ Decision Engine execution timed out after ${timeoutMs}ms`, 504, { timeoutMs });
  }
}

/**
 * Error indicating stdout/stderr buffer overflow beyond configured security thresholds.
 */
export class EngineBufferOverflowError extends EngineError {
  constructor(streamName, maxBytes) {
    super(`C++ Decision Engine ${streamName} exceeded maximum allowed buffer limit of ${maxBytes} bytes`, 500, {
      stream: streamName,
      maxBytes
    });
  }
}

/**
 * Builds process execution environment, including path adjustments for Windows MSYS2 UCRT64 runtime libraries.
 */
function buildSpawnEnvironment() {
  const currentPath = process.env.PATH || '';
  if (process.platform === 'win32' && env.CPP_EXTRA_PATH) {
    // Prepend UCRT64 toolchain bin directory to ensure dynamic runtime DLLs are located
    return {
      ...process.env,
      PATH: `${env.CPP_EXTRA_PATH};${currentPath}`
    };
  }
  return { ...process.env };
}

/**
 * Runs the C++ decision engine executable with the given arguments and optional stdin input.
 *
 * @param {string[]} args - Command line arguments
 * @param {string|null} stdinData - JSON string to pipe into stdin
 * @param {object} [options] - Options (timeoutMs, maxBufferBytes, enginePath, dataDir)
 * @returns {Promise<{ stdout: string, stderr: string, exitCode: number, wallClockMs: number }>}
 */
function runEngineProcess(args, stdinData = null, options = {}) {
  return new Promise((resolve, reject) => {
    const enginePath = options.enginePath || env.CPP_ENGINE_PATH;
    const timeoutMs = options.timeoutMs || env.CPP_TIMEOUT_MS;
    const maxBufferBytes = options.maxBufferBytes || env.CPP_MAX_BUFFER_BYTES;

    // Verify binary exists on disk before spawning
    if (!fs.existsSync(enginePath)) {
      return reject(
        new EngineDatasetError(
          `C++ Decision Engine binary not found at path: ${enginePath}. Verify build artifacts.`,
          { path: enginePath }
        )
      );
    }

    const startTime = Date.now();
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let isTerminated = false;
    let timeoutHandle = null;

    const child = spawn(enginePath, args, {
      env: buildSpawnEnvironment(),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });

    // Timeout protection
    timeoutHandle = setTimeout(() => {
      isTerminated = true;
      try {
        child.kill('SIGTERM');
        // Force kill with SIGKILL if not exited within 500ms
        setTimeout(() => {
          try { child.kill('SIGKILL'); } catch (_) {}
        }, 500);
      } catch (_) {}
      reject(new EngineTimeoutError(null, timeoutMs));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxBufferBytes) {
        isTerminated = true;
        clearTimeout(timeoutHandle);
        try { child.kill('SIGKILL'); } catch (_) {}
        return reject(new EngineBufferOverflowError('stdout', maxBufferBytes));
      }
      stdoutBuffer += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > maxBufferBytes) {
        isTerminated = true;
        clearTimeout(timeoutHandle);
        try { child.kill('SIGKILL'); } catch (_) {}
        return reject(new EngineBufferOverflowError('stderr', maxBufferBytes));
      }
      stderrBuffer += chunk.toString('utf8');
    });

    child.on('error', (err) => {
      if (isTerminated) return;
      clearTimeout(timeoutHandle);
      reject(new EngineError(`Failed to spawn C++ engine process: ${err.message}`, 500, { originalError: err.message }));
    });

    child.on('close', (exitCode, signal) => {
      if (isTerminated) return;
      clearTimeout(timeoutHandle);

      const wallClockMs = Date.now() - startTime;
      resolve({
        stdout: stdoutBuffer,
        stderr: stderrBuffer,
        exitCode: exitCode !== null ? exitCode : -1,
        signal,
        wallClockMs
      });
    });

    // Write input data if provided
    if (stdinData) {
      child.stdin.write(stdinData, 'utf8', (err) => {
        if (err) {
          clearTimeout(timeoutHandle);
          reject(new EngineError(`Failed writing to engine stdin: ${err.message}`, 500));
        }
      });
      child.stdin.end();
    } else {
      child.stdin.end();
    }
  });
}

/**
 * Diagnostic health check verifying engine executable existence, flags, and protocol version.
 *
 * @returns {Promise<{ status: string, versionInfo: object|null, path: string, dataDir: string }>}
 */
export async function checkEngineHealth() {
  const enginePath = env.CPP_ENGINE_PATH;
  const dataDir = env.CPP_DATA_DIR;

  if (!fs.existsSync(enginePath)) {
    return {
      status: 'unhealthy',
      error: `Binary not found at: ${enginePath}`,
      path: enginePath,
      dataDir
    };
  }

  try {
    const result = await runEngineProcess(['--version'], null, { timeoutMs: 3000 });
    if (result.exitCode === 0) {
      try {
        const parsed = JSON.parse(result.stdout);
        return {
          status: 'healthy',
          versionInfo: parsed,
          path: enginePath,
          dataDir,
          wallClockMs: result.wallClockMs
        };
      } catch (parseErr) {
        return {
          status: 'unhealthy',
          error: `Failed parsing --version response: ${parseErr.message}`,
          rawOutput: result.stdout,
          path: enginePath
        };
      }
    } else {
      return {
        status: 'unhealthy',
        error: `Engine returned non-zero exit code: ${result.exitCode}`,
        stderr: result.stderr,
        path: enginePath
      };
    }
  } catch (err) {
    return {
      status: 'unhealthy',
      error: err.message,
      path: enginePath,
      dataDir
    };
  }
}

/**
 * Executes a full multi-incident dispatch optimization batch via the C++ decision engine.
 *
 * @param {object} batchPayload - The raw dispatch payload (incidents, resources, hospitals, evaluated_at_ms)
 * @param {object} [options] - Optional overrides (requestId, timeoutMs, enginePath, dataDir)
 * @returns {Promise<object>} Parsed JSON response from the C++ decision engine
 */
export async function executeBatchDispatch(batchPayload, options = {}) {
  const requestId = options.requestId || randomUUID();
  const dataDir = options.dataDir || env.CPP_DATA_DIR;
  const enginePath = options.enginePath || env.CPP_ENGINE_PATH;

  // Verify dataset directory contains expected canonical files
  const graphFile = path.join(dataDir, 'jodhpur_graph.json');
  if (!fs.existsSync(graphFile)) {
    throw new EngineDatasetError(
      `Required canonical dataset not found: ${graphFile}. Verify CPP_DATA_DIR configuration.`,
      { dataDir }
    );
  }

  // Formulate Protocol Envelope v1.0
  const requestEnvelope = {
    protocol_version: '1.0',
    request_id: requestId,
    operation: 'dispatch_batch',
    payload: {
      evaluated_at_ms: batchPayload.evaluated_at_ms || Date.now(),
      incidents: batchPayload.incidents || [],
      resources: batchPayload.resources || [],
      hospitals: batchPayload.hospitals || []
    }
  };

  const stdinJson = JSON.stringify(requestEnvelope);
  const args = ['--data-dir', dataDir];

  const result = await runEngineProcess(args, stdinJson, {
    ...options,
    enginePath,
    dataDir
  });

  // Handle standard exit codes per Protocol specification
  if (result.exitCode === 0) {
    try {
      const response = JSON.parse(result.stdout);
      // Attach Node.js process bridge wall clock telemetry
      if (response) {
        if (!response.telemetry) response.telemetry = {};
        response.telemetry.process_bridge_wall_clock_ms = result.wallClockMs;
      }
      return response;
    } catch (parseError) {
      throw new EngineError(
        `Failed parsing C++ engine response JSON: ${parseError.message}`,
        500,
        { rawStdoutSnippet: result.stdout.substring(0, 500) }
      );
    }
  } else if (result.exitCode === 1) {
    // Protocol or Request validation error
    let errorDetails = null;
    try {
      errorDetails = JSON.parse(result.stdout);
    } catch (_) {
      errorDetails = { rawStderr: result.stderr.trim() };
    }
    throw new EngineValidationError(
      'C++ engine rejected request payload: validation error',
      errorDetails
    );
  } else if (result.exitCode === 2) {
    // Dataset loading or initialization error
    throw new EngineDatasetError(
      `C++ engine initialization failed: ${result.stderr.trim() || 'Dataset loading error'}`,
      { stderr: result.stderr.trim() }
    );
  } else if (result.exitCode === 3) {
    // Internal algorithmic execution error
    throw new EngineExecutionError(
      `C++ engine encountered an internal execution failure: ${result.stderr.trim() || 'Internal error'}`,
      { stderr: result.stderr.trim() }
    );
  } else {
    // Unexpected termination
    throw new EngineError(
      `C++ engine terminated unexpectedly with exit code ${result.exitCode} (${result.signal || 'no signal'}): ${result.stderr.trim()}`,
      500,
      { exitCode: result.exitCode, signal: result.signal, stderr: result.stderr }
    );
  }
}

export default {
  executeBatchDispatch,
  checkEngineHealth,
  EngineError,
  EngineValidationError,
  EngineDatasetError,
  EngineExecutionError,
  EngineTimeoutError,
  EngineBufferOverflowError
};
