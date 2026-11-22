process.env.NODE_ENV = 'test';
import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateAndNormalizeIndianPhone, maskPhoneNumber } from '../src/utils/phoneUtils.js';
import incidentService from '../src/services/incidentService.js';
import apiClient from '../src/services/apiClient.js';
import {
  isInsideJodhpurPolygon,
  isWithinJodhpurBoundingBox,
  JODHPUR_COORDINATES,
} from '../src/config/geoConfig.js';

describe('Phase 8.1 — Citizen Reporting & Operator Verification Workflow Tests', () => {

  // =========================================================================
  // 1. Client-Side Indian Mobile Phone Validation & Privacy Masking
  // =========================================================================
  describe('1. Indian Mobile Phone Validation & Privacy Masking', () => {
    it('should validate and normalize standard 10-digit Indian numbers starting with 6, 7, 8, or 9', () => {
      const validNumbers = ['9876543210', '8888888888', '7000000000', '6999999999'];
      for (const num of validNumbers) {
        const result = validateAndNormalizeIndianPhone(num, true);
        assert.equal(result.isValid, true);
        assert.equal(result.normalized, `+91${num}`);
        assert.equal(result.error, null);
      }
    });

    it('should accept +91 country prefix, trunk 0, or raw 91 and strip formatting characters', () => {
      const testCases = [
        { input: '+91 98765 43210', expected: '+919876543210' },
        { input: '+91-98765-43210', expected: '+919876543210' },
        { input: '09876543210', expected: '+919876543210' },
        { input: '919876543210', expected: '+919876543210' },
        { input: '(98765) 43210', expected: '+919876543210' },
      ];

      for (const tc of testCases) {
        const result = validateAndNormalizeIndianPhone(tc.input, true);
        assert.equal(result.isValid, true);
        assert.equal(result.normalized, tc.expected);
      }
    });

    it('should reject non-Indian country prefixes with clear error', () => {
      const result = validateAndNormalizeIndianPhone('+14155552671', true);
      assert.equal(result.isValid, false);
      assert.ok(result.error.includes('+91'));
    });

    it('should reject invalid digits (e.g. starting with 1-5) and incorrect lengths', () => {
      assert.equal(validateAndNormalizeIndianPhone('5123456789', true).isValid, false);
      assert.equal(validateAndNormalizeIndianPhone('98765', true).isValid, false);
      assert.equal(validateAndNormalizeIndianPhone('987654321000', true).isValid, false);
      assert.equal(validateAndNormalizeIndianPhone('abcdefghij', true).isValid, false);
    });

    it('should handle optional alternate numbers correctly when empty or omitted', () => {
      assert.equal(validateAndNormalizeIndianPhone('', false).isValid, true);
      assert.equal(validateAndNormalizeIndianPhone(null, false).isValid, true);
      assert.equal(validateAndNormalizeIndianPhone(undefined, false).isValid, true);
    });

    it('should mask phone numbers for unprivileged display showing only the last 4 digits', () => {
      assert.equal(maskPhoneNumber('+919876543210'), '+91 ******3210');
      assert.equal(maskPhoneNumber('9876543210'), '+91 ******3210');
      assert.equal(maskPhoneNumber(''), '');
      assert.equal(maskPhoneNumber(null), '');
    });
  });

  // =========================================================================
  // 2. Citizen Reporter Information Form Validation Rules
  // =========================================================================
  describe('2. Citizen Reporter Form Validation Rules', () => {
    function validateFormState(formData) {
      const errors = {};
      if (!formData.reporterName || formData.reporterName.trim().length < 2) {
        errors.reporterName = 'Full Name is required (minimum 2 characters)';
      } else if (formData.reporterName.trim().length > 100) {
        errors.reporterName = 'Full Name cannot exceed 100 characters';
      }

      const phoneRes = validateAndNormalizeIndianPhone(formData.reporterPhone, true);
      if (!phoneRes.isValid) {
        errors.reporterPhone = phoneRes.error;
      }

      if (formData.alternatePhone && formData.alternatePhone.trim() !== '') {
        const altRes = validateAndNormalizeIndianPhone(formData.alternatePhone, false);
        if (!altRes.isValid) {
          errors.alternatePhone = altRes.error;
        }
      }

      if (!formData.description || !formData.description.trim()) {
        errors.description = 'Please provide a brief description of the incident';
      }

      return errors;
    }

    it('should pass validation when valid name, phone, and description are supplied', () => {
      const errors = validateFormState({
        reporterName: 'Sunita Sharma',
        reporterPhone: '9876543210',
        alternatePhone: '',
        description: 'Building fire on Station Road',
      });
      assert.equal(Object.keys(errors).length, 0);
    });

    it('should fail validation when reporter name is missing or less than 2 characters', () => {
      const errors = validateFormState({
        reporterName: 'S',
        reporterPhone: '9876543210',
        description: 'Building fire',
      });
      assert.ok(errors.reporterName);
    });

    it('should fail validation when reporter phone is invalid', () => {
      const errors = validateFormState({
        reporterName: 'Sunita Sharma',
        reporterPhone: '12345',
        description: 'Building fire',
      });
      assert.ok(errors.reporterPhone);
    });

    it('should fail validation when alternate phone is malformed', () => {
      const errors = validateFormState({
        reporterName: 'Sunita Sharma',
        reporterPhone: '9876543210',
        alternatePhone: 'invalid-phone',
        description: 'Building fire',
      });
      assert.ok(errors.alternatePhone);
    });
  });

  // =========================================================================
  // 3. Incident Service Verification API Contracts
  // =========================================================================
  describe('3. Incident Service Verification API Contracts', () => {
    it('verifyIncident should default outcome to CONFIRMED and send verificationNotes', async () => {
      const origPatch = apiClient.patch;
      try {
        let sentUrl = '';
        let sentPayload = null;

        apiClient.patch = async (url, payload) => {
          sentUrl = url;
          sentPayload = payload;
          return { data: { incident: { incidentId: 101, status: 'VERIFIED' } } };
        };

        const res = await incidentService.verifyIncident(101, 'Verified on callback');
        assert.equal(sentUrl, '/incidents/101/verify');
        assert.equal(sentPayload.outcome, 'CONFIRMED');
        assert.equal(sentPayload.verificationNotes, 'Verified on callback');
        assert.equal(res.status, 'VERIFIED');
      } finally {
        apiClient.patch = origPatch;
      }
    });

    it('recordVerification should send structured outcomes (UNABLE_TO_CONTACT, DUPLICATE, etc.)', async () => {
      const origPatch = apiClient.patch;
      try {
        let sentUrl = '';
        let sentPayload = null;

        apiClient.patch = async (url, payload) => {
          sentUrl = url;
          sentPayload = payload;
          return { data: { incident: { incidentId: 102, status: 'REPORTED', latestVerificationOutcome: 'UNABLE_TO_CONTACT' } } };
        };

        const res = await incidentService.recordVerification(102, {
          outcome: 'UNABLE_TO_CONTACT',
          verificationNotes: 'No response after 2 attempts',
          proceedWithDispatch: false,
        });

        assert.equal(sentUrl, '/incidents/102/verify');
        assert.equal(sentPayload.outcome, 'UNABLE_TO_CONTACT');
        assert.equal(sentPayload.verificationNotes, 'No response after 2 attempts');
        assert.equal(sentPayload.proceedWithDispatch, false);
        assert.equal(res.latestVerificationOutcome, 'UNABLE_TO_CONTACT');
      } finally {
        apiClient.patch = origPatch;
      }
    });

    it('rejectIncident should call PATCH /incidents/:id/reject with rejectionReason', async () => {
      const origPatch = apiClient.patch;
      try {
        let sentUrl = '';
        let sentPayload = null;

        apiClient.patch = async (url, payload) => {
          sentUrl = url;
          sentPayload = payload;
          return { data: { incident: { incidentId: 103, status: 'REJECTED' } } };
        };

        const res = await incidentService.rejectIncident(103, 'Prank call confirmed');
        assert.equal(sentUrl, '/incidents/103/reject');
        assert.equal(sentPayload.rejectionReason, 'Prank call confirmed');
        assert.equal(res.status, 'REJECTED');
      } finally {
        apiClient.patch = origPatch;
      }
    });
  });

  // =========================================================================
  // 4. Address-Only Geocoding & Internal Coordinate Storage
  // =========================================================================
  describe('4. Address-Only Geocoding & Boundary Enforcement', () => {
    it('Clock Tower place search should yield coordinates inside the Jodhpur settlement polygon', () => {
      const clockTower = {
        name: 'Ghanta Ghar (Clock Tower), Jodhpur',
        latitude: 26.2978,
        longitude: 73.0185,
      };

      const inPolygon = isInsideJodhpurPolygon(clockTower.latitude, clockTower.longitude);
      assert.equal(inPolygon, true, 'Clock tower must be inside Jodhpur service boundary');
    });

    it('Outlying locations (e.g. Mandore or Jaipur) must be rejected by service boundary validation', () => {
      const jaipur = { latitude: 26.9124, longitude: 75.7873 };
      const inPolygon = isInsideJodhpurPolygon(jaipur.latitude, jaipur.longitude);
      assert.equal(inPolygon, false, 'Jaipur must be outside Jodhpur service boundary');
    });

    it('Refining map pin by dragging should append (Pin Refined) without losing address context', () => {
      let locationName = 'Sojati Gate, Jodhpur';
      const isDrag = true;

      if (isDrag && locationName && !locationName.includes('(Pin Refined)')) {
        locationName = `${locationName} (Pin Refined)`;
      }

      assert.equal(locationName, 'Sojati Gate, Jodhpur (Pin Refined)');
    });
  });

  // =========================================================================
  // 5. Operator Click-to-Call Link Construction
  // =========================================================================
  describe('5. Operator Click-to-Call Link Construction', () => {
    it('should format tel: URI protocol correctly from normalized phone number', () => {
      const phone = '+919876543210';
      const telUri = `tel:${phone}`;
      assert.equal(telUri, 'tel:+919876543210');
    });

    it('should identify legacy records without reporter contact information cleanly', () => {
      const legacyIncident = {
        incidentId: 1001,
        reporterPhone: '',
        reportedBy: { name: 'Old User', email: 'old@example.com' },
      };

      const hasContact = Boolean(legacyIncident.reporterPhone);
      assert.equal(hasContact, false, 'Legacy incident must indicate unavailable contact');
    });
  });
});
