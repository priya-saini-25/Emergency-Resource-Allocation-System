import React, { useState, useEffect, useRef, useCallback } from 'react';
import locationService from '../../services/locationService.js';
import { Search, MapPin, X, Loader2, AlertTriangle, CheckCircle2, ChevronRight } from 'lucide-react';

/**
 * Debounced place-name search with autocomplete suggestions,
 * service-area indicators, keyboard navigation, and clear actions.
 */
export function LocationSearchInput({
  onSelectLocation,
  selectedLocationName = '',
  disabled = false,
  placeholder = 'Search place name, hospital, or landmark in Jodhpur (e.g. Sojati Gate, AIIMS)...',
  className = '',
}) {
  const [query, setQuery] = useState(selectedLocationName || '');
  const [results, setResults] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const containerRef = useRef(null);
  const debounceTimerRef = useRef(null);
  const latestRequestIdRef = useRef(0);

  // Sync external locationName changes into query input
  useEffect(() => {
    if (selectedLocationName !== undefined) {
      setQuery(selectedLocationName);
    }
  }, [selectedLocationName]);

  // Click-outside listener to dismiss suggestions
  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const performSearch = useCallback(async (searchQuery) => {
    const currentRequestId = ++latestRequestIdRef.current;
    if (!searchQuery || searchQuery.trim().length < 2) {
      setResults([]);
      setIsLoading(false);
      setIsOpen(false);
      return;
    }

    setIsLoading(true);
    setHasError(false);
    try {
      const places = await locationService.searchPlaces(searchQuery);
      if (currentRequestId !== latestRequestIdRef.current) {
        return; // Discard stale asynchronous response
      }
      setResults(places);
      setIsOpen(true);
      setActiveIndex(-1);
    } catch (err) {
      if (currentRequestId !== latestRequestIdRef.current) {
        return; // Discard stale asynchronous response
      }
      console.warn('[LOCATION_SEARCH_ERROR]', err);
      setHasError(true);
      setResults([]);
      setIsOpen(true);
    } finally {
      if (currentRequestId === latestRequestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  const handleInputChange = (e) => {
    const val = e.target.value;
    setQuery(val);

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (!val || val.trim().length < 2) {
      latestRequestIdRef.current += 1;
      setResults([]);
      setIsOpen(false);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    debounceTimerRef.current = setTimeout(() => {
      performSearch(val);
    }, 350);
  };

  const handleSelect = (place) => {
    setQuery(place.name);
    setIsOpen(false);
    setResults([]);
    if (onSelectLocation) {
      onSelectLocation(place);
    }
  };

  const handleClear = () => {
    latestRequestIdRef.current += 1;
    setQuery('');
    setResults([]);
    setIsOpen(false);
    setIsLoading(false);
    setActiveIndex(-1);
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
  };

  const handleKeyDown = (e) => {
    if (!isOpen || results.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (prev < results.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (prev > 0 ? prev - 1 : results.length - 1));
    } else if (e.key === 'Enter') {
      if (activeIndex >= 0 && activeIndex < results.length) {
        e.preventDefault();
        handleSelect(results[activeIndex]);
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      {/* Search Input Box */}
      <div className="relative flex items-center">
        <div className="absolute left-3.5 text-gray-400 pointer-events-none">
          <Search className="w-4 h-4" />
        </div>

        <input
          type="text"
          value={query}
          onChange={handleInputChange}
          onFocus={() => {
            if (results.length > 0) setIsOpen(true);
          }}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={placeholder}
          className="w-full pl-10 pr-10 py-2.5 text-xs bg-white border border-theme-border rounded-xl shadow-sm text-theme-heading placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-theme-primary/30 focus:border-theme-primary transition-all disabled:bg-gray-50 disabled:text-gray-400"
          aria-label="Search place name"
          aria-autocomplete="list"
          aria-expanded={isOpen}
        />

        <div className="absolute right-3 flex items-center space-x-1">
          {isLoading && (
            <Loader2 className="w-4 h-4 text-theme-primary animate-spin" />
          )}

          {query && !disabled && (
            <button
              type="button"
              onClick={handleClear}
              className="p-1 text-gray-400 hover:text-gray-600 rounded-md transition-colors"
              title="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Autocomplete Dropdown */}
      {isOpen && (
        <div className="absolute z-[2000] left-0 right-0 mt-1.5 bg-white border border-theme-border rounded-xl shadow-xl overflow-hidden max-h-72 overflow-y-auto">
          {hasError ? (
            <div className="p-3 text-xs text-amber-800 bg-amber-50 flex items-start space-x-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Geocoding service temporarily unavailable</p>
                <p className="text-[11px] text-amber-700 mt-0.5">
                  You can click directly on the interactive map to pin the incident coordinates.
                </p>
              </div>
            </div>
          ) : results.length === 0 ? (
            <div className="p-4 text-center text-xs text-gray-500">
              <p className="font-medium text-gray-700">No locations found</p>
              <p className="text-[11px] text-gray-400 mt-0.5">
                No matching places found in Jodhpur for "{query}". Try another landmark or pin directly on the map.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100" role="listbox">
              {results.map((place, idx) => {
                const isActive = idx === activeIndex;
                return (
                  <li
                    key={place.placeId || `loc_${idx}`}
                    role="option"
                    aria-selected={isActive}
                    onClick={() => handleSelect(place)}
                    onMouseEnter={() => setActiveIndex(idx)}
                    className={`px-3.5 py-2.5 cursor-pointer text-xs transition-colors flex items-start justify-between space-x-3 ${
                      isActive ? 'bg-sky-50/70 text-theme-primary' : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-start space-x-2.5 min-w-0">
                      <MapPin
                        className={`w-4 h-4 flex-shrink-0 mt-0.5 ${
                          place.isInsideServiceArea ? 'text-theme-primary' : 'text-amber-500'
                        }`}
                      />
                      <div className="min-w-0 space-y-0.5">
                        <div className="font-semibold text-theme-heading flex items-center space-x-1.5 truncate">
                          <span className="truncate">{place.name}</span>
                          {place.isInsideServiceArea ? (
                            <span className="inline-flex items-center text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.2 rounded font-medium flex-shrink-0">
                              <CheckCircle2 className="w-2.5 h-2.5 mr-0.5" />
                              Inside Service Area
                            </span>
                          ) : (
                            <span className="inline-flex items-center text-[10px] text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.2 rounded font-medium flex-shrink-0">
                              <AlertTriangle className="w-2.5 h-2.5 mr-0.5" />
                              Outside Boundary
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-gray-500 truncate">{place.displayName}</p>
                        <p className="text-[10px] text-gray-400 font-mono">
                          {place.latitude.toFixed(4)}° N, {place.longitude.toFixed(4)}° E
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0 mt-1" />
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default LocationSearchInput;
