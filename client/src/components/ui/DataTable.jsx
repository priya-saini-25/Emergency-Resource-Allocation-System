import React from 'react';
import EmptyState from './EmptyState.jsx';
import Skeleton from './Skeleton.jsx';

export function DataTable({
  columns = [],
  data = [],
  keyField = 'id',
  loading = false,
  emptyMessage = 'No records available in this view.',
  onRowClick = null,
  className = '',
}) {
  return (
    <div className={`overflow-x-auto rounded-xl border border-theme-border bg-white shadow-sm ${className}`}>
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="bg-theme-bg/80 border-b border-theme-border text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
            {columns.map((col, idx) => (
              <th
                key={col.key || idx}
                scope="col"
                className={`px-4 py-3 ${col.headerClassName || ''}`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-theme-border text-xs text-theme-heading">
          {loading ? (
            <tr>
              <td colSpan={columns.length} className="p-6">
                <Skeleton count={4} variant="tableRow" className="mb-2" />
              </td>
            </tr>
          ) : data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="p-8">
                <EmptyState description={emptyMessage} />
              </td>
            </tr>
          ) : (
            data.map((row, rowIdx) => {
              const rowKey = row[keyField] || rowIdx;
              return (
                <tr
                  key={rowKey}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={`hover:bg-theme-bg/60 transition-colors ${
                    onRowClick ? 'cursor-pointer' : ''
                  }`}
                >
                  {columns.map((col, colIdx) => (
                    <td
                      key={col.key || colIdx}
                      className={`px-4 py-3.5 whitespace-nowrap ${col.className || ''}`}
                    >
                      {col.render ? col.render(row[col.key], row, rowIdx) : row[col.key]}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

export default DataTable;

