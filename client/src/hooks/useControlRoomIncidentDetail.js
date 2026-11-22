import { useState, useEffect, useCallback, useRef } from 'react';
import incidentService from '../services/incidentService.js';

/**
 * Custom hook for retrieving detailed incident metadata for control-room operators,
 * including citizen contact information, caller details, and full audit history.
 *
 * @param {string|number} incidentId - Numeric incident identifier
 */
export function useControlRoomIncidentDetail(incidentId) {
  const [incident, setIncident] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const requestCounterRef = useRef(0);

  const fetchDetail = useCallback(async () => {
    if (!incidentId) {
      setIncident(null);
      setIsLoading(false);
      return;
    }

    const requestId = ++requestCounterRef.current;
    setIsLoading(true);
    setError(null);

    try {
      const data = await incidentService.getIncidentById(incidentId);
      if (requestId === requestCounterRef.current) {
        setIncident(data);
        setIsLoading(false);
      }
    } catch (err) {
      if (requestId === requestCounterRef.current) {
        setError(err);
        setIsLoading(false);
      }
    }
  }, [incidentId]);

  useEffect(() => {
    fetchDetail();
    return () => {
      // Invalidate pending requests on id change or unmount
      requestCounterRef.current++;
    };
  }, [fetchDetail]);

  const refetch = useCallback(() => {
    return fetchDetail();
  }, [fetchDetail]);

  return {
    incident,
    isLoading,
    error,
    refetch,
  };
}

export default useControlRoomIncidentDetail;

