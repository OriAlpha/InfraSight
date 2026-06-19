import {
  AreaChart as RechartsAreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

function CustomTooltip({ active, payload, label, formatY }) {
  if (!active || !payload || !payload.length) return null;

  return (
    <div className="chart-tooltip">
      <div className="label">{label}</div>
      {payload.map((entry, i) => (
        <div className="item" key={i}>
          <div className="dot" style={{ background: entry.color }} />
          <span>{entry.name}</span>
          <span className="value">
            {formatY ? formatY(entry.value) : entry.value?.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}

const defaultColors = ['#3b82f6', '#06b6d4', '#10b981', '#8b5cf6', '#f59e0b', '#f43f5e'];

export default function AreaChartComponent({
  data,
  xKey,
  yKeys,
  colors = defaultColors,
  height = 300,
  formatX,
  formatY,
  title,
  stacked = false,
  onClick,
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

  return (
    <div className="glass-card-static chart-container">
      {title && <div className="chart-title">{title}</div>}
      <ResponsiveContainer width="100%" height={height}>
        <RechartsAreaChart
          data={data}
          margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
          onClick={(state) => {
            if (onClick && state && state.activePayload && state.activePayload.length > 0) {
              onClick(state.activePayload[0].payload);
            }
          }}
          style={{ cursor: onClick ? 'pointer' : 'default' }}
        >
          <defs>
            {yKeys.map((key, i) => (
              <linearGradient key={key} id={`gradient-${key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={colors[i % colors.length]} stopOpacity={0.3} />
                <stop offset="95%" stopColor={colors[i % colors.length]} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey={xKey}
            tickFormatter={formatX}
            axisLine={false}
            tickLine={false}
            dy={10}
            tick={{ fontSize: 11 }}
          />
          <YAxis
            tickFormatter={formatY}
            axisLine={false}
            tickLine={false}
            dx={-10}
            tick={{ fontSize: 11 }}
            width={60}
          />
          <Tooltip content={<CustomTooltip formatY={formatY} />} cursor={{ stroke: 'rgba(255, 255, 255, 0.15)', strokeWidth: 1 }} />
          {yKeys.length > 1 && <Legend />}
          {yKeys.map((key, i) => (
            <Area
              key={key}
              type="monotone"
              dataKey={key}
              stroke={colors[i % colors.length]}
              strokeWidth={2}
              fill={`url(#gradient-${key})`}
              stackId={stacked ? 'stack' : undefined}
              animationDuration={800}
              animationBegin={i * 100}
            />
          ))}
        </RechartsAreaChart>
      </ResponsiveContainer>
    </div>
  );
}
