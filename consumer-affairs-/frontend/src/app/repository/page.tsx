'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { SearchBar } from '@/components/ui/SearchBar';
import { Table, Column } from '@/components/ui/Table';
import { StatusPill } from '@/components/ui/StatusPill';
import { useApi } from '@/lib/hooks';
import { productService } from '@/lib/services';
import { formatDate } from '@/lib/constants';
import { MyReports } from '@/components/reports/MyReports';
import type { Product } from '@/types/product';

export default function RepositoryPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [verdict, setVerdict] = useState('');
  const [page, setPage] = useState(1);

  const categories = useApi(() => productService.categories(), []);
  const products = useApi(
    () => productService.list({ search, category, verdict, page, limit: 20 }),
    [search, category, verdict, page]
  );

  const rows = products.data?.data ?? [];
  const meta = products.data?.meta;

  const onFilterChange = (setter: (v: string) => void) => (value: string) => {
    setPage(1);
    setter(value);
  };

  const columns: Column<Product>[] = [
    {
      key: 'brand',
      label: 'Brand',
      sortable: true,
      render: (p) => <span className="font-medium text-cyan-950">{p.brand || '—'}</span>,
    },
    { key: 'genericName', label: 'Generic name', sortable: true },
    {
      key: 'category',
      label: 'Category',
      render: (p) =>
        p.category ? (
          <span className="chip border-cyan-200 bg-cyan-50 text-cyan-800">{p.category}</span>
        ) : (
          '—'
        ),
    },
    {
      key: 'gtin',
      label: 'GTIN',
      render: (p) => <span className="font-mono text-xs text-slate-500">{p.gtin || '—'}</span>,
    },
    {
      key: 'lastInspected',
      label: 'Last inspected',
      render: (p) => formatDate(p.complianceHistory?.[p.complianceHistory.length - 1]?.date),
    },
    {
      key: 'lastVerdict',
      label: 'Last verdict',
      render: (p) => {
        const last = p.complianceHistory?.[p.complianceHistory.length - 1];
        return last ? <StatusPill verdict={last.verdict} /> : <span className="text-slate-400">—</span>;
      },
    },
    {
      key: 'inspections',
      label: 'Inspections',
      align: 'right',
      render: (p) => p.complianceHistory?.length ?? 0,
    },
  ];

  return (
    <div className="mx-auto max-w-7xl p-4 lg:p-8">
      <div className="mb-6">
        <h1 className="page-title">Product repository</h1>
        <p className="page-subtitle">
          Search packaged commodities and open their full compliance history.
        </p>
      </div>

      <div className="card mb-6 flex flex-col gap-4 p-4 lg:flex-row">
        <div className="flex-1">
          <SearchBar
            onSearch={onFilterChange(setSearch)}
            placeholder="Search by brand, generic name or GTIN…"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            value={category}
            onChange={(e) => onFilterChange(setCategory)(e.target.value)}
            className="input w-auto"
            aria-label="Filter by category"
          >
            <option value="">All categories</option>
            {(categories.data ?? []).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={verdict}
            onChange={(e) => onFilterChange(setVerdict)(e.target.value)}
            className="input w-auto"
            aria-label="Filter by verdict"
          >
            <option value="">All verdicts</option>
            <option value="compliant">Compliant</option>
            <option value="non_compliant">Non-compliant</option>
            <option value="review">Under review</option>
          </select>
        </div>
      </div>

      <Table
        columns={columns}
        data={rows}
        isLoading={products.isLoading}
        error={products.error}
        onRetry={products.reload}
        onRowClick={(item) => {
          // Open the most recent inspection for this product, when there is one.
          const last = item.complianceHistory?.[item.complianceHistory.length - 1];
          if (last?.inspectionId) router.push(`/results/${last.inspectionId}?from=repository`);
        }}
        emptyMessage="No products match these filters."
        pagination={{
          currentPage: meta?.page ?? page,
          totalPages: meta?.totalPages ?? 1,
          onPageChange: setPage,
          totalItems: meta?.total,
        }}
      />

      <div className="mt-8">
        <MyReports />
      </div>
    </div>
  );
}
