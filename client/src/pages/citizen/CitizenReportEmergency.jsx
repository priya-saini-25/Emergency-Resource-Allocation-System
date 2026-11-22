import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Card from '../../components/ui/Card.jsx';
import Badge from '../../components/ui/Badge.jsx';
import StatusBadge, { SeverityBadge } from '../../components/ui/StatusBadge.jsx';
import Button from '../../components/ui/Button.jsx';
import Input from '../../components/ui/Input.jsx';
import Select from '../../components/ui/Select.jsx';
import Textarea from '../../components/ui/Textarea.jsx';
import LocationSearchInput from '../../components/ui/LocationSearchInput.jsx';
import MapContainer from '../../components/map/MapContainer.jsx';
import {
  isInsideJodhpurPolygon,
  isWithinJodhpurBoundingBox,
  JODHPUR_COORDINATES,
} from '../../config/geoConfig.js';
import { useIncidentSubmission } from '../../hooks/useIncidentSubmission.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useNotification } from '../../context/NotificationContext.jsx';
import { validateAndNormalizeIndianPhone, maskPhoneNumber } from '../../utils/phoneUtils.js';
import {
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  MapPin,
  Send,
  RotateCcw,
  ExternalLink,
  ShieldAlert,
  Info,
  Phone,
  UserCheck,
  ShieldCheck,
  User,
} from 'lucide-react';

const EMERGENCY_CATEGORY_OPTIONS = [
  { value: 'FIRE', label: 'Structure / Vehicle Fire (FIRE)' },
  { value: 'ROAD_ACCIDENT', label: 'Traffic Collision / Road Accident' },
  { value: 'MEDICAL_EMERGENCY', label: 'Severe Medical Crisis / Trauma (MEDICAL_EMERGENCY)' },
  { value: 'HAZMAT', label: 'Hazardous Chemical / Gas Release (HAZMAT)' },
  { value: 'STRUCTURAL_COLLAPSE', label: 'Building / Infrastructure Collapse (STRUCTURAL_COLLAPSE)' },
  { value: 'NATURAL_DISASTER', label: 'Severe Weather / Flood Inundation (NATURAL_DISASTER)' },
  { value: 'CIVIL_DISTURBANCE', label: 'Public Safety Disturbance (CIVIL_DISTURBANCE)' },
  { value: 'OTHER', label: 'Other Critical Emergency (OTHER)' },
];

const SEVERITY_OPTIONS = [
  { value: '5', label: 'Level 5 — Critical / Life-Threatening Crisis' },
  { value: '4', label: 'Level 4 — High Urgency Emergency' },
  { value: '3', label: 'Level 3 — Medium Priority Response' },
  { value: '2', label: 'Level 2 — Moderate Situation' },
  { value: '1', label: 'Level 1 — Low / Non-immediate' },
];

// Clock Tower (Ghanta Ghar) inside authentic Jodhpur settlement polygon
const DEFAULT_COORDINATES = {
  latitude: 26.2978,
  longitude: 73.0185,
};

export function CitizenReportEmergency() {
  const { user } = useAuth();
  const { success, error: toastError } = useNotification();
  const { submitIncident, isSubmitting, error: submitError, submittedIncident, reset } = useIncidentSubmission();

  const [formData, setFormData] = useState({
    reporterName: user?.name || '',
    reporterPhone: user?.phone || '',
    alternatePhone: '',
    category: 'FIRE',
    severity: '4',
    victimCount: '0',
    description: '',
    locationName: '',
    latitude: DEFAULT_COORDINATES.latitude.toString(),
    longitude: DEFAULT_COORDINATES.longitude.toString(),
  });

  const [fieldErrors, setFieldErrors] = useState({});
  const [boundaryWarning, setBoundaryWarning] = useState(null);

  // Sync user profile if loaded asynchronously
  useEffect(() => {
    if (user?.name && !formData.reporterName) {
      setFormData((prev) => ({
        ...prev,
        reporterName: user.name,
        reporterPhone: prev.reporterPhone || user.phone || '',
      }));
    }
  }, [user]);

  // Handle place selection from autocomplete search
  const handlePlaceSelect = (place) => {
    const lat = place.latitude;
    const lng = place.longitude;
    const name = place.name || place.displayName;

    setFormData((prev) => ({
      ...prev,
      locationName: name,
      latitude: lat.toFixed(6),
      longitude: lng.toFixed(6),
    }));

    const inPolygon = isInsideJodhpurPolygon(lat, lng);
    if (!inPolygon) {
      setBoundaryWarning(
        `Selected place "${name}" (${lat.toFixed(4)}° N, ${lng.toFixed(4)}° E) falls outside the Jodhpur Urban Service Area boundary polygon (OSM Way 31725312 proxy). Submissions outside the service boundary are blocked.`
      );
      setFieldErrors((prev) => ({
        ...prev,
        location: 'Coordinates fall outside the supported Jodhpur Urban Service Area boundary polygon (OSM Way 31725312 proxy)',
      }));
    } else {
      setBoundaryWarning(null);
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next.latitude;
        delete next.longitude;
        delete next.location;
        return next;
      });
    }
  };

  // Synchronize map selection with form fields without altering selected coordinates
  const handleMapLocationSelect = ({ latitude, longitude, isDrag }) => {
    setFormData((prev) => {
      let updatedName = prev.locationName;
      if (isDrag && prev.locationName && !prev.locationName.includes('(Pin Refined)')) {
        updatedName = `${prev.locationName} (Pin Refined)`;
      } else if (!prev.locationName) {
        updatedName = `Selected Map Location (${latitude.toFixed(4)}° N, ${longitude.toFixed(4)}° E)`;
      }
      return {
        ...prev,
        locationName: updatedName,
        latitude: latitude.toFixed(6),
        longitude: longitude.toFixed(6),
      };
    });

    // Exact client-side point-in-polygon validation against OSM Way 31725312 academic proxy
    const inPolygon = isInsideJodhpurPolygon(latitude, longitude);
    if (!inPolygon) {
      setBoundaryWarning(
        `Selected location falls outside the Jodhpur Urban Service Area boundary polygon (OSM Way 31725312 academic proxy). Please choose a location within the service boundary.`
      );
      setFieldErrors((prev) => ({
        ...prev,
        location: 'Coordinates fall outside the supported Jodhpur Urban Service Area boundary polygon (OSM Way 31725312 proxy)',
      }));
    } else {
      setBoundaryWarning(null);
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next.latitude;
        delete next.longitude;
        delete next.location;
        return next;
      });
    }
  };

  const handleInputChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));

    // Clear field-level error on change
    if (fieldErrors[field]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const validateForm = () => {
    const errors = {};

    // 1. Reporter Full Name (required, 2-100 chars)
    if (!formData.reporterName || !formData.reporterName.trim() || formData.reporterName.trim().length < 2) {
      errors.reporterName = 'Full Name is required (minimum 2 characters)';
    } else if (formData.reporterName.trim().length > 100) {
      errors.reporterName = 'Full Name cannot exceed 100 characters';
    }

    // 2. Mobile Phone (required, valid Indian 10-digit number)
    const phoneValidation = validateAndNormalizeIndianPhone(formData.reporterPhone, true);
    if (!phoneValidation.isValid) {
      errors.reporterPhone = phoneValidation.error || 'Valid 10-digit Indian mobile number is required';
    }

    // 3. Alternate Contact Number (optional)
    if (formData.alternatePhone && formData.alternatePhone.trim() !== '') {
      const altValidation = validateAndNormalizeIndianPhone(formData.alternatePhone, false);
      if (!altValidation.isValid) {
        errors.alternatePhone = altValidation.error || 'Invalid alternate mobile number';
      }
    }

    // 4. Category
    if (!formData.category) {
      errors.category = 'Emergency category is required';
    }

    // 5. Severity (1..5)
    const sev = Number(formData.severity);
    if (!Number.isInteger(sev) || sev < 1 || sev > 5) {
      errors.severity = 'Severity must be an integer between 1 and 5';
    }

    // 6. Victim count (>= 0)
    const victims = Number(formData.victimCount);
    if (!Number.isInteger(victims) || victims < 0) {
      errors.victimCount = 'Estimated casualties must be a non-negative integer (0 or more)';
    }

    // 7. Description (max 1000)
    if (!formData.description.trim()) {
      errors.description = 'Please provide a brief description of the incident';
    } else if (formData.description.trim().length > 1000) {
      errors.description = `Description exceeds 1000 characters limit (${formData.description.trim().length}/1000)`;
    }

    // 8. Location & Polygon Boundary Pre-Validation
    const lat = Number(formData.latitude);
    const lng = Number(formData.longitude);

    if (formData.latitude === '' || !Number.isFinite(lat) || lat < -90 || lat > 90 ||
        formData.longitude === '' || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      errors.location = 'Please select a valid incident location within Jodhpur';
    } else {
      const inPolygon = isInsideJodhpurPolygon(lat, lng);
      if (!inPolygon) {
        errors.location = 'Selected location falls outside the supported Jodhpur Urban Service Area boundary polygon (OSM Way 31725312 proxy)';
        setBoundaryWarning(
          `Coordinates (${lat.toFixed(4)}° N, ${lng.toFixed(4)}° E) fall outside the Jodhpur Urban Service Area boundary polygon (OSM Way 31725312 academic proxy). Please select a location inside the service boundary.`
        );
      }
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    const phoneValidation = validateAndNormalizeIndianPhone(formData.reporterPhone, true);
    const altValidation = formData.alternatePhone && formData.alternatePhone.trim() !== ''
      ? validateAndNormalizeIndianPhone(formData.alternatePhone, false)
      : { normalized: '' };

    const payload = {
      reporterName: formData.reporterName.trim(),
      reporterPhone: phoneValidation.normalized,
      alternatePhone: altValidation.normalized || undefined,
      category: formData.category,
      severity: Number(formData.severity),
      victimCount: Number(formData.victimCount),
      description: formData.description.trim(),
      locationName: formData.locationName ? formData.locationName.trim() : undefined,
      location: {
        latitude: Number(formData.latitude),
        longitude: Number(formData.longitude),
        name: formData.locationName ? formData.locationName.trim() : undefined,
      },
    };

    try {
      await submitIncident(payload);
      success('Emergency report submitted successfully.');
    } catch (err) {
      toastError(err?.message || 'Failed to submit emergency report.');
    }
  };

  const handleReset = () => {
    reset();
    setFormData({
      reporterName: user?.name || '',
      reporterPhone: user?.phone || '',
      alternatePhone: '',
      category: 'FIRE',
      severity: '4',
      victimCount: '0',
      description: '',
      locationName: '',
      latitude: DEFAULT_COORDINATES.latitude.toString(),
      longitude: DEFAULT_COORDINATES.longitude.toString(),
    });
    setFieldErrors({});
    setBoundaryWarning(null);
  };

  // SUCCESS CONFIRMATION VIEW
  if (submittedIncident) {
    return (
      <div className="space-y-6 max-w-3xl mx-auto">
        <PageHeader
          title="Emergency Report Registered"
          subtitle={`Incident #${submittedIncident.incidentId} successfully logged into dispatch database`}
          badge={<Badge variant="success">Registered</Badge>}
        />

        {/* Academic Simulation Disclaimer */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900 flex items-center space-x-2">
          <ShieldAlert className="w-4 h-4 text-amber-700 flex-shrink-0" />
          <span>
            <strong>DEMO SIMULATION — NOT CONNECTED TO LIVE EMERGENCY SERVICES.</strong> This incident report is stored in the academic simulation database for dispatch evaluation.
          </span>
        </div>

        <Card className="border-emerald-200">
          <div className="p-6 space-y-6">
            <div className="flex items-start space-x-4">
              <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center flex-shrink-0">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-bold text-theme-heading">
                  Report #{submittedIncident.incidentId} Submitted Successfully
                </h3>
                <p className="text-xs text-gray-600">
                  Initial system status is <strong className="text-theme-heading">REPORTED</strong>.
                  Control room operators have received this record for verification.
                </p>
              </div>
            </div>

            {/* Submission Summary Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 bg-theme-bg rounded-lg border border-theme-border text-xs">
              <div>
                <span className="text-gray-500 block uppercase font-semibold text-[10px]">Category</span>
                <span className="font-bold text-theme-heading mt-0.5 block">
                  {submittedIncident.category?.replace(/_/g, ' ')}
                </span>
              </div>
              <div>
                <span className="text-gray-500 block uppercase font-semibold text-[10px]">Initial Status</span>
                <div className="mt-1">
                  <StatusBadge status={submittedIncident.status || 'REPORTED'} />
                </div>
              </div>
              <div>
                <span className="text-gray-500 block uppercase font-semibold text-[10px]">Reported Severity</span>
                <div className="mt-1">
                  <SeverityBadge severity={submittedIncident.severity} />
                </div>
              </div>
              <div>
                <span className="text-gray-500 block uppercase font-semibold text-[10px]">Casualties</span>
                <span className="font-bold text-theme-heading mt-0.5 block">
                  {submittedIncident.victimCount} Reported
                </span>
              </div>
            </div>

            <div className="p-4 bg-white rounded-lg border border-theme-border text-xs space-y-3">
              {/* Reporter Contact Info */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pb-3 border-b border-gray-100">
                <div className="flex items-center space-x-2 text-theme-heading">
                  <User className="w-4 h-4 text-theme-primary flex-shrink-0" />
                  <span>
                    Reporter: <strong>{submittedIncident.reporterName || formData.reporterName}</strong>
                  </span>
                </div>
                <div className="flex items-center space-x-2 text-gray-700">
                  <Phone className="w-4 h-4 text-theme-primary flex-shrink-0" />
                  <span>
                    Contact: <strong className="font-mono">{maskPhoneNumber(submittedIncident.reporterPhone || formData.reporterPhone)}</strong>
                  </span>
                </div>
              </div>

              {submittedIncident.locationName && (
                <div className="flex items-center space-x-2 text-theme-heading font-semibold pb-1.5 border-b border-gray-100">
                  <MapPin className="w-4 h-4 text-theme-primary flex-shrink-0" />
                  <span>
                    Incident Address / Landmark: <strong>{submittedIncident.locationName}</strong>
                  </span>
                </div>
              )}

              <div>
                <span className="text-gray-500 block uppercase font-semibold text-[10px] mb-1">
                  Reported Situation Description
                </span>
                <p className="text-gray-700 italic bg-gray-50 p-2.5 rounded border border-gray-100">
                  "{submittedIncident.description}"
                </p>
              </div>

              {/* Operator Verification Notice */}
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-900 text-xs flex items-start space-x-2">
                <Info className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
                <span>
                  <strong>Operator Verification Notice:</strong> An authorized control room operator will review this report and may contact your registered number to verify on-scene conditions before emergency dispatch.
                </span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="pt-2 flex flex-wrap gap-3 justify-end border-t border-theme-border">
              <Button
                variant="outline"
                size="sm"
                icon={RotateCcw}
                onClick={handleReset}
              >
                Report Another Emergency
              </Button>
              <Link to="/citizen/my-incidents">
                <Button variant="secondary" size="sm">
                  View My Reports
                </Button>
              </Link>
              <Link to={`/citizen/incidents/${submittedIncident.incidentId}`}>
                <Button variant="primary" size="sm" icon={ExternalLink}>
                  Track Incident #{submittedIncident.incidentId}
                </Button>
              </Link>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  const mapSelectedCoords =
    Number.isFinite(Number(formData.latitude)) && Number.isFinite(Number(formData.longitude))
      ? [Number(formData.latitude), Number(formData.longitude)]
      : JODHPUR_COORDINATES.center;

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <PageHeader
        title="Report an Emergency Incident"
        subtitle="Citizen Emergency Intake Form · Jodhpur Urban Service Boundary Verification"
        badge={<Badge variant="primary">Active Intake API</Badge>}
      />

      {/* Mandatory Academic Disclaimer Banner */}
      <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 flex items-center space-x-2.5">
        <ShieldAlert className="w-4 h-4 text-amber-700 flex-shrink-0" />
        <span>
          <strong>DEMO SIMULATION — NOT CONNECTED TO LIVE EMERGENCY SERVICES.</strong> Submitting this report does NOT dispatch real-world police, fire, or medical units.
        </span>
      </div>

      {/* Submission API Error Banner */}
      {submitError && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-xs text-red-900 flex items-start space-x-3">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div className="space-y-1">
            <strong className="font-semibold block">Incident Submission Failed</strong>
            <p>
              {submitError.code === 'OUTSIDE_SERVICE_AREA'
                ? 'The specified location is outside the approved Jodhpur Urban Service Area boundary polygon (OSM Way 31725312). Submissions are strictly restricted to the academic urban settlement boundary.'
                : submitError.code === 'DATABASE_UNAVAILABLE'
                ? 'The incident database is currently unavailable. Please check that the backend MongoDB service is running.'
                : submitError.message || 'An unexpected error occurred while communicating with the emergency API.'}
            </p>
            {submitError.code && (
              <span className="inline-block text-[10px] text-red-700 font-mono bg-red-100 px-1.5 py-0.5 rounded">
                Error Code: {submitError.code}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Boundary Warning Banner */}
      {boundaryWarning && (
        <div className="p-3.5 bg-yellow-50 border border-yellow-200 rounded-xl text-xs text-yellow-900 flex items-start space-x-2.5">
          <AlertTriangle className="w-4 h-4 text-yellow-700 flex-shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <strong className="font-semibold">Service Boundary Advisory (Academic Proxy)</strong>
            <p>{boundaryWarning}</p>
          </div>
        </div>
      )}

      <Card>
        <Card.Header
          title="Incident Details & Classification"
          subtitle="Form submissions are verified and dispatched via the control room"
        />

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Emergency Category */}
          <Select
            label="Emergency Category"
            required
            options={EMERGENCY_CATEGORY_OPTIONS}
            placeholder="Select nature of emergency..."
            value={formData.category}
            onChange={(e) => handleInputChange('category', e.target.value)}
            error={fieldErrors.category}
          />

          {['HAZMAT', 'NATURAL_DISASTER', 'CIVIL_DISTURBANCE'].includes(formData.category) && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-900 flex items-start space-x-2">
              <Info className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
              <span>
                <strong>Specialized Equipment Notice:</strong> This category requires specialized equipment (HAZMAT containment, flood rescue apparatus, or law enforcement units) outside the standard prototype fire/EMS fleet. The simulation engine will evaluate hospital matches and document equipment shortages accordingly.
              </span>
            </div>
          )}

          {/* Severity & Victims Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Select
                label="Perceived Severity Level"
                required
                options={SEVERITY_OPTIONS}
                value={formData.severity}
                onChange={(e) => handleInputChange('severity', e.target.value)}
                error={fieldErrors.severity}
              />
              <span className="text-[11px] text-gray-500 mt-1 block flex items-center">
                <Info className="w-3 h-3 mr-1 text-gray-400 flex-shrink-0" />
                Citizen-reported estimate for academic simulation (not clinical triage).
              </span>
            </div>

            <div>
              <Input
                label="Estimated Casualties / Victims"
                type="number"
                min="0"
                step="1"
                required
                value={formData.victimCount}
                onChange={(e) => handleInputChange('victimCount', e.target.value)}
                error={fieldErrors.victimCount}
              />
              <span className="text-[11px] text-gray-500 mt-1 block">
                Number of affected individuals requiring assistance (0 if unknown).
              </span>
            </div>
          </div>

          {/* Description */}
          <div>
            <Textarea
              label="Situation Description"
              rows={3}
              placeholder="Describe visible flames, trapped persons, road conditions, hazardous materials..."
              value={formData.description}
              onChange={(e) => handleInputChange('description', e.target.value)}
              error={fieldErrors.description}
              required
            />
            <div className="flex justify-between items-center text-[11px] text-gray-500 mt-1">
              <span>Provide concise, factual details regarding immediate hazards.</span>
              <span className={formData.description.length > 1000 ? 'text-red-600 font-semibold' : ''}>
                {formData.description.length} / 1000
              </span>
            </div>
          </div>

          {/* Reporter Information Section */}
          <div className="pt-3 border-t border-theme-border/60 space-y-4">
            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-theme-heading block">
                  Citizen Reporter Contact Information
                </label>
                <Badge variant="primary" size="sm">Verification Required</Badge>
              </div>
              <span className="text-[11px] text-gray-500">
                Contact information enables control-room operators to verify situational details before emergency dispatch.
              </span>
            </div>

            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-900 flex items-start space-x-2">
              <ShieldCheck className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
              <span>
                <strong>Privacy Protected:</strong> Your mobile number is encrypted and shared only with authorized control-room operators for active incident verification. It is never exposed publicly.
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Reporter Full Name"
                type="text"
                required
                placeholder="Enter your full name"
                value={formData.reporterName}
                onChange={(e) => handleInputChange('reporterName', e.target.value)}
                icon={User}
                error={fieldErrors.reporterName}
              />

              <div>
                <Input
                  label="Mobile Phone Number"
                  type="tel"
                  required
                  placeholder="e.g. 9876543210 or +91 9876543210"
                  value={formData.reporterPhone}
                  onChange={(e) => handleInputChange('reporterPhone', e.target.value)}
                  icon={Phone}
                  error={fieldErrors.reporterPhone}
                />
                <span className="text-[10px] text-gray-500 mt-0.5 block">
                  10-digit Indian mobile number (6-9 prefix, optional +91)
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Input
                  label="Alternate Contact Number (Optional)"
                  type="tel"
                  placeholder="Optional alternate mobile number"
                  value={formData.alternatePhone}
                  onChange={(e) => handleInputChange('alternatePhone', e.target.value)}
                  icon={Phone}
                  error={fieldErrors.alternatePhone}
                />
                <span className="text-[10px] text-gray-500 mt-0.5 block">
                  Secondary contact in case primary number is unreachable
                </span>
              </div>
            </div>
          </div>

          {/* Interactive Map Location Selection */}
          <div className="pt-3 border-t border-theme-border/60 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-xs font-semibold text-theme-heading block">
                  Incident Address & Location Selection (Jodhpur Urban Service Area)
                </label>
                <span className="text-[11px] text-gray-500">
                  Search a place name or landmark. You may also drag or click the map marker to fine-tune the exact emergency scene.
                </span>
              </div>
              <Badge variant="accent" size="sm">Address-Based</Badge>
            </div>

            {/* Place-Name Geocoding Autocomplete Search */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-gray-700 flex items-center justify-between">
                <span>Enter Incident Address or Familiar Landmark:</span>
                <span className="text-[10px] text-gray-400 font-normal">e.g. Sojati Gate, AIIMS Jodhpur, MDM Hospital, Sardarpura, Paota</span>
              </label>
              <LocationSearchInput
                selectedLocationName={formData.locationName}
                onSelectLocation={handlePlaceSelect}
                placeholder="Enter incident address or landmark (e.g. Sojati Gate, Jodhpur)"
                disabled={isSubmitting}
              />
              <p className="text-[11px] text-gray-500 flex items-center pt-0.5">
                <Info className="w-3.5 h-3.5 text-theme-primary mr-1.5 flex-shrink-0" />
                <span>
                  Searching a landmark or address centers the map and records geographic coordinates automatically.
                </span>
              </p>
            </div>

            {/* Selected Location Confirmation Pill */}
            {formData.locationName && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-900 flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                  <span>
                    Selected Incident Location: <strong>{formData.locationName}</strong>
                  </span>
                </div>
                <span className="text-[10px] text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded font-medium">
                  Service Area Verified
                </span>
              </div>
            )}

            {/* Leaflet Map Picker with Draggable Marker & Location Synchronization */}
            <MapContainer
              height="280px"
              selectedLocation={mapSelectedCoords}
              locationName={formData.locationName}
              onLocationSelect={handleMapLocationSelect}
              interactive={true}
              showDefaultMarker={false}
              showBoundaryPolygon={true}
            />

            {fieldErrors.location && (
              <p className="text-xs text-red-600 font-medium">{fieldErrors.location}</p>
            )}

            <div className="text-[11px] text-gray-500 space-y-0.5">
              <p>
                <strong>Academic Boundary Reference:</strong> Boundary conforms to the Jodhpur Urban Service Area polygon proxy derived from OSM Way 31725312.
              </p>
              <p className="text-gray-400">
                Clock Tower reference: 26.2978° N, 73.0185° E. Outlying regions such as Mandore are outside service bounds.
              </p>
            </div>
          </div>

          {/* Form Actions */}
          <div className="pt-4 flex justify-end space-x-3 border-t border-theme-border">
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={handleReset}
              disabled={isSubmitting}
            >
              Reset Form
            </Button>
            <Button
              type="submit"
              variant="danger"
              size="md"
              icon={Send}
              loading={isSubmitting}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Submitting Report...' : 'Submit Emergency Report'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

export default CitizenReportEmergency;
