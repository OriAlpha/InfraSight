import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, DollarSign, Clock, AlertTriangle, Zap } from 'lucide-react';
import { format, subDays, startOfDay, eachDayOfInterval, parseISO } from 'date-fns';
import { useApi } from '../hooks/useApi';
import KPICard from '../components/ui/KPICard';
import DateRangePicker from '../components/ui/DateRangePicker';
import AreaChart from '../components/Charts/AreaChart';
import DonutChart from '../components/Charts/DonutChart';
import Badge from '../components/ui/Badge';

function formatModelName(name) {
  if (!name) return 'Unknown';
  const parts = name.split('/');
  return parts[parts.length - 1];
}

const formatCost = (val) => {
  const num = Number(val || 0);
  if (num === 0) return '$0.00';
  if (num < 0.001) return `$${num.toFixed(6)}`;
  if (num < 0.01) return `$${num.toFixed(4)}`;
  return `$${num.toFixed(2)}`;
};

export default function Dashboard() {
  const navigate = useNavigate();
  const [dateRange, setDateRange] = useState({
    startDate: subDays(startOfDay(new Date()), 6).toISOString(),
    endDate: new Date().toISOString(),
  });

  const dateParams = useMemo(
    () => ({ startDate: dateRange.startDate, endDate: dateRange.endDate }),
    [dateRange.startDate, dateRange.endDate]
  );

  const { data: overview, loading: overviewLoading } = useApi('/analytics/overview', { params: dateParams });
  const { data: costData, loading: costLoading } = useApi('/analytics/cost', {
    params: { ...dateParams, granularity: 'daily' },
  });
  const { data: tokenData, loading: tokenLoading } = useApi('/analytics/tokens', { params: dateParams });
  const { data: modelData, loading: modelLoading } = useApi('/analytics/models', { params: dateParams });
  const { data: recentLogs, loading: recentLoading } = useApi('/logs', {
    params: { limit: 5, sortBy: 'created_at', sortOrder: 'desc' },
  });

  const formatCostValue = (v) => {
    if (v === null || v === undefined) return '$0.00';
    return `$${Number(v).toFixed(4)}`;
  };

  const formatNumber = (v) => {
    if (v === null || v === undefined) return '0';
    if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M';
    if (v >= 1000) return (v / 1000).toFixed(1) + 'K';
    return v.toLocaleString();
  };

  const costChartData = useMemo(() => {
    if (!costData) return [];
    const items = Array.isArray(costData) ? costData : costData.data || [];
    
    let days = [];
    try {
      days = eachDayOfInterval({
        start: parseISO(dateRange.startDate),
        end: parseISO(dateRange.endDate)
      });
    } catch (e) {
      return items.map((d) => ({
        date: format(new Date(d.date || d.period), 'MMM dd'),
        cost: Number(d.total_cost || d.cost || 0),
      }));
    }

    const costMap = {};
    items.forEach((d) => {
      const dateStr = format(new Date(d.date || d.period), 'MMM dd');
      const costVal = Number(d.total_cost || d.cost || 0);
      costMap[dateStr] = (costMap[dateStr] || 0) + costVal;
    });

    return days.map((day) => {
      const dateStr = format(day, 'MMM dd');
      return {
        date: dateStr,
        cost: costMap[dateStr] || 0,
      };
    });
  }, [costData, dateRange]);

  const tokenChartData = useMemo(() => {
    if (!tokenData) return [];
    const items = Array.isArray(tokenData) ? tokenData : tokenData.data || [];
    
    let days = [];
    try {
      days = eachDayOfInterval({
        start: parseISO(dateRange.startDate),
        end: parseISO(dateRange.endDate)
      });
    } catch (e) {
      return items.map((d) => ({
        date: format(new Date(d.date || d.period), 'MMM dd'),
        prompt: Number(d.prompt_tokens || d.input_tokens || 0),
        completion: Number(d.completion_tokens || d.output_tokens || 0),
      }));
    }

    const tokenMap = {};
    items.forEach((d) => {
      const dateStr = format(new Date(d.date || d.period), 'MMM dd');
      const promptVal = Number(d.prompt_tokens || d.input_tokens || d.promptTokens || 0);
      const completionVal = Number(d.completion_tokens || d.output_tokens || d.completionTokens || 0);
      
      if (!tokenMap[dateStr]) {
        tokenMap[dateStr] = { prompt: 0, completion: 0 };
      }
      tokenMap[dateStr].prompt += promptVal;
      tokenMap[dateStr].completion += completionVal;
    });

    return days.map((day) => {
      const dateStr = format(day, 'MMM dd');
      const val = tokenMap[dateStr] || { prompt: 0, completion: 0 };
      return {
        date: dateStr,
        prompt: val.prompt,
        completion: val.completion,
      };
    });
  }, [tokenData, dateRange]);

  const donutData = useMemo(() => {
    if (!modelData) return [];
    const items = Array.isArray(modelData) ? modelData : modelData.data || [];
    const colors = ['#3b82f6', '#06b6d4', '#10b981', '#8b5cf6', '#f59e0b', '#f43f5e', '#6366f1', '#ec4899'];
    return items.slice(0, 8).map((d, i) => ({
      name: formatModelName(d.model),
      value: Number(d.request_count || d.count || d.requests || 0),
      color: colors[i % colors.length],
    }));
  }, [modelData]);

  const costSparkline = costChartData.map((d) => d.cost);

  const recentList = recentLogs?.data || recentLogs?.logs || (Array.isArray(recentLogs) ? recentLogs : []);

  return (
    <div className="animate-slide-up">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2>Dashboard</h2>
            <p>Overview of your LLM API usage</p>
          </div>
          <DateRangePicker value={dateRange} onChange={setDateRange} />
        </div>
      </div>

      {/* KPI Cards */}
      <div className="kpi-grid">
        {overviewLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="glass-card kpi-card">
              <div className="skeleton skeleton-card" />
            </div>
          ))
        ) : (
          <>
            <KPICard
              title="Total Requests"
              value={formatNumber(overview?.totalRequests)}
              change={overview?.requestsChange}
              changeType={overview?.requestsChange >= 0 ? 'positive' : 'negative'}
              icon={Activity}
              color="#3b82f6"
            />
            <KPICard
              title="Total Cost"
              value={formatCost(overview?.totalCost)}
              change={overview?.costChange}
              changeType={overview?.costChange >= 0 ? 'positive' : 'negative'}
              icon={DollarSign}
              color="#10b981"
            />
            <KPICard
              title="Avg Latency"
              value={overview?.avgLatency ? (Number(overview.avgLatency) >= 1000 ? `${(Number(overview.avgLatency) / 1000).toFixed(2)}s` : `${Number(overview.avgLatency).toFixed(0)}ms`) : '0ms'}
              icon={Clock}
              color="#06b6d4"
            />
            <KPICard
              title="Error Rate"
              value={`${Number(overview?.errorRate || 0).toFixed(1)}%`}
              icon={AlertTriangle}
              color={Number(overview?.errorRate || 0) > 5 ? '#f43f5e' : '#f59e0b'}
            />
          </>
        )}
      </div>

      {/* Charts Grid */}
      <div className="charts-grid">
        {costLoading ? (
          <div className="glass-card-static chart-container">
            <div className="skeleton skeleton-chart" />
          </div>
        ) : (
          <AreaChart
            data={costChartData}
            xKey="date"
            yKeys={['cost']}
            colors={['#10b981']}
            title="Cost Over Time"
            formatY={formatCost}
          />
        )}

        {tokenLoading ? (
          <div className="glass-card-static chart-container">
            <div className="skeleton skeleton-chart" />
          </div>
        ) : (
          <AreaChart
            data={tokenChartData}
            xKey="date"
            yKeys={['prompt', 'completion']}
            colors={['#3b82f6', '#06b6d4']}
            title="Token Usage"
            formatY={formatNumber}
          />
        )}

        {modelLoading ? (
          <div className="glass-card-static chart-container">
            <div className="skeleton skeleton-chart" />
          </div>
        ) : (
          <DonutChart
            data={donutData}
            title="Model Distribution"
            valueFormatter={formatNumber}
          />
        )}

        {/* Recent Requests */}
        <div className="glass-card-static chart-container">
          <div className="chart-title">
            <Zap size={16} style={{ color: 'var(--accent-amber)' }} />
            Recent Requests
          </div>
          {recentLoading ? (
            <div className="skeleton skeleton-chart" />
          ) : recentList.length === 0 ? (
            <div className="empty-state" style={{ padding: '32px' }}>
              <p>No recent requests</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {recentList.map((log) => (
                <div
                  key={log.id}
                  onClick={() => navigate(`/logs/${log.id}`)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 12px',
                    borderRadius: 'var(--radius-md)',
                    cursor: 'pointer',
                    transition: 'background 150ms ease',
                    background: 'transparent',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-card-hover)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <Badge variant={log.status === 'success' ? 'success' : log.status === 'error' ? 'error' : 'warning'}>
                    {typeof log.status === 'string' ? log.status.charAt(0).toUpperCase() + log.status.slice(1) : log.status || '—'}
                  </Badge>
                  <span
                    style={{
                      flex: 1,
                      fontSize: '0.8125rem',
                      color: 'var(--text-secondary)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {formatModelName(log.model)}
                  </span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', flexShrink: 0 }}>
                    {log.total_tokens || 0} tok
                  </span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', flexShrink: 0 }}>
                    {formatCostValue(log.cost)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
