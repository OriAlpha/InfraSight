import { useState } from 'react';
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Inbox } from 'lucide-react';

export default function DataTable({
  columns,
  data,
  loading,
  emptyMessage = 'No data found',
  emptyDescription = 'There are no records to display.',
  onRowClick,
  pagination,
  sortBy,
  sortOrder,
  onSort,
}) {
  const handleHeaderClick = (col) => {
    if (!col.sortable || !onSort) return;
    const newOrder = sortBy === col.key && sortOrder === 'desc' ? 'asc' : 'desc';
    onSort(col.key, newOrder);
  };

  if (loading) {
    return (
      <div className="glass-card-static data-table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col.key}>{col.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 5 }).map((_, i) => (
              <tr key={i}>
                {columns.map((col) => (
                  <td key={col.key}>
                    <div className="skeleton skeleton-text" style={{ width: `${60 + Math.random() * 40}%` }} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="glass-card-static">
        <div className="empty-state">
          <Inbox size={48} className="empty-icon" />
          <h3>{emptyMessage}</h3>
          <p>{emptyDescription}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card-static data-table-wrapper">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={col.sortable ? 'sortable' : ''}
                onClick={() => handleHeaderClick(col)}
                style={col.width ? { width: col.width } : {}}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {col.label}
                  {col.sortable && sortBy === col.key && (
                    sortOrder === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr
              key={row.id || i}
              className={onRowClick ? 'clickable' : ''}
              onClick={() => onRowClick && onRowClick(row)}
            >
              {columns.map((col) => (
                <td key={col.key}>
                  {col.render ? col.render(row[col.key], row) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {pagination && pagination.totalPages > 1 && (
        <div className="pagination">
          <button
            className="pagination-btn"
            disabled={pagination.page <= 1}
            onClick={() => pagination.onPageChange(pagination.page - 1)}
          >
            <ChevronLeft size={16} />
          </button>

          {generatePageNumbers(pagination.page, pagination.totalPages).map((p, i) =>
            p === '...' ? (
              <span key={`ellipsis-${i}`} className="pagination-info">…</span>
            ) : (
              <button
                key={p}
                className={`pagination-btn ${p === pagination.page ? 'active' : ''}`}
                onClick={() => pagination.onPageChange(p)}
              >
                {p}
              </button>
            )
          )}

          <button
            className="pagination-btn"
            disabled={pagination.page >= pagination.totalPages}
            onClick={() => pagination.onPageChange(pagination.page + 1)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

function generatePageNumbers(current, total) {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages = [];
  pages.push(1);

  if (current > 3) {
    pages.push('...');
  }

  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);

  for (let i = start; i <= end; i++) {
    pages.push(i);
  }

  if (current < total - 2) {
    pages.push('...');
  }

  pages.push(total);
  return pages;
}
