import { useState, useEffect, useCallback, useRef } from 'react';
import incidentService from '../services/incidentService.js';

/**
 * Custom hook to retrieve and paginate the authenticated citizen's reported incidents.
 * Includes stale-request and component unmount protection.
 *
 * @param {object} initialParams - { page: number, limit: number }
 */
export function useMyIncidents(initialParams = { page: 1, limit: 10 }) {
  const [params, setParams] = useState(initialParams);
  const [incidents, setIncidents] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const requestCounterRef = useRef(0);

  const fetchIncidents = useCallback(async (fetchParams = params) => {
    const requestId = ++requestCounterRef.current;
    setIsLoading(true);
    setError(null);

    try {
      const data = await incidentService.getMyIncidents(fetchParams);
      if (requestId === requestCounterRef.current) {
        setIncidents(data.incidents || []);
        setPagination(data.pagination || null);
        setIsLoading(false);
      }
    } catch (err) {
      if (requestId === requestCounterRef.current) {
        setError(err);
        setIsLoading(false);
      }
    }
  }, [params]);

  useEffect(() => {
    fetchIncidents(params);
    return () => {
      // Invalidate pending requests on param change or unmount
      requestCounterRef.current++;
    };
  }, [params, fetchIncidents]);

  const changePage = useCallback((newPage) => {
    setParams((prev) => ({ ...prev, page: newPage }));
  }, []);

  const refetch = useCallback(() => {
    return fetchIncidents(params);
  }, [fetchIncidents, params]);

  return {
    incidents,
    pagination,
    isLoading,
    error,
    params,
    changePage,
    refetch,
  };
}

export default useMyIncidents;

