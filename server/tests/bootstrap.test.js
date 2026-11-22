process.env.NODE_ENV = 'test';
import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import User from '../src/models/User.js';
import { bootstrapPrivilegedUsers } from '../src/utils/bootstrapAdmin.js';

describe('Privileged User Bootstrapping Unit Tests', () => {
  it('should provision initial ADMIN and OPERATOR accounts if they do not exist', async () => {
    const createdUsers = [];

    // Mock User.findOne to return null (users do not exist initially)
    const origFindOne = User.findOne;
    const origCreate = User.create;

    User.findOne = async () => null;
    User.create = async (doc) => {
      createdUsers.push(doc);
      return doc;
    };

    try {
      const result = await bootstrapPrivilegedUsers();

      assert.equal(result.adminCreated, true, 'Admin should be created on first run');
      assert.equal(result.operatorCreated, true, 'Operator should be created on first run');
      assert.equal(createdUsers.length, 2, 'Two accounts should be created');

      const adminUser = createdUsers.find((u) => u.role === 'ADMIN');
      assert.ok(adminUser);
      assert.ok(adminUser.passwordHash.startsWith('$2'), 'Admin password must be hashed with bcrypt');
      assert.equal(adminUser.isActive, true);

      const opUser = createdUsers.find((u) => u.role === 'OPERATOR');
      assert.ok(opUser);
      assert.ok(opUser.passwordHash.startsWith('$2'), 'Operator password must be hashed with bcrypt');
      assert.equal(opUser.isActive, true);
    } finally {
      User.findOne = origFindOne;
      User.create = origCreate;
    }
  });

  it('should be strictly idempotent and skip provisioning if accounts already exist', async () => {
    const createdUsers = [];

    // Mock User.findOne to return existing record
    const origFindOne = User.findOne;
    const origCreate = User.create;

    User.findOne = async ({ email }) => ({ email, role: 'MOCK' });
    User.create = async (doc) => {
      createdUsers.push(doc);
      return doc;
    };

    try {
      const result = await bootstrapPrivilegedUsers();

      assert.equal(result.adminCreated, false, 'Admin should NOT be recreated');
      assert.equal(result.operatorCreated, false, 'Operator should NOT be recreated');
      assert.equal(createdUsers.length, 0, 'No users should be created on repeated runs');
    } finally {
      User.findOne = origFindOne;
      User.create = origCreate;
    }
  });
});

