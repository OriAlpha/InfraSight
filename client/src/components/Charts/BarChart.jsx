import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Cell,
} from 'recharts';

function CustomTooltip({ active, payload, label, formatY }) {
  if (!active || !payload || !payload.length) return null;

  return (
    <div className="chart-tooltip">
      <div className="label">{label}</div>
      {payload.map((entry, i) => (
        <div className="item" key={i}>
          <div className="dot" style={{ background: entry.color || entry.fill }} />
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

export default function BarChartComponent({
  data,
  xKey,
  yKeys,
  colors = defaultColors,
  height = 300,
  formatX,
  formatY,
  title,
  stacked = false,
  colorByBar = false,
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
        <RechartsBarChart
          data={data}
          margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
          onClick={(state) => {
            if (onClick && state && state.activePayload && state.activePayload.length > 0) {
              onClick(state.activePayload[0].payload);
            }
          }}
          style={{ cursor: onClick ? 'pointer' : 'default' }}
        >
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
          <Tooltip content={<CustomTooltip formatY={formatY} />} cursor={{ fill: 'rgba(255, 255, 255, 0.05)' }} />
          {yKeys.length > 1 && <Legend />}
          {yKeys.map((key, i) => (
            <Bar
              key={key}
              dataKey={key}
              fill={colors[i % colors.length]}
              radius={[4, 4, 0, 0]}
              stackId={stacked ? 'stack' : undefined}
              animationDuration={800}
              animationBegin={i * 100}
            >
              {colorByBar &&
                data.map((entry, index) => (
                  <Cell key={index} fill={entry.color || colors[index % colors.length]} />
                ))}
            </Bar>
          ))}
        </RechartsBarChart>
      </ResponsiveContainer>
    </div>
  );
}
