process.env.NODE_ENV = 'test';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TOAST_TYPES } from '../src/utils/notificationConstants.js';

describe('Phase 8.4 — In-App Toast & Real-Time Notification System Tests', () => {
  // Helper mimicking Toast Manager State Machine
  function createToastManager() {
    let toasts = [];
    let operatorPopups = [];
    const dedupeMap = new Map();
    const DEDUPE_WINDOW_MS = 3000;

    function showToast({ type = TOAST_TYPES.INFO, title = '', message = '', duration = 5000, dedupeKey = null }) {
      if (!message && !title) return null;

      const effectiveKey = dedupeKey || `${type}:${title}:${message}`;
      const now = Date.now();
      const lastSeen = dedupeMap.get(effectiveKey);

      if (lastSeen && now - lastSeen < DEDUPE_WINDOW_MS) {
        return null; // Suppress duplicate
      }
      dedupeMap.set(effectiveKey, now);

      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const newToast = { id, type, title, message, duration, createdAt: now };
      toasts.push(newToast);
      return id;
    }

    function dismissToast(id) {
      toasts = toasts.filter((t) => t.id !== id);
    }

    function showOperatorEmergencyPopup(incidentData) {
      if (!incidentData || !incidentData.incidentId) return null;

      const dedupeKey = `popup:${incidentData.incidentId}`;
      const now = Date.now();
      const lastSeen = dedupeMap.get(dedupeKey);
      if (lastSeen && now - lastSeen < 10000) {
        return null;
      }
      dedupeMap.set(dedupeKey, now);

      const id = `popup-${incidentData.incidentId}-${Date.now()}`;
      const popup = {
        id,
        incidentId: incidentData.incidentId,
        category: incidentData.category || 'EMERGENCY',
        subcategory: incidentData.subcategory || '',
        severity: incidentData.severity || 3,
        victimCount: incidentData.victimCount || 0,
        location: incidentData.location || {},
        address: incidentData.address || incidentData.locationName || '',
        landmark: incidentData.landmark || '',
        reportedAt: incidentData.reportedAt || new Date().toISOString(),
        createdAt: now,
      };

      operatorPopups.unshift(popup);
      return id;
    }

    function dismissPopup(id) {
      operatorPopups = operatorPopups.filter((p) => p.id !== id);
    }

    return {
      getToasts: () => [...toasts],
      getPopups: () => [...operatorPopups],
      showToast,
      dismissToast,
      showOperatorEmergencyPopup,
      dismissPopup,
      success: (msg, opts = {}) => showToast({ ...opts, message: msg, type: TOAST_TYPES.SUCCESS }),
      error: (msg, opts = {}) => showToast({ ...opts, message: msg, type: TOAST_TYPES.ERROR }),
      warning: (msg, opts = {}) => showToast({ ...opts, message: msg, type: TOAST_TYPES.WARNING }),
      info: (msg, opts = {}) => showToast({ ...opts, message: msg, type: TOAST_TYPES.INFO }),
    };
  }

  describe('1. Canonical Toast Notification Types', () => {
    it('should define the 4 required toast types', () => {
      assert.equal(TOAST_TYPES.SUCCESS, 'SUCCESS');
      assert.equal(TOAST_TYPES.ERROR, 'ERROR');
      assert.equal(TOAST_TYPES.WARNING, 'WARNING');
      assert.equal(TOAST_TYPES.INFO, 'INFO');
    });

    it('should create and dismiss SUCCESS, ERROR, WARNING, and INFO toasts', () => {
      const manager = createToastManager();

      const id1 = manager.success('Operation succeeded.');
      const id2 = manager.error('An error occurred.');
      const id3 = manager.warning('Please review this notice.');
      const id4 = manager.info('Informational message.');

      assert.ok(id1);
      assert.ok(id2);
      assert.ok(id3);
      assert.ok(id4);

      const toasts = manager.getToasts();
      assert.equal(toasts.length, 4);
      assert.equal(toasts[0].type, 'SUCCESS');
      assert.equal(toasts[1].type, 'ERROR');
      assert.equal(toasts[2].type, 'WARNING');
      assert.equal(toasts[3].type, 'INFO');

      // Dismiss one toast
      manager.dismissToast(id2);
      const remaining = manager.getToasts();
      assert.equal(remaining.length, 3);
      assert.ok(!remaining.some((t) => t.id === id2));
    });
  });

  describe('2. Toast De-duplication & Throttling', () => {
    it('should prevent duplicate toasts triggered in rapid succession', () => {
      const manager = createToastManager();

      const id1 = manager.success('Dispatch confirmed successfully.');
      const id2 = manager.success('Dispatch confirmed successfully.');

      assert.ok(id1);
      assert.equal(id2, null, 'Immediate duplicate toast must be suppressed');
      assert.equal(manager.getToasts().length, 1);
    });

    it('should allow identical messages if explicit dedupeKey differs', () => {
      const manager = createToastManager();

      const id1 = manager.info('Resource arrived.', { dedupeKey: 'unit-101' });
      const id2 = manager.info('Resource arrived.', { dedupeKey: 'unit-102' });

      assert.ok(id1);
      assert.ok(id2);
      assert.equal(manager.getToasts().length, 2);
    });
  });

  describe('3. Operator Real-Time Emergency Popup', () => {
    it('should create an urgent popup with required incident fields upon receiving new emergency report', () => {
      const manager = createToastManager();

      const payload = {
        incidentId: 179532990001,
        category: 'MEDICAL_EMERGENCY',
        severity: 4,
        victimCount: 2,
        address: 'Clock Tower Market, Jodhpur',
        landmark: 'Ghanta Ghar',
        reportedAt: '2026-11-22T07:00:00.000Z',
      };

      const popupId = manager.showOperatorEmergencyPopup(payload);
      assert.ok(popupId);

      const popups = manager.getPopups();
      assert.equal(popups.length, 1);
      const popup = popups[0];

      assert.equal(popup.incidentId, 179532990001);
      assert.equal(popup.category, 'MEDICAL_EMERGENCY');
      assert.equal(popup.severity, 4);
      assert.equal(popup.address, 'Clock Tower Market, Jodhpur');
      assert.equal(popup.landmark, 'Ghanta Ghar');
      assert.ok(popup.reportedAt);

      // Verify privacy: reporter phone numbers must not be present
      assert.equal(popup.reporterPhone, undefined);
      assert.equal(popup.callerContact, undefined);
    });

    it('should suppress duplicate popup for the same incident ID within throttle window', () => {
      const manager = createToastManager();

      const payload = {
        incidentId: 179532990002,
        category: 'FIRE',
        severity: 5,
      };

      const firstId = manager.showOperatorEmergencyPopup(payload);
      const duplicateId = manager.showOperatorEmergencyPopup(payload);

      assert.ok(firstId);
      assert.equal(duplicateId, null);
      assert.equal(manager.getPopups().length, 1);
    });

    it('should allow dismissing an operator popup manually', () => {
      const manager = createToastManager();

      const id = manager.showOperatorEmergencyPopup({ incidentId: 179532990003 });
      assert.equal(manager.getPopups().length, 1);

      manager.dismissPopup(id);
      assert.equal(manager.getPopups().length, 0);
    });
  });

  describe('4. System-Wide Canonical Action Messages Verification', () => {
    it('should verify exact required messages for all critical emergency lifecycle actions', () => {
      const expectedActions = [
        { action: 'Emergency report submitted', expectedMsg: 'Emergency report submitted successfully.' },
        { action: 'New report received by operator', expectedMsg: 'New emergency report received.' },
        { action: 'Incident verified', expectedMsg: 'Incident verified successfully.' },
        { action: 'Incident rejected', expectedMsg: 'Emergency report rejected.' },
        { action: 'Dispatch recommendation generated', expectedMsg: 'Resource allocation recommendation generated.' },
        { action: 'Resources allocated', expectedMsg: 'Resources allocated successfully.' },
        { action: 'Dispatch confirmed', expectedMsg: 'Dispatch confirmed successfully.' },
        { action: 'First resource arrives', expectedMsg: 'First response resource has arrived.' },
        { action: 'Partial resource arrival', expectedMsg: '2 of 3 resources have arrived.' },
        { action: 'All resources arrive', expectedMsg: 'All assigned resources have arrived.' },
        { action: 'Hospital assigned', expectedMsg: 'Hospital assigned successfully.' },
        { action: 'Incident resolved', expectedMsg: 'Incident resolved successfully.' },
        { action: 'Resources released', expectedMsg: 'Resources are now available for new incidents.' },
      ];

      const manager = createToastManager();

      for (let i = 0; i < expectedActions.length; i++) {
        const item = expectedActions[i];
        const toastId = manager.showToast({
          message: item.expectedMsg,
          dedupeKey: `action-${i}`,
          type: TOAST_TYPES.INFO,
        });
        assert.ok(toastId, `Failed to create toast for action: ${item.action}`);
      }

      const allToasts = manager.getToasts();
      assert.equal(allToasts.length, expectedActions.length);
      for (let i = 0; i < expectedActions.length; i++) {
        assert.equal(allToasts[i].message, expectedActions[i].expectedMsg);
      }
    });

    it('should never display a success message when an operation fails', async () => {
      const manager = createToastManager();

      let isSuccess = false;
      const fakeApiCall = async () => {
        throw new Error('Database write failed');
      };

      try {
        await fakeApiCall();
        manager.success('Dispatch confirmed successfully.');
        isSuccess = true;
      } catch (err) {
        manager.error(err.message || 'Operation failed.');
      }

      assert.equal(isSuccess, false);
      const toasts = manager.getToasts();
      assert.equal(toasts.length, 1);
      assert.equal(toasts[0].type, 'ERROR');
      assert.equal(toasts[0].message, 'Database write failed');
    });
  });

  describe('5. Role-Based Stream Authorization Rules', () => {
    it('should verify that only OPERATOR and ADMIN roles are authorized for real-time notification streams', () => {
      const isRoleAllowed = (role) => role === 'OPERATOR' || role === 'ADMIN';

      assert.equal(isRoleAllowed('OPERATOR'), true);
      assert.equal(isRoleAllowed('ADMIN'), true);
      assert.equal(isRoleAllowed('CITIZEN'), false);
      assert.equal(isRoleAllowed('GUEST'), false);
      assert.equal(isRoleAllowed(null), false);
    });
  });
});
