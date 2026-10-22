'use client';

import Link from 'next/link';
import { AlertTriangle, Camera, ClipboardCheck, IndianRupee, ScanLine, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/hooks';
import { dashboardService } from '@/lib/services';
import { formatCurrency } from '@/lib/constants';
import { KPICard } from '@/components/layout/KPICard';
import { ComplianceChart } from '@/components/dashboard/ComplianceChart';
import { ViolationChart } from '@/components/dashboard/ViolationChart';
import { RecentInspections } from '@/components/dashboard/RecentInspections';
import { PendingReviewQueue } from '@/components/dashboard/PendingReviewQueue';

export default function DashboardPage() {
  const { user } = useAuth();

  const stats = useApi(() => dashboardService.stats(), []);
  const trends = useApi(() => dashboardService.trends(12), []);
  const violations = useApi(() => dashboardService.violations(6), []);
  const recent = useApi(() => dashboardService.recent(6), []);
  const pending = useApi(() => dashboardService.pending(6), []);

  const firstName = (user?.displayName || '').split(' ')[0] || 'Officer';
  const canScan = user && ['field_inspector', 'senior_inspector', 'controller'].includes(user.role);

  return (
    <div className="mx-auto max-w-7xl p-4 lg:p-8">
      <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="page-title">Good day, {firstName}</h1>
          <p className="page-subtitle">
            Compliance overview for {user?.jurisdiction || 'your jurisdiction'}.
          </p>
        </div>

        {canScan && (
          <div className="flex gap-2">
            <Link
              href="/scan/camera"
              className="focus-ring inline-flex items-center gap-2 rounded-lg border border-cyan-300 bg-white px-4 py-2 text-sm font-medium text-cyan-800 transition-colors hover:bg-cyan-50"
            >
              <Camera className="h-4 w-4" aria-hidden="true" />
              Scan package
            </Link>
            <Link
              href="/scan/upload"
              className="focus-ring inline-flex items-center gap-2 rounded-lg bg-cyan-bright px-4 py-2 text-sm font-medium text-white shadow-cyan transition-colors hover:bg-cyan-600"
            >
              <ScanLine className="h-4 w-4" aria-hidden="true" />
              New inspection
            </Link>
          </div>
        )}
      </div>

      {stats.error && (
        <div className="mb-6 flex items-center justify-between gap-4 rounded-lg border border-verdict-fail/25 bg-verdict-fail/5 p-4 text-sm text-verdict-fail">
          <span>{stats.error}</span>
          <button
            onClick={stats.reload}
            className="focus-ring rounded-lg border border-verdict-fail/30 px-3 py-1.5 font-medium"
          >
            Retry
          </button>
        </div>
      )}

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KPICard
          title="Total scanned"
          value={stats.data?.totalScanned ?? 0}
          isLoading={stats.isLoading}
          icon={<ScanLine className="h-5 w-5" aria-hidden="true" />}
          hint="Inspections raised to date"
        />
        <KPICard
          title="Compliance rate"
          value={`${stats.data?.complianceRate ?? 0}%`}
          isLoading={stats.isLoading}
          tone="pass"
          icon={<ShieldCheck className="h-5 w-5" aria-hidden="true" />}
          hint="Of adjudicated inspections"
        />
        <KPICard
          title="Violations"
          value={stats.data?.totalViolations ?? 0}
          isLoading={stats.isLoading}
          tone="fail"
          icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
          hint={`Penalty exposure ${formatCurrency(stats.data?.penaltyExposure ?? 0)}`}
        />
        <KPICard
          title="Pending review"
          value={stats.data?.pendingReview ?? 0}
          isLoading={stats.isLoading}
          tone="review"
          icon={<ClipboardCheck className="h-5 w-5" aria-hidden="true" />}
          hint="Awaiting officer adjudication"
        />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ComplianceChart data={trends.data ?? []} isLoading={trends.isLoading} />
        <ViolationChart data={violations.data ?? []} isLoading={violations.isLoading} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <RecentInspections data={recent.data ?? []} isLoading={recent.isLoading} />
        <PendingReviewQueue data={pending.data ?? []} isLoading={pending.isLoading} />
      </div>
    </div>
  );
}
