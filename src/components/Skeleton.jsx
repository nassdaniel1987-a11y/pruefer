import React from 'react';

// Basis-Element: einfacher pulsierender Block
export const Skel = ({ className = '' }) => (
  <div className={`skeleton ${className}`} />
);

// Dashboard: 4 Stat-Karten + 2 Block-Cards
export const DashboardSkeleton = () => (
  <div className="space-y-8 pb-20">
    {/* Hero */}
    <section>
      <div className="relative p-8 rounded-3xl bg-gradient-to-br from-primary/30 to-primary-container/20 overflow-hidden">
        <Skel className="h-8 w-48 mb-3" />
        <Skel className="h-4 w-80 max-w-full" />
      </div>
    </section>

    {/* Stat Grid */}
    <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="bg-surface-container-lowest p-6 rounded-2xl">
          <Skel className="w-12 h-12 rounded-xl mb-4" />
          <Skel className="h-3 w-24 mb-2" />
          <Skel className="h-8 w-16" />
        </div>
      ))}
    </section>

    {/* Block Cards */}
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
      <div className="xl:col-span-2 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="bg-surface-container-lowest p-6 rounded-2xl space-y-4">
              <div className="flex justify-between">
                <div className="space-y-2">
                  <Skel className="h-5 w-32" />
                  <Skel className="h-3 w-40" />
                </div>
                <Skel className="h-6 w-20 rounded-full" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Skel className="h-16 rounded-xl" />
                <Skel className="h-16 rounded-xl" />
              </div>
              <div className="flex gap-2">
                <Skel className="h-8 w-24 rounded-lg" />
                <Skel className="h-8 w-20 rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div>
        <div className="bg-surface-container-low/50 rounded-3xl p-6 space-y-3">
          <Skel className="h-6 w-28" />
          <Skel className="h-4 w-full" />
          <Skel className="h-4 w-3/4" />
          <Skel className="h-10 rounded-xl w-full mt-4" />
        </div>
      </div>
    </div>
  </div>
);

// Tabellen-Skeleton: n Zeilen mit k Spalten
export const TableSkeleton = ({ rows = 8, cols = 4 }) => (
  <div className="bg-surface-container-lowest rounded-2xl overflow-hidden">
    {/* Header */}
    <div className="px-4 py-3 border-b border-outline-variant/10 flex gap-4">
      {[...Array(cols)].map((_, i) => (
        <Skel key={i} className="h-3 flex-1" style={{ maxWidth: i === 0 ? '8rem' : undefined }} />
      ))}
    </div>
    {/* Rows */}
    {[...Array(rows)].map((_, i) => (
      <div key={i} className="px-4 py-3 border-b border-outline-variant/10 flex gap-4 items-center">
        {[...Array(cols)].map((_, j) => (
          <Skel key={j} className="h-4 flex-1" style={{ opacity: 0.6 + (j % 2) * 0.2 }} />
        ))}
      </div>
    ))}
  </div>
);

// Kinder-Verzeichnis Skeleton
export const KinderSkeleton = () => (
  <div className="space-y-6 pb-20">
    <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
      <div className="space-y-2">
        <Skel className="h-3 w-32" />
        <Skel className="h-10 w-48" />
      </div>
      <div className="flex gap-2">
        <Skel className="h-9 w-32 rounded-xl" />
        <Skel className="h-9 w-32 rounded-xl" />
      </div>
    </div>
    {/* Search bar */}
    <Skel className="h-10 rounded-xl w-full" />
    <TableSkeleton rows={10} cols={4} />
  </div>
);

// Finanzen Skeleton
export const FinanzenSkeleton = () => (
  <div className="space-y-6 pb-20">
    <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
      <div className="space-y-2">
        <Skel className="h-3 w-40" />
        <Skel className="h-10 w-32" />
      </div>
      <Skel className="h-10 w-40 rounded-xl" />
    </div>
    {/* Stat Cards */}
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="bg-surface-container-lowest p-5 rounded-2xl space-y-2">
          <Skel className="h-3 w-20" />
          <Skel className="h-8 w-16" />
        </div>
      ))}
    </div>
    <TableSkeleton rows={8} cols={4} />
  </div>
);

// Tagesansicht Skeleton
export const TagesansichtSkeleton = () => (
  <div className="space-y-6 pb-20">
    <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
      <div className="space-y-2">
        <Skel className="h-3 w-32" />
        <Skel className="h-10 w-40" />
      </div>
      <Skel className="h-10 w-40 rounded-xl" />
    </div>
    {/* Tag-Chips */}
    <div className="flex flex-wrap gap-2">
      {[...Array(10)].map((_, i) => (
        <Skel key={i} className="h-9 w-20 rounded-full" />
      ))}
    </div>
    <TableSkeleton rows={10} cols={5} />
  </div>
);
