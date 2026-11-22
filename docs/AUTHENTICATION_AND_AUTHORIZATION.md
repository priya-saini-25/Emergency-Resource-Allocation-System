# Authentication & Authorization Architecture
**Jodhpur Urban Service Area Simulation Proxy**  
**Document Version:** 1.0.0 (Phase 4.2 Specification)  
**Security Standard:** JWT (HS256) + Bcrypt Password Hashing  
**Runtime:** Node.js v24 (ESM), Express 4.x, Mongoose 9.x

---

## 1. Architectural Overview

The Emergency Resource Allocation & Response Management System implements a stateless, token-based authentication and role-based authorization (RBAC) architecture. It secures all municipal incident intake, operator surveillance, and administrative operations while guaranteeing clean separation between public citizens and privileged emergency responders.

```
+---------------------------------------------------------------------------------------------------+
|                                       Client (Browser / React)                                    |
+---------------------------------------------------------------------------------------------------+
       |                                       |                                      |
       | POST /api/auth/register               | POST /api/auth/login                 | Bearer JWT Request
       v                                       v                                      v
+---------------------------------------------------------------------------------------------------+
|                                    Express Routing & Middleware                                   |
|                                                                                                   |
|  +------------------------------+     +-------------------------------+    +-------------------+  |
|  |     Public Registration      |     |         Public Login          |    |   authenticate    |  |
|  | - Enforce CITIZEN role       |     | - Generic error messages      |    | - Verify JWT      |  |
|  | - Bcrypt 12 salt rounds      |     | - LastLoginAt timestamp       |    | - Check isActive  |  |
|  +------------------------------+     +-------------------------------+    +-------------------+  |
|                                                                                      |            |
|                                                                                      v            |
|                                                                            +-------------------+  |
|                                                                            |  authorizeRoles   |  |
|                                                                            | - Check RBAC role |  |
|                                                                            +-------------------+  |
+---------------------------------------------------------------------------------------------------+
                                                  |
                                                  v
                                    +---------------------------+
                                    |     MongoDB User Model    |
                                    | (passwordHash excluded)   |
                                    +---------------------------+
```

---

## 2. User Roles & Permission Hierarchy

The system defines three non-overlapping user roles stored in the `User` model:

| Role | Target Persona | Capabilities & Permissions | Restrictions |
|---|---|---|---|
| **`CITIZEN`** | General public in Jodhpur urban area | • Register via public API<br>• Authenticate via login<br>• Report emergencies (`POST /api/incidents`)<br>• View own reported history (`GET /api/incidents/my`) | • **Forbidden** from viewing other citizens' incidents<br>• **Forbidden** from operator dispatch registry (`GET /api/incidents`)<br>• Cannot self-escalate role |
| **`OPERATOR`** | Emergency dispatch control-room operator | • Authenticate via login<br>• View incoming emergency incident registry (`GET /api/incidents`)<br>• Filter incidents by category and triage status | • **Cannot** register through public API<br>• Restricted from administrative system configuration |
| **`ADMIN`** | System & municipal administrator | • Authenticate via login<br>• Full system audit and incident visibility<br>• Future node/hospital resource management | • **Cannot** register through public API<br>• Must be provisioned via controlled bootstrap |

---

## 3. Password Security & Cryptographic Hashing

To prevent credential compromise:
1. **Never Stored in Plaintext:** Passwords are never persisted, cached, or emitted in plain text.
2. **Work Factor:** Salted and hashed using `bcryptjs` with `BCRYPT_SALT_ROUNDS` (default: `12`).
3. **Database Projection Exclusion:** The `passwordHash` field in `User.js` is defined with `select: false`. Standard Mongoose queries (`find`, `findById`) omit the hash automatically unless explicitly requested via `.select('+passwordHash')`.
4. **Serialization Safety:** Both `toJSON()` and `toSafeObject()` transforms delete `passwordHash` and `__v` prior to client serialization.
5. **Password Complexity:** Enforces minimum 8 characters with at least one letter and one numeral.

---

## 4. JWT Architecture & Lifecycle

Tokens are generated and verified via `server/src/utils/jwt.js`:

- **Algorithm:** HMAC-SHA256 (`HS256`).
- **Signature Secret:** Configured via `JWT_SECRET` environment variable (minimum 32 characters in production).
- **Token Lifespan:** Configured via `JWT_EXPIRES_IN` (default: `'24h'`).
- **Payload Claims:**
  ```json
  {
    "id": "507f1f77bcf86cd799439011",
    "role": "CITIZEN",
    "iat": 1700000000,
    "exp": 1700086400
  }
  ```
- **Privacy Assurance:** Tokens never contain passwords, password hashes, email addresses, or personally identifiable information (PII).

---

## 5. Authentication & Authorization Middleware

### 5.1 `authenticate` Middleware (`server/src/middleware/auth.js`)
1. Reads `Authorization` header from incoming HTTP request.
2. Enforces `Bearer <token>` format. Missing or malformed headers return HTTP `401 UNAUTHORIZED` or `MALFORMED_AUTH_HEADER`.
3. Verifies token signature and expiration. Expired tokens return HTTP `401 TOKEN_EXPIRED`; invalid tokens return HTTP `401 INVALID_TOKEN`.
4. Inspects MongoDB database connection. If disconnected, gracefully returns HTTP `503 DATABASE_UNAVAILABLE`.
5. Loads user document by ID; confirms user exists and `isActive === true`. Deactivated accounts return HTTP `401 ACCOUNT_INACTIVE`.
6. Attaches `req.user` (safe user instance) and `req.userId` (string ID) to request.

### 5.2 `authorizeRoles(...allowedRoles)` Middleware
Factory returning an Express middleware function:
1. Verifies that `req.user` is present (returns HTTP `401 UNAUTHORIZED` if absent).
2. Verifies that `allowedRoles.includes(req.user.role)`.
3. If unauthorized, halts the chain and returns HTTP `403 FORBIDDEN` with required roles in error details.

---

## 6. Privileged Account Provisioning (Seed Bootstrapping)

Public registration (`POST /api/auth/register`) **strictly forces the `CITIZEN` role**; any `role` supplied in the client request body is discarded.

To provision the initial `ADMIN` and `OPERATOR` accounts securely:
1. **Idempotent Bootstrapper (`server/src/utils/bootstrapAdmin.js`):**
   - Reads credentials from environment variables:
     - `ADMIN_INITIAL_EMAIL` (default: `admin@jodhpur.emergency.gov.in`)
     - `ADMIN_INITIAL_PASSWORD` (default: `AdminJodhpur2026!`)
     - `OPERATOR_INITIAL_EMAIL` (default: `operator@jodhpur.emergency.gov.in`)
     - `OPERATOR_INITIAL_PASSWORD` (default: `OperatorJodhpur2026!`)
   - Checks if an account with that email already exists in MongoDB.
   - If missing, securely hashes the password with bcrypt and creates the account with role `ADMIN` or `OPERATOR`.
   - If present, safely skips recreation without errors.
2. **Automated Server Hook:** Invoked during server startup in `server/src/server.js` when database connectivity is established.
3. **Standalone CLI Script:**
   ```bash
   node server/scripts/bootstrapPrivilegedUsers.js
   ```

---

## 7. API Endpoints Specification

### 7.1 Public Registration
- **Endpoint:** `POST /api/auth/register`
- **Access:** Public (Unauthenticated)
- **Request Body:**
  ```json
  {
    "name": "Jane Citizen",
    "email": "jane.citizen@example.com",
    "password": "SecurePassword123!"
  }
  ```
- **Responses:**
  - `201 Created`:
    ```json
    {
      "success": true,
      "message": "Citizen account registered successfully",
      "data": {
        "user": {
          "id": "607f1f77bcf86cd799439011",
          "name": "Jane Citizen",
          "email": "jane.citizen@example.com",
          "role": "CITIZEN",
          "createdAt": "2026-11-18T00:45:00.000Z"
        }
      }
    }
    ```
  - `400 Bad Request`: Invalid name, malformed email, or weak password.
  - `409 Conflict`: Duplicate email (`DUPLICATE_EMAIL`).
  - `503 Service Unavailable`: Database disconnected.

### 7.2 Public Login
- **Endpoint:** `POST /api/auth/login`
- **Access:** Public (Unauthenticated)
- **Request Body:**
  ```json
  {
    "email": "jane.citizen@example.com",
    "password": "SecurePassword123!"
  }
  ```
- **Responses:**
  - `200 OK`:
    ```json
    {
      "success": true,
      "message": "Login successful",
      "data": {
        "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
        "user": {
          "id": "607f1f77bcf86cd799439011",
          "name": "Jane Citizen",
          "email": "jane.citizen@example.com",
          "role": "CITIZEN",
          "lastLoginAt": "2026-11-18T00:46:00.000Z"
        }
      }
    }
    ```
  - `401 Unauthorized`: Invalid email or password (`INVALID_CREDENTIALS`).
  - `403 Forbidden`: Account deactivated (`ACCOUNT_DEACTIVATED`).
  - `503 Service Unavailable`: Database disconnected.

### 7.3 Current User Profile
- **Endpoint:** `GET /api/auth/me`
- **Access:** Authenticated (Any role)
- **Headers:** `Authorization: Bearer <token>`
- **Response `200 OK`:**
  ```json
  {
    "success": true,
    "message": "Current user profile retrieved successfully",
    "data": {
      "user": {
        "id": "607f1f77bcf86cd799439011",
        "name": "Jane Citizen",
        "email": "jane.citizen@example.com",
        "role": "CITIZEN",
        "isActive": true,
        "lastLoginAt": "2026-11-18T00:46:00.000Z"
      }
    }
  }
  ```

---

## 8. Academic Simulation Disclaimer

> [!NOTE]
> All user accounts, authentication tokens, and operator permissions operate within an **academic decision-support simulation** context for the Jodhpur Urban Service Area (Rajasthan, India). This system does not connect to or administer real-world government emergency dispatch databases.

