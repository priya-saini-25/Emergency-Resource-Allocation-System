import { useState, useCallback } from 'react';
import incidentService from '../services/incidentService.js';

/**
 * Custom hook to execute operator incident verification and rejection actions.
 * Guarantees single-flight concurrency lockout, client-side reason validation,
 * and 409 state conflict error normalization.
 */
export function useIncidentVerification() {
  const [isActionPending, setIsActionPending] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [actionSuccess, setActionSuccess] = useState(null);

  /**
   * Verify an incident in REPORTED status.
   * @param {number|string} incidentId
   * @param {string} [verificationNotes='']
   */
  const verify = useCallback(async (incidentId, verificationNotes = '') => {
    setIsActionPending(true);
    setActionError(null);
    setActionSuccess(null);

    const cleanNotes = typeof verificationNotes === 'string' ? verificationNotes.trim() : '';
    if (cleanNotes.length > 1000) {
      const err = {
        code: 'VERIFICATION_NOTES_TOO_LONG',
        message: 'Verification notes cannot exceed 1000 characters',
        status: 400,
      };
      setActionError(err);
      setIsActionPending(false);
      throw err;
    }

    try {
      const updatedIncident = await incidentService.verifyIncident(incidentId, cleanNotes);
      setActionSuccess({
        action: 'VERIFIED',
        incidentId,
        incident: updatedIncident,
        message: `Incident #${incidentId} has been successfully verified.`,
      });
      setIsActionPending(false);
      return updatedIncident;
    } catch (err) {
      setActionError(err);
      setIsActionPending(false);
      throw err;
    }
  }, []);

  /**
   * Reject an incident in REPORTED status with mandatory reason.
   * @param {number|string} incidentId
   * @param {string} rejectionReason - Required minimum 3 characters, max 1000.
   */
  const reject = useCallback(async (incidentId, rejectionReason) => {
    setIsActionPending(true);
    setActionError(null);
    setActionSuccess(null);

    const cleanReason = typeof rejectionReason === 'string' ? rejectionReason.trim() : '';

    if (!cleanReason || cleanReason.length < 3) {
      const err = {
        code: 'INVALID_REJECTION_REASON',
        message: 'A rejection reason of at least 3 characters is required',
        status: 400,
      };
      setActionError(err);
      setIsActionPending(false);
      throw err;
    }

    if (cleanReason.length > 1000) {
      const err = {
        code: 'REJECTION_REASON_TOO_LONG',
        message: 'Rejection reason cannot exceed 1000 characters',
        status: 400,
      };
      setActionError(err);
      setIsActionPending(false);
      throw err;
    }

    try {
      const updatedIncident = await incidentService.rejectIncident(incidentId, cleanReason);
      setActionSuccess({
        action: 'REJECTED',
        incidentId,
        incident: updatedIncident,
        message: `Incident #${incidentId} has been marked as rejected.`,
      });
      setIsActionPending(false);
      return updatedIncident;
    } catch (err) {
      setActionError(err);
      setIsActionPending(false);
      throw err;
    }
  }, []);

  const resetActionState = useCallback(() => {
    setIsActionPending(false);
    setActionError(null);
    setActionSuccess(null);
  }, []);

  /**
   * Record a structured verification outcome.
   * @param {number|string} incidentId
   * @param {object} payload - { outcome, notes, duplicateOfIncidentId, proceedWithDispatch }
   */
  const recordVerification = useCallback(async (incidentId, payload) => {
    setIsActionPending(true);
    setActionError(null);
    setActionSuccess(null);

    const { outcome = 'CONFIRMED', notes = '', duplicateOfIncidentId, proceedWithDispatch } = payload;
    const cleanNotes = typeof notes === 'string' ? notes.trim() : '';

    if (cleanNotes.length > 1000) {
      const err = {
        code: 'VERIFICATION_NOTES_TOO_LONG',
        message: 'Verification notes cannot exceed 1000 characters',
        status: 400,
      };
      setActionError(err);
      setIsActionPending(false);
      throw err;
    }

    if (outcome === 'REJECTED' && cleanNotes.length < 3) {
      const err = {
        code: 'INVALID_REJECTION_REASON',
        message: 'A rejection reason of at least 3 characters is required',
        status: 400,
      };
      setActionError(err);
      setIsActionPending(false);
      throw err;
    }

    if (outcome === 'DUPLICATE' && (!duplicateOfIncidentId || isNaN(Number(duplicateOfIncidentId)))) {
      const err = {
        code: 'MISSING_DUPLICATE_INCIDENT_ID',
        message: 'A valid numeric duplicate incident ID is required',
        status: 400,
      };
      setActionError(err);
      setIsActionPending(false);
      throw err;
    }

    try {
      const updatedIncident = await incidentService.recordVerification(incidentId, {
        outcome,
        verificationNotes: cleanNotes,
        duplicateOfIncidentId: duplicateOfIncidentId ? Number(duplicateOfIncidentId) : undefined,
        proceedWithDispatch: Boolean(proceedWithDispatch),
      });

      let successMsg = `Incident #${incidentId} verification outcome recorded: ${outcome}.`;
      if (outcome === 'CONFIRMED' || proceedWithDispatch) {
        successMsg = `Incident #${incidentId} has been successfully verified.`;
      } else if (outcome === 'REJECTED') {
        successMsg = `Incident #${incidentId} has been marked as rejected.`;
      } else if (outcome === 'DUPLICATE') {
        successMsg = `Incident #${incidentId} marked as duplicate of #${duplicateOfIncidentId}.`;
      } else if (outcome === 'UNABLE_TO_CONTACT') {
        successMsg = `Contact attempt recorded for Incident #${incidentId}. Status retained as REPORTED (Not a false alarm).`;
      }

      setActionSuccess({
        action: outcome,
        incidentId,
        incident: updatedIncident,
        message: successMsg,
      });
      setIsActionPending(false);
      return updatedIncident;
    } catch (err) {
      setActionError(err);
      setIsActionPending(false);
      throw err;
    }
  }, []);

  return {
    verify,
    reject,
    recordVerification,
    isActionPending,
    actionError,
    actionSuccess,
    resetActionState,
  };
}

export default useIncidentVerification;

