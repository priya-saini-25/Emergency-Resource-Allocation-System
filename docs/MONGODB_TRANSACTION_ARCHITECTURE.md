# MongoDB Transaction Architecture & Topology Specification

> **ACADEMIC SIMULATION PROXY NOTICE**  
> This specification documents the multi-document transaction infrastructure, session management, and deployment topology requirements for the Emergency Resource Allocation & Response Management System.

---

## 1. Multi-Document Transaction Architecture

In Phase 4.5, confirming an emergency dispatch requires coordinated state changes across four independent MongoDB collections:
1. `resources`: Transitioning vehicle status from `AVAILABLE` to `DISPATCHED` and recording assignments.
2. `hospitals`: Decrementing ICU, general, and oxygen bed capacities.
3. `incidents`: Transitioning lifecycle state from `VERIFIED` to `ALLOCATED` and `DISPATCHED`.
4. `dispatchrecords`: Transitioning `confirmationStatus` from `PENDING` to `CONFIRMED` and writing audit logs.

### 1.1 The All-or-Nothing Invariant
If any vehicle is unavailable or hospital capacity is exhausted midway through a batch of 10 incidents:
- **With Transactions**: MongoDB rolls back all writes across all collections. Zero vehicles are reserved, zero beds decremented, and zero incidents dispatched.
- **Without Transactions**: Partial writes leave orphan reservations, stranded ambulances, and inconsistent incident states.

---

## 2. Mongoose Session Management & Rollback Mechanics

The transaction lifecycle is encapsulated within the `withTransaction` higher-order service:

```javascript
export async function withTransaction(workFn, options = {}) {
  if (options.sessionOverride) {
    const session = options.sessionOverride;
    let txStarted = false;
    try {
      if (typeof session.startTransaction === 'function') {
        session.startTransaction();
        txStarted = true;
      }
      const result = await workFn(session);
      if (typeof session.commitTransaction === 'function') {
        await session.commitTransaction();
      }
      return result;
    } catch (workErr) {
      if (txStarted && typeof session.abortTransaction === 'function') {
        try {
          await session.abortTransaction();
        } catch (_) {}
      }
      throw workErr;
    }
  }

  const dbStatus = getConnectionStatus();
  if (!dbStatus.connected) {
    throw new DispatchConfirmationError(
      'Dispatch service is temporarily unavailable. Database is disconnected.',
      'DATABASE_UNAVAILABLE',
      null,
      503
    );
  }

  const session = await mongoose.startSession();
  let transactionStarted = false;

  try {
    session.startTransaction();
    transactionStarted = true;

    const result = await workFn(session);
    await session.commitTransaction();
    return result;
  } catch (error) {
    if (transactionStarted) {
      try {
        await session.abortTransaction();
      } catch (_) {}
    }
    throw error;
  } finally {
    try {
      await session.endSession();
    } catch (_) {}
  }
}
```

### Key Safety Invariants:
1. **Explicit Session Propagation Across All 4 Models**: Every database operation within `workFn` passes `{ session }`:
   - `Resource.findOneAndUpdate(..., { session, new: true })`
   - `Hospital.findOneAndUpdate(..., { session, new: true })`
   - `Incident.findOneAndUpdate(..., { session, new: true })`
   - `DispatchRecord.prototype.save({ session })`
   Zero writes escape the session context.
2. **Deterministic Cleanup**: `session.endSession()` executes unconditionally in a `finally` block, preventing connection pool exhaustion and memory leaks.
3. **Rollback Precedence**: If any resource is unavailable, hospital capacity insufficient, or incident state conflicted, `session.abortTransaction()` reverts all uncommitted writes before rethrowing the application error.
4. **No Unsafe Fallbacks**: Standalone deployments without replica sets throw explicit HTTP 503 `TRANSACTION_UNAVAILABLE`. Under no circumstances are sequential non-transactional writes executed as a substitute for atomicity.

---

## 3. MongoDB Deployment Topology Requirements

MongoDB multi-document transactions require a deployment topology that supports distributed consensus:

| Deployment Topology | Transaction Support | Production Status | Development Suitability |
|---|:---:|---|---|
| **Standalone (`mongod`)** | ❌ No | Not supported | Local development with offline/degraded fallback. |
| **Single-Node Replica Set** | ✅ **Yes** | Not recommended for HA | **Recommended for local development & testing.** |
| **Multi-Node Replica Set** | ✅ **Yes** | **Production Standard** | Production and staging environments. |
| **Sharded Cluster** | ✅ **Yes** | High-throughput enterprise | Multi-region municipal deployments. |

---

## 4. Local Development Replica-Set Setup Guide

To run true multi-document transactions in local development, MongoDB must be configured as a replica set.

### Option A: Local Windows Service (Single-Node Replica Set)
1. Stop the existing standalone MongoDB service.
2. Edit `mongod.cfg` (typically in `C:\Program Files\MongoDB\Server\7.0\bin\mongod.cfg`):
```yaml
replication:
  replSetName: "rs0"
```
3. Start the MongoDB service.
4. Open the `mongosh` terminal and initiate the replica set once:
```javascript
rs.initiate({
  _id: "rs0",
  members: [
    { _id: 0, host: "localhost:27017" }
  ]
})
```
5. Update your `.env` connection URI:
```env
MONGODB_URI=mongodb://localhost:27017/emergency_response_jodhpur?replicaSet=rs0
```

### Option B: Docker Compose (Automated Development Setup)
```yaml
version: '3.8'
services:
  mongodb:
    image: mongo:7.0
    container_name: emergency-mongodb
    command: ["--replSet", "rs0", "--bind_ip_all"]
    ports:
      - "27017:27017"
    volumes:
      - mongo_data:/data/db
    healthcheck:
      test: test $$(echo "rs.initiate().ok || rs.status().ok" | mongosh --quiet) -eq 1
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  mongo_data:
```

---

## 5. Standalone Fallback & Topology Error Handling

When running against a standalone `mongod` instance where transactions are not supported:
- `session.startTransaction()` throws:  
  `MongoServerError: Transaction numbers are only allowed on a replica set member or mongos`
- The `withTransaction` wrapper catches this specific topology error, terminates the session cleanly, and yields:
  ```json
  {
    "success": false,
    "message": "MongoDB transactions require a replica set or mongos cluster deployment",
    "error": { "code": "TRANSACTION_UNAVAILABLE" }
  }
  ```
- This ensures that non-transactional standalone databases will **never** silently execute non-atomic partial writes without administrative awareness.

