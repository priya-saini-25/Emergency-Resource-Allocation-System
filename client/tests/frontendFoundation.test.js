process.env.NODE_ENV = 'test';
import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  THEME_COLORS,
  EMERGENCY_COLORS,
  INCIDENT_STATUSES,
  SEVERITY_LEVELS,
  USER_ROLES,
} from '../src/styles/tokens.js';
import {
  JODHPUR_COORDINATES,
  OSM_TILE_LAYER,
  JODHPUR_BOUNDING_BOX,
} from '../src/config/geoConfig.js';
import apiClient from '../src/services/apiClient.js';
import authService from '../src/services/authService.js';
import incidentService from '../src/services/incidentService.js';
import dispatchService from '../src/services/dispatchService.js';

describe('Phase 5.1 — Frontend Foundation & Design System Verification', () => {
  describe('1. Slate x Ice Blue Design System Tokens', () => {
    it('should declare exact required theme color tokens', () => {
      assert.equal(THEME_COLORS.mainBg, '#F4F6F8');
      assert.equal(THEME_COLORS.sidebar, '#252F3B');
      assert.equal(THEME_COLORS.cards, '#FFFFFF');
      assert.equal(THEME_COLORS.secondaryBg, '#E8EDF2');
      assert.equal(THEME_COLORS.primaryAccent, '#789CB8');
      assert.equal(THEME_COLORS.secondaryAccent, '#B6CAD9');
      assert.equal(THEME_COLORS.headings, '#27313D');
      assert.equal(THEME_COLORS.borders, '#D9E0E7');
    });

    it('should declare exact emergency operational status colors', () => {
      assert.equal(EMERGENCY_COLORS.critical, '#DC4545');
      assert.equal(EMERGENCY_COLORS.high, '#E89543');
      assert.equal(EMERGENCY_COLORS.medium, '#D5B34F');
      assert.equal(EMERGENCY_COLORS.available, '#56866B');
      assert.equal(EMERGENCY_COLORS.dispatched, '#5685B5');
    });

    it('should define all standardized incident lifecycle statuses', () => {
      const expectedStatuses = ['REPORTED', 'VERIFIED', 'DISPATCHED', 'ON_SCENE', 'RESOLVED', 'REJECTED'];
      for (const st of expectedStatuses) {
        assert.ok(INCIDENT_STATUSES[st], `Status ${st} must be defined`);
        assert.ok(INCIDENT_STATUSES[st].label);
        assert.ok(INCIDENT_STATUSES[st].bg);
        assert.ok(INCIDENT_STATUSES[st].textColor);
      }
    });

    it('should define 5-tier priority levels aligned with C++ priority engine', () => {
      for (let i = 1; i <= 5; ++i) {
        assert.ok(SEVERITY_LEVELS[i], `Severity level ${i} must be defined`);
        assert.ok(SEVERITY_LEVELS[i].label);
        assert.ok(SEVERITY_LEVELS[i].color);
      }
    });

    it('should enforce three-tier user roles', () => {
      assert.deepEqual(USER_ROLES, {
        CITIZEN: 'CITIZEN',
        OPERATOR: 'OPERATOR',
        ADMIN: 'ADMIN',
      });
    });
  });

  describe('2. Canonical Jodhpur Geographic Configuration', () => {
    it('should center map precisely on Jodhpur coordinates', () => {
      assert.equal(JODHPUR_COORDINATES.center[0], 26.2918);
      assert.equal(JODHPUR_COORDINATES.center[1], 73.0168);
      assert.equal(JODHPUR_COORDINATES.defaultZoom, 13);
    });

    it('should specify OpenStreetMap tile layer and attribution', () => {
      assert.equal(OSM_TILE_LAYER.url, 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png');
      assert.ok(OSM_TILE_LAYER.attribution.includes('OpenStreetMap'));
    });

    it('should match canonical urban service bounding box', () => {
      assert.equal(JODHPUR_BOUNDING_BOX.minLng, 72.9485753);
      assert.equal(JODHPUR_BOUNDING_BOX.minLat, 26.2059842);
      assert.equal(JODHPUR_BOUNDING_BOX.maxLng, 73.0888716);
      assert.equal(JODHPUR_BOUNDING_BOX.maxLat, 26.3536661);
    });
  });

  describe('3. API Client & Service Contract Definitions', () => {
    it('should configure Axios client with 15000ms timeout ceiling', () => {
      assert.equal(apiClient.defaults.timeout, 15000);
      assert.equal(apiClient.defaults.headers['Content-Type'], 'application/json');
    });

    it('should export all required methods on authService', () => {
      assert.equal(typeof authService.login, 'function');
      assert.equal(typeof authService.register, 'function');
      assert.equal(typeof authService.getMe, 'function');
    });

    it('should export all required methods on incidentService', () => {
      assert.equal(typeof incidentService.createIncident, 'function');
      assert.equal(typeof incidentService.getMyIncidents, 'function');
      assert.equal(typeof incidentService.listIncidents, 'function');
      assert.equal(typeof incidentService.getIncidentStats, 'function');
      assert.equal(typeof incidentService.getIncidentById, 'function');
      assert.equal(typeof incidentService.verifyIncident, 'function');
      assert.equal(typeof incidentService.rejectIncident, 'function');
      assert.equal(typeof incidentService.getActiveIncidents, 'function');
      assert.equal(typeof incidentService.markArrived, 'function');
      assert.equal(typeof incidentService.resolveIncident, 'function');
    });

    it('should export all required methods on dispatchService', () => {
      assert.equal(typeof dispatchService.generateRecommendations, 'function');
      assert.equal(typeof dispatchService.getRecommendation, 'function');
      assert.equal(typeof dispatchService.listRecommendations, 'function');
      assert.equal(typeof dispatchService.confirmDispatch, 'function');
      assert.equal(typeof dispatchService.getDispatch, 'function');
      assert.equal(typeof dispatchService.listDispatches, 'function');
    });
  });
});

