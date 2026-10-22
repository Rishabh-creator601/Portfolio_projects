'use client';

import React from 'react';
import Link from 'next/link';
import { formatDate } from '@/lib/constants';
import type { QueueRow } from '@/lib/services';

interface PendingReviewQueueProps {
  data: QueueRow[];
  isLoading?: boolean;
}

export function PendingReviewQueue({ data, isLoading }: PendingReviewQueueProps) {
  return (
    <div className="card flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-cyan-100 bg-cyan-50/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <h3 className="section-title">Pending review</h3>
          {!isLoading && data.length > 0 && (
            <span className="rounded-full bg-verdict-review px-2 py-0.5 text-xs font-bold text-white">
              {data.length}
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <ul className="divide-y divide-cyan-50">
            {Array.from({ length: 3 }).map((_, i) => (
              <li key={i} className="space-y-2 p-4">
                <div className="skeleton h-4 w-32" />
                <div className="skeleton h-3 w-48" />
              </li>
            ))}
          </ul>
        ) : data.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-500">Nothing is waiting on an officer.</p>
        ) : (
          <ul className="divide-y divide-cyan-50">
            {data.map((item) => (
              <li key={item._id} className="p-4 transition-colors hover:bg-cyan-50/60">
                <div className="mb-2 flex items-start justify-between gap-3">
                  <span className="text-sm font-medium text-cyan-950">{item.product || item.ref}</span>
                  <span className="flex-shrink-0 text-xs text-slate-500">{formatDate(item.date)}</span>
                </div>
                <p className="mb-3 inline-block rounded bg-verdict-review/10 px-2 py-1 text-xs text-verdict-review">
                  {item.reason}
                </p>
                <div>
                  <Link
                    href={`/results/${item._id}?from=dashboard`}
                    className="focus-ring inline-flex items-center rounded-lg border border-cyan-300 bg-white px-3 py-1.5 text-xs font-medium text-cyan-800 transition-colors hover:bg-cyan-50"
                  >
                    Review now
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default PendingReviewQueue;
