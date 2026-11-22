import { useState, useEffect, useCallback, useRef } from 'react';
import incidentService from '../services/incidentService.js';

const DEFAULT_FILTERS = {
  status: 'REPORTED', // Prioritize actionable REPORTED incidents by default
  category: '',
  severity: '',
  incidentId: '',
  page: 1,
  limit: 20,
  sortBy: 'createdAt',
  sortOrder: 'desc',
};

/**
 * Custom hook for control-room incident queue management with backend filtering,
 * pagination, deterministic sorting, and stale request protection.
 *
 * @param {object} initialFilters - Initial filter overrides
 */
export function useControlRoomIncidents(initialFilters = {}) {
  const [filters, setFiltersState] = useState(() => ({
    ...DEFAULT_FILTERS,
    ...initialFilters,
  }));

  const [incidents, setIncidents] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const requestCounterRef = useRef(0);

  const fetchIncidents = useCallback(async (currentFilters = filters) => {
    const requestId = ++requestCounterRef.current;
    setIsLoading(true);
    setError(null);

    // Build clean query params object excluding empty strings
    const params = {};
    if (currentFilters.status) params.status = currentFilters.status;
    if (currentFilters.category) params.category = currentFilters.category;
    if (currentFilters.severity) params.severity = currentFilters.severity;
    if (currentFilters.incidentId) params.incidentId = currentFilters.incidentId;
    if (currentFilters.page) params.page = currentFilters.page;
    if (currentFilters.limit) params.limit = currentFilters.limit;
    if (currentFilters.sortBy) params.sortBy = currentFilters.sortBy;
    if (currentFilters.sortOrder) params.sortOrder = currentFilters.sortOrder;
    if (currentFilters.startDate) params.startDate = currentFilters.startDate;
    if (currentFilters.endDate) params.endDate = currentFilters.endDate;

    try {
      const data = await incidentService.listIncidents(params);
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
  }, [filters]);

  useEffect(() => {
    fetchIncidents(filters);
    return () => {
      // Invalidate pending requests on filter changes or component unmount
      requestCounterRef.current++;
    };
  }, [filters, fetchIncidents]);

  const setFilter = useCallback((key, value) => {
    setFiltersState((prev) => ({
      ...prev,
      [key]: value,
      page: 1, // Reset to page 1 on filter modification
    }));
  }, []);

  const setFilters = useCallback((newFilters) => {
    setFiltersState((prev) => ({
      ...prev,
      ...newFilters,
      page: 1,
    }));
  }, []);

  const resetFilters = useCallback(() => {
    setFiltersState({ ...DEFAULT_FILTERS });
  }, []);

  const changePage = useCallback((newPage) => {
    setFiltersState((prev) => ({ ...prev, page: newPage }));
  }, []);

  const refetch = useCallback(() => {
    return fetchIncidents(filters);
  }, [fetchIncidents, filters]);

  return {
    incidents,
    pagination,
    isLoading,
    error,
    filters,
    setFilter,
    setFilters,
    resetFilters,
    changePage,
    refetch,
  };
}

export default useControlRoomIncidents;

