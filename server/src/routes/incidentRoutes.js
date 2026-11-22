import { Router } from 'express';
import {
  createIncident,
  getIncidentById,
  verifyIncident,
  rejectIncident,
  getMyIncidents,
  listIncidents,
  getActiveIncidents,
  getIncidentStats,
  arriveIncident,
  resolveIncident,
  recordCallAttempt,
  getCallAttempts
} from '../controllers/incidentController.js';
import { authenticate, authorizeRoles } from '../middleware/auth.js';

const router = Router();

// CITIZEN Only: Submit emergency incident report
router.post('/', authenticate, authorizeRoles('CITIZEN'), createIncident);

// CITIZEN Only: View own submitted incident history
router.get('/my', authenticate, authorizeRoles('CITIZEN'), getMyIncidents);

// OPERATOR & ADMIN Only: Active incident tracking for dispatched and on-scene incidents
// (Mounted BEFORE /:incidentId to avoid string parameter collision)
router.get('/active', authenticate, authorizeRoles('OPERATOR', 'ADMIN'), getActiveIncidents);

// OPERATOR & ADMIN Only: Incident statistics & global aggregation for dashboard
// (Mounted BEFORE /:incidentId to avoid string parameter collision)
router.get('/stats', authenticate, authorizeRoles('OPERATOR', 'ADMIN'), getIncidentStats);

// OPERATOR & ADMIN Only: View all incoming reported incidents
router.get('/', authenticate, authorizeRoles('OPERATOR', 'ADMIN'), listIncidents);

// OPERATOR, ADMIN, or Incident Owner CITIZEN: View incident details
router.get('/:incidentId', authenticate, getIncidentById);

// OPERATOR & ADMIN Only: Verify reported incident (atomic concurrency protected)
router.patch('/:incidentId/verify', authenticate, authorizeRoles('OPERATOR', 'ADMIN'), verifyIncident);

// OPERATOR & ADMIN Only: Reject reported incident (atomic concurrency protected)
router.patch('/:incidentId/reject', authenticate, authorizeRoles('OPERATOR', 'ADMIN'), rejectIncident);

// OPERATOR & ADMIN Only: Mark emergency units as arrived on scene (DISPATCHED -> ON_SCENE)
router.patch('/:incidentId/arrive', authenticate, authorizeRoles('OPERATOR', 'ADMIN'), arriveIncident);

// OPERATOR & ADMIN Only: Mark individual resource arrived on scene
router.patch('/:incidentId/resources/:resourceId/arrive', authenticate, authorizeRoles('OPERATOR', 'ADMIN'), arriveIncident);

// OPERATOR & ADMIN Only: Call attempt tracking (manual phone calls)
router.post('/:incidentId/call-attempts', authenticate, authorizeRoles('OPERATOR', 'ADMIN'), recordCallAttempt);
router.get('/:incidentId/call-attempts', authenticate, authorizeRoles('OPERATOR', 'ADMIN'), getCallAttempts);

// OPERATOR & ADMIN Only: Resolve active incident and safely release resources & hospital capacity (ON_SCENE -> RESOLVED)
router.patch('/:incidentId/resolve', authenticate, authorizeRoles('OPERATOR', 'ADMIN'), resolveIncident);

export default router;
