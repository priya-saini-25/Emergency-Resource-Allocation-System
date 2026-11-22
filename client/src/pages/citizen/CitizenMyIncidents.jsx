import React from 'react';
import { Link } from 'react-router-dom';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Card from '../../components/ui/Card.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import StatusBadge, { SeverityBadge } from '../../components/ui/StatusBadge.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import { EmptyState, ErrorState } from '../../components/ui/EmptyState.jsx';
import { useMyIncidents } from '../../hooks/useMyIncidents.js';
import {
  PlusCircle,
  ExternalLink,
  RotateCw,
  MapPin,
  Clock,
  ShieldAlert,
  ChevronLeft,
  ChevronRight,
  Inbox,
} from 'lucide-react';

export function CitizenMyIncidents() {
  const {
    incidents,
    pagination,
    isLoading,
    error,
    params,
    changePage,
    refetch,
  } = useMyIncidents({ page: 1, limit: 10 });

  const columns = [
    {
      key: 'incidentId',
      header: 'Incident ID',
      render: (val) => (
        <span className="font-semibold text-theme-heading font-mono">
          #{val}
        </span>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      render: (val) => (
        <span className="font-medium text-gray-700 uppercase tracking-wide">
          {val ? val.replace(/_/g, ' ') : 'UNKNOWN'}
        </span>
      ),
    },
    {
      key: 'severity',
      header: 'Severity',
      render: (val) => <SeverityBadge severity={val} />,
    },
    {
      key: 'status',
      header: 'Operational Status',
      render: (val) => <StatusBadge status={val} />,
    },
    {
      key: 'location',
      header: 'Coordinates',
      render: (val) =>
        val ? (
          <span className="text-gray-500 text-[11px] flex items-center space-x-1 font-mono">
            <MapPin className="w-3 h-3 text-gray-400 flex-shrink-0" />
            <span>
              {val.latitude?.toFixed(4)}, {val.longitude?.toFixed(4)}
            </span>
          </span>
        ) : (
          <span className="text-gray-400">—</span>
        ),
    },
    {
      key: 'reportedAt',
      header: 'Reported At',
      render: (val) => (
        <span className="text-gray-500 text-[11px] flex items-center space-x-1">
          <Clock className="w-3 h-3 text-gray-400 flex-shrink-0" />
          <span>
            {val ? new Date(val).toLocaleString('en-IN', {
              dateStyle: 'short',
              timeStyle: 'medium',
            }) : '—'}
          </span>
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Action',
      render: (_, row) => (
        <Link to={`/citizen/incidents/${row.incidentId}`}>
          <Button variant="ghost" size="sm" icon={ExternalLink}>
            Details
          </Button>
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title="My Reported Emergencies"
        subtitle="Historical log of emergency reports registered by your authenticated profile"
        badge={<Badge variant="primary">Authenticated Feed</Badge>}
        actions={
          <div className="flex items-center space-x-2">
            <Button
              variant="outline"
              size="sm"
              icon={RotateCw}
              onClick={() => refetch()}
              disabled={isLoading}
            >
              Refresh
            </Button>
            <Link to="/citizen/report-emergency">
              <Button variant="danger" size="sm" icon={PlusCircle}>
                New Emergency Report
              </Button>
            </Link>
          </div>
        }
      />

      {/* Mandatory Academic Disclaimer Banner */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900 flex items-center space-x-2">
        <ShieldAlert className="w-4 h-4 text-amber-700 flex-shrink-0" />
        <span>
          <strong>DEMO SIMULATION — NOT CONNECTED TO LIVE EMERGENCY SERVICES.</strong> Records reflect simulated emergency reports within the Jodhpur Urban Service Area academic proxy.
        </span>
      </div>

      {/* Main Content Area */}
      {error ? (
        <ErrorState
          title="Unable to Retrieve Incident History"
          message={error.message || 'Failed to communicate with emergency incident service.'}
          onRetry={refetch}
        />
      ) : (
        <Card>
          <Card.Header
            title="Incident Register"
            subtitle={
              pagination
                ? `Showing ${incidents.length} of ${pagination.totalCount || incidents.length} reports`
                : `Showing ${incidents.length} reports`
            }
          />

          {!isLoading && incidents.length === 0 ? (
            <div className="p-8">
              <EmptyState
                icon={Inbox}
                title="No Emergency Reports Registered"
                description="You have not submitted any emergency incidents from this account. Use the intake form to report an incident inside Jodhpur."
                action={
                  <Link to="/citizen/report-emergency">
                    <Button variant="primary" size="sm" icon={PlusCircle}>
                      Report Emergency
                    </Button>
                  </Link>
                }
              />
            </div>
          ) : (
            <>
              <DataTable
                columns={columns}
                data={incidents}
                keyField="incidentId"
                loading={isLoading}
              />

              {/* Pagination Controls */}
              {pagination && pagination.totalPages > 1 && (
                <div className="p-4 border-t border-theme-border flex items-center justify-between text-xs text-gray-500">
                  <span>
                    Page <strong>{pagination.page}</strong> of{' '}
                    <strong>{pagination.totalPages}</strong> ({pagination.totalCount} total)
                  </span>
                  <div className="flex space-x-2">
                    <Button
                      variant="outline"
                      size="sm"
                      icon={ChevronLeft}
                      disabled={pagination.page <= 1 || isLoading}
                      onClick={() => changePage(pagination.page - 1)}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      icon={ChevronRight}
                      disabled={pagination.page >= pagination.totalPages || isLoading}
                      onClick={() => changePage(pagination.page + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </Card>
      )}
    </div>
  );
}

export default CitizenMyIncidents;
