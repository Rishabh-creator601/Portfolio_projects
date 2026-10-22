'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Inbox } from 'lucide-react';

export interface Column<T> {
  key: string;
  label: string;
  sortable?: boolean;
  align?: 'left' | 'right' | 'center';
  render?: (item: T) => React.ReactNode;
}

interface TableProps<T> {
  columns: Column<T>[];
  data: T[];
  onSort?: (key: string, direction: 'asc' | 'desc') => void;
  pagination?: {
    currentPage: number;
    totalPages: number;
    onPageChange: (page: number) => void;
    totalItems?: number;
  };
  emptyMessage?: string;
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onRowClick?: (item: T) => void;
  rowKey?: (item: T, index: number) => string;
}

export function Table<T extends Record<string, any>>({
  columns,
  data,
  onSort,
  pagination,
  emptyMessage = 'No data available',
  isLoading = false,
  error = null,
  onRetry,
  onRowClick,
  rowKey,
}: TableProps<T>) {
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);

  const handleSort = (key: string) => {
    const direction = sortConfig?.key === key && sortConfig.direction === 'asc' ? 'desc' : 'asc';
    setSortConfig({ key, direction });
    onSort?.(key, direction);
  };

  const alignClass = (align?: Column<T>['align']) =>
    align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-cyan-100 bg-cyan-50/70 text-xs uppercase tracking-wide text-cyan-900">
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className={`whitespace-nowrap px-4 py-3 font-semibold ${alignClass(col.align)} ${
                    col.sortable ? 'cursor-pointer select-none transition-colors hover:bg-cyan-100/70' : ''
                  }`}
                  onClick={() => col.sortable && handleSort(col.key)}
                  aria-sort={
                    sortConfig?.key === col.key
                      ? sortConfig.direction === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : undefined
                  }
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    {col.sortable && (
                      <span className="text-cyan-500">
                        {sortConfig?.key === col.key ? (
                          sortConfig.direction === 'asc' ? (
                            <ChevronUp className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5" />
                          )
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5 opacity-40" />
                        )}
                      </span>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, idx) => (
                <tr key={idx} className="border-b border-cyan-50 last:border-0">
                  {columns.map((col) => (
                    <td key={col.key} className="px-4 py-3.5">
                      <div className="skeleton h-4 w-3/4" />
                    </td>
                  ))}
                </tr>
              ))
            ) : error ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-12 text-center">
                  <p className="text-sm font-medium text-verdict-fail">{error}</p>
                  {onRetry && (
                    <button
                      onClick={onRetry}
                      className="focus-ring mt-3 rounded-lg border border-cyan-300 px-3 py-1.5 text-sm font-medium text-cyan-800 transition-colors hover:bg-cyan-50"
                    >
                      Try again
                    </button>
                  )}
                </td>
              </tr>
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-14 text-center">
                  <div className="flex flex-col items-center gap-3 text-slate-500">
                    <span className="grid h-12 w-12 place-items-center rounded-full bg-cyan-50 text-cyan-600">
                      <Inbox className="h-6 w-6" aria-hidden="true" />
                    </span>
                    <span className="text-sm">{emptyMessage}</span>
                  </div>
                </td>
              </tr>
            ) : (
              data.map((item, rowIndex) => (
                <tr
                  key={rowKey ? rowKey(item, rowIndex) : item._id || rowIndex}
                  onClick={() => onRowClick?.(item)}
                  tabIndex={onRowClick ? 0 : undefined}
                  onKeyDown={(e) => {
                    if (onRowClick && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      onRowClick(item);
                    }
                  }}
                  className={`border-b border-cyan-50 transition-colors last:border-0 hover:bg-cyan-50/60 ${
                    onRowClick ? 'cursor-pointer' : ''
                  }`}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={`px-4 py-3.5 text-sm text-slate-700 ${alignClass(col.align)}`}
                    >
                      {col.render ? col.render(item) : (item[col.key] ?? '—')}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pagination && pagination.totalPages > 0 && (
        <div className="flex items-center justify-between gap-3 border-t border-cyan-100 bg-cyan-50/40 px-4 py-3 text-sm">
          <p className="text-slate-600">
            {pagination.totalItems !== undefined
              ? `Showing ${data.length} of ${pagination.totalItems}`
              : `Page ${pagination.currentPage} of ${pagination.totalPages}`}
          </p>
          <div className="flex items-center gap-2">
            <button
              disabled={pagination.currentPage <= 1}
              onClick={() => pagination.onPageChange(pagination.currentPage - 1)}
              className="focus-ring rounded-lg border border-cyan-200 bg-white px-3 py-1.5 font-medium text-cyan-800 transition-colors hover:bg-cyan-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Previous
            </button>
            <span className="px-1 text-xs text-slate-500">
              {pagination.currentPage} / {pagination.totalPages}
            </span>
            <button
              disabled={pagination.currentPage >= pagination.totalPages}
              onClick={() => pagination.onPageChange(pagination.currentPage + 1)}
              className="focus-ring rounded-lg border border-cyan-200 bg-white px-3 py-1.5 font-medium text-cyan-800 transition-colors hover:bg-cyan-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default Table;
