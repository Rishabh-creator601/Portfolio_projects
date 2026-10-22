'use client';

import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { ViolationRow } from '@/lib/services';

interface ViolationChartProps {
  data: ViolationRow[];
  isLoading?: boolean;
}

export function ViolationChart({ data, isLoading }: ViolationChartProps) {
  return (
    <div className="card h-[320px] p-5">
      <div className="mb-4 flex items-baseline justify-between">
        <h3 className="section-title">Most violated rules</h3>
        <span className="text-xs text-slate-500">All time</span>
      </div>

      <div className="h-[240px] w-full">
        {isLoading ? (
          <div className="skeleton h-full w-full" />
        ) : data.length === 0 ? (
          <div className="grid h-full place-items-center text-sm text-slate-500">
            No rule failures recorded yet
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart layout="vertical" data={data} margin={{ top: 4, right: 24, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#CFFAFE" />
              <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} />
              <YAxis
                dataKey="rule"
                type="category"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 11, fill: '#64748b' }}
                width={150}
              />
              <Tooltip
                cursor={{ fill: '#ECFEFF' }}
                formatter={(value: number) => [value, 'Failures']}
                contentStyle={{ borderRadius: 10, border: '1px solid #A5F3FC' }}
                labelStyle={{ color: '#083344', fontWeight: 700 }}
              />
              <Bar dataKey="count" fill="#A61B1B" radius={[0, 4, 4, 0]} barSize={16} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

export default ViolationChart;
