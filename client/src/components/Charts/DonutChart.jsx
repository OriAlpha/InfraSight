import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

const defaultColors = ['#3b82f6', '#06b6d4', '#10b981', '#8b5cf6', '#f59e0b', '#f43f5e', '#6366f1', '#ec4899'];

function CustomTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const entry = payload[0];
  return (
    <div className="chart-tooltip">
      <div className="item">
        <div className="dot" style={{ background: entry.payload.fill || entry.payload.color }} />
        <span>{entry.name}</span>
        <span className="value">{entry.value?.toLocaleString()}</span>
      </div>
    </div>
  );
}

export default function DonutChart({
  data,
  title,
  height = 300,
  colors = defaultColors,
  valueFormatter,
}) {
  if (!data || data.length === 0) {
    return (
      <div className="glass-card-static chart-container">
        {title && <div className="chart-title">{title}</div>}
        <div className="empty-state" style={{ padding: '40px 24px', minHeight: height }}>
          <p style={{ color: 'var(--text-dim)' }}>No data available</p>
        </div>
      </div>
    );
  }

  const total = data.reduce((sum, d) => sum + (d.value || 0), 0);

  return (
    <div className="glass-card-static chart-container">
      {title && <div className="chart-title">{title}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
        <div style={{ flex: '0 0 auto', position: 'relative' }}>
          <ResponsiveContainer width={height - 40} height={height - 40}>
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius="60%"
                outerRadius="85%"
                paddingAngle={3}
                dataKey="value"
                animationDuration={800}
                stroke="none"
              >
                {data.map((entry, index) => (
                  <Cell
                    key={index}
                    fill={entry.color || colors[index % colors.length]}
                  />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              textAlign: 'center',
              pointerEvents: 'none',
            }}
          >
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {valueFormatter ? valueFormatter(total) : total.toLocaleString()}
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: 2 }}>Total</div>
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 140 }}>
          {data.map((entry, i) => {
            const pct = total > 0 ? ((entry.value / total) * 100).toFixed(1) : 0;
            return (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '6px 0',
                  fontSize: '0.8125rem',
                }}
              >
                <div
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 3,
                    background: entry.color || colors[i % colors.length],
                    flexShrink: 0,
                  }}
                />
                <span style={{ color: 'var(--text-secondary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {entry.name}
                </span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', flexShrink: 0 }}>
                  {pct}%
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
