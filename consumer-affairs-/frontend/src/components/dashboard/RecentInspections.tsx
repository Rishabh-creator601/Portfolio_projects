'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { StatusPill } from '../ui/StatusPill';
import { formatDateTime } from '@/lib/constants';
import type { QueueRow } from '@/lib/services';

interface RecentInspectionsProps {
  data: QueueRow[];
  isLoading?: boolean;
}

export function RecentInspections({ data, isLoading }: RecentInspectionsProps) {
  return (
    <div className="card flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-cyan-100 bg-cyan-50/60 px-4 py-3">
        <h3 className="section-title">Recent inspections</h3>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <ul className="divide-y divide-cyan-50">
            {Array.from({ length: 4 }).map((_, i) => (
              <li key={i} className="space-y-2 p-4">
                <div className="skeleton h-4 w-24" />
                <div className="skeleton h-3 w-40" />
              </li>
            ))}
          </ul>
        ) : data.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-500">No inspections recorded yet.</p>
        ) : (
          <ul className="divide-y divide-cyan-50">
            {data.map((item) => (
              <li key={item._id} className="transition-colors hover:bg-cyan-50/60">
                <Link href={`/results/${item._id}?from=dashboard`} className="block p-4">
                  <div className="flex items-start justify-between gap-3">
                    <span className="font-mono text-sm font-semibold text-cyan-700">{item.ref}</span>
                    <StatusPill verdict={item.verdict} />
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <span className="truncate text-sm text-slate-700">{item.product}</span>
                    <span className="flex-shrink-0 text-xs text-slate-500">{formatDateTime(item.date)}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-cyan-100 bg-cyan-50/40 p-3 text-center">
        <Link
          href="/repository"
          className="focus-ring inline-flex items-center gap-1.5 rounded text-sm font-medium text-cyan-700 hover:text-cyan-900"
        >
          View the product repository
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

export default RecentInspections;
