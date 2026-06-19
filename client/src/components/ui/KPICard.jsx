import { TrendingUp, TrendingDown } from 'lucide-react';
import SparkLine from '../Charts/SparkLine';

export default function KPICard({
  title,
  value,
  change,
  changeType,
  icon: Icon,
  color = 'var(--accent-blue)',
  sparklineData,
}) {
  const isPositive = changeType === 'positive';
  const changeColor = isPositive ? 'positive' : 'negative';

  return (
    <div className="glass-card kpi-card" style={{ padding: '20px 20px', display: 'flex', flexDirection: 'column', position: 'relative', minHeight: 120 }}>
      {/* Top Accent Gradient Border */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: `linear-gradient(90deg, ${color}, transparent)` }} />

      <div className="kpi-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, width: '100%' }}>
        <div className="kpi-label" style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
          {title}
        </div>
        <div
          className="kpi-icon"
          style={{
            background: `linear-gradient(135deg, ${color}20 0%, ${color}02 100%)`,
            color: color,
            border: `1px solid ${color}30`,
            boxShadow: `0 0 10px ${color}12`,
            borderRadius: 'var(--radius-md)',
            width: 32,
            height: 32,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}
        >
          {Icon && <Icon size={16} />}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px 10px', marginTop: 'auto', zIndex: 2, flexWrap: 'wrap' }}>
        <div className="kpi-value" style={{ fontSize: 'clamp(1.3rem, 4.5vw, 1.85rem)', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.03em', lineHeight: 1 }}>
          {value}
        </div>
        {change !== undefined && change !== null && (
          <div 
            className={`kpi-change ${changeColor}`}
            style={{ 
              display: 'inline-flex', 
              alignItems: 'center', 
              gap: 3, 
              fontSize: '0.75rem', 
              fontWeight: 600,
              padding: '2px 8px',
              borderRadius: 'var(--radius-full)',
              background: isPositive ? 'rgba(16, 185, 129, 0.05)' : 'rgba(244, 63, 94, 0.05)',
              border: isPositive ? '1px solid rgba(16, 185, 129, 0.18)' : '1px solid rgba(244, 63, 94, 0.18)',
              color: isPositive ? 'var(--accent-emerald)' : 'var(--accent-rose)'
            }}
          >
            {isPositive ? (
              <TrendingUp size={11} />
            ) : (
              <TrendingDown size={11} />
            )}
            <span>{Math.abs(change).toFixed(1)}%</span>
          </div>
        )}
      </div>

      {sparklineData && sparklineData.length > 0 && (
        <div className="kpi-sparkline" style={{ position: 'absolute', bottom: 4, right: 12, opacity: 0.25, pointerEvents: 'none' }}>
          <SparkLine data={sparklineData} color={color} width={100} height={28} />
        </div>
      )}
    </div>
  );
}
