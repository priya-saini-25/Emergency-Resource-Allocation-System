import { useState, useCallback } from 'react';
import incidentService from '../services/incidentService.js';

/**
 * Custom hook for submitting citizen emergency reports.
 * Prevents concurrent submissions and encapsulates normalized error handling.
 */
export function useIncidentSubmission() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [submittedIncident, setSubmittedIncident] = useState(null);

  const submitIncident = useCallback(async (payload) => {
    setIsSubmitting(true);
    setError(null);

    try {
      const incident = await incidentService.createIncident(payload);
      setSubmittedIncident(incident);
      setIsSubmitting(false);
      return incident;
    } catch (err) {
      setError(err);
      setIsSubmitting(false);
      throw err;
    }
  }, []);

  const reset = useCallback(() => {
    setIsSubmitting(false);
    setError(null);
    setSubmittedIncident(null);
  }, []);

  return {
    submitIncident,
    isSubmitting,
    error,
    submittedIncident,
    reset,
  };
}

export default useIncidentSubmission;

