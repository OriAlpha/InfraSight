import { AreaChart, Area, ResponsiveContainer } from 'recharts';

export default function SparkLine({
  data,
  color = '#3b82f6',
  width = 100,
  height = 32,
}) {
  if (!data || data.length === 0) return null;

  const chartData = data.map((value, i) => ({ v: value, i }));
  const safeId = `spark-${color.replace(/[^a-zA-Z0-9]/g, '')}`;

  return (
    <ResponsiveContainer width={width} height={height}>
      <AreaChart data={chartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={safeId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="v"
          stroke={color}
          strokeWidth={1.5}
          fill={`url(#${safeId})`}
          dot={false}
          activeDot={false}
          animationDuration={600}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
