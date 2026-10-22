'use client';

import React from 'react';
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart } from 'recharts';
import type { TrendPoint } from '@/lib/services';

interface ComplianceChartProps {
  data: TrendPoint[];
  isLoading?: boolean;
}

export function ComplianceChart({ data, isLoading }: ComplianceChartProps) {
  return (
    <div className="card h-[320px] p-5">
      <div className="mb-4 flex items-baseline justify-between">
        <h3 className="section-title">Compliance rate</h3>
        <span className="text-xs text-slate-500">Last 12 months</span>
      </div>

      <div className="h-[240px] w-full">
        {isLoading ? (
          <div className="skeleton h-full w-full" />
        ) : data.length === 0 ? (
          <div className="grid h-full place-items-center text-sm text-slate-500">
            No adjudicated inspections yet
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="complianceFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#06B6D4" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#06B6D4" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#CFFAFE" />
              <XAxis
                dataKey="name"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 12, fill: '#64748b' }}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 12, fill: '#64748b' }}
                domain={[0, 100]}
                unit="%"
              />
              <Tooltip
                formatter={(value: number) => [`${value}%`, 'Compliance rate']}
                labelFormatter={(_, payload) => payload?.[0]?.payload?.month ?? ''}
                contentStyle={{
                  borderRadius: 10,
                  border: '1px solid #A5F3FC',
                  boxShadow: '0 8px 24px -8px rgba(8,51,68,0.25)',
                }}
                labelStyle={{ color: '#083344', fontWeight: 700 }}
              />
              <Area
                type="monotone"
                dataKey="rate"
                stroke="#0E7490"
                strokeWidth={2.5}
                fillOpacity={1}
                fill="url(#complianceFill)"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

export default ComplianceChart;
