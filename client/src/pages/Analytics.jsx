import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, subDays, startOfDay, eachDayOfInterval, parseISO } from 'date-fns';
import {
  DollarSign,
  Hash,
  Clock,
  Cpu,
  AlertTriangle,
  BookOpen,
  TrendingUp,
} from 'lucide-react';
import { useApi } from '../hooks/useApi';
import DateRangePicker from '../components/ui/DateRangePicker';
import AreaChart from '../components/Charts/AreaChart';
import BarChart from '../components/Charts/BarChart';
import DonutChart from '../components/Charts/DonutChart';

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

const tabs = [
  { key: 'cost', label: 'Cost', icon: DollarSign },
  { key: 'tokens', label: 'Tokens', icon: Hash },
  { key: 'latency', label: 'Latency', icon: Clock },
  { key: 'models', label: 'Models', icon: Cpu },
  { key: 'errors', label: 'Errors', icon: AlertTriangle },
];

export default function Analytics() {
  const [activeTab, setActiveTab] = useState('cost');
  const [dateRange, setDateRange] = useState({
    startDate: subDays(startOfDay(new Date()), 29).toISOString(),
    endDate: new Date().toISOString(),
  });

  const dateParams = useMemo(
    () => ({ startDate: dateRange.startDate, endDate: dateRange.endDate }),
    [dateRange.startDate, dateRange.endDate]
  );

  return (
    <div className="animate-slide-up">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h2>Analytics</h2>
            <p>Deep insights into your LLM API usage</p>
          </div>
          <DateRangePicker value={dateRange} onChange={setDateRange} />
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            className={`tab-btn ${activeTab === key ? 'active' : ''}`}
            onClick={() => setActiveTab(key)}
          >
            <Icon size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'cost' && <CostTab dateParams={dateParams} />}
      {activeTab === 'tokens' && <TokensTab dateParams={dateParams} />}
      {activeTab === 'latency' && <LatencyTab dateParams={dateParams} />}
      {activeTab === 'models' && <ModelsTab dateParams={dateParams} />}
      {activeTab === 'errors' && <ErrorsTab dateParams={dateParams} />}
    </div>
  );
}

function CostTab({ dateParams }) {
  const navigate = useNavigate();
  const { data: costData, loading } = useApi('/analytics/cost', {
    params: { ...dateParams, granularity: 'daily' },
  });
  const { data: modelData } = useApi('/analytics/models', { params: dateParams });

  const chartData = useMemo(() => {
    if (!costData) return [];
    const items = Array.isArray(costData) ? costData : costData.data || [];
    
    let days = [];
    try {
      days = eachDayOfInterval({
        start: parseISO(dateParams.startDate),
        end: parseISO(dateParams.endDate)
      });
    } catch (e) {
      return items.map((d) => ({
        date: format(new Date(d.date || d.period), 'MMM dd'),
        cost: Number(d.total_cost || d.cost || 0),
        rawDate: format(new Date(d.date || d.period), 'yyyy-MM-dd'),
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
        rawDate: format(day, 'yyyy-MM-dd'),
      };
    });
  }, [costData, dateParams]);

  const modelBreakdown = useMemo(() => {
    if (!modelData) return [];
    const items = Array.isArray(modelData) ? modelData : modelData.data || [];
    return items.map((d) => ({
      model: formatModelName(d.model),
      rawModel: d.model,
      cost: Number(d.total_cost || d.cost || 0),
      requests: Number(d.request_count || d.count || d.requests || 0),
    }));
  }, [modelData]);

  const totalCost = modelBreakdown.reduce((s, d) => s + d.cost, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {loading ? (
        <div className="glass-card-static chart-container">
          <div className="skeleton skeleton-chart" />
        </div>
      ) : (
        <AreaChart
          data={chartData}
          xKey="date"
          yKeys={['cost']}
          colors={['#10b981']}
          title="Daily Cost"
          formatY={formatCost}
          height={350}
          onClick={(payload) => {
            if (payload && payload.rawDate) {
              navigate(`/logs?startDate=${payload.rawDate}&endDate=${payload.rawDate}`);
            }
          }}
        />
      )}

      <div className="glass-card-static" style={{ padding: 24 }}>
        <div className="chart-title">Cost Breakdown by Model</div>
        {modelBreakdown.length === 0 ? (
          <div className="empty-state" style={{ padding: 32 }}>
            <p>No cost data available</p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Model</th>
                <th style={{ textAlign: 'right' }}>Requests</th>
                <th style={{ textAlign: 'right' }}>Cost</th>
                <th style={{ textAlign: 'right' }}>% of Total</th>
              </tr>
            </thead>
            <tbody>
              {modelBreakdown.map((d, i) => (
                <tr 
                  key={i}
                  className="clickable"
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/logs?model=${encodeURIComponent(d.rawModel)}`)}
                >
                  <td style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{d.model}</td>
                  <td style={{ textAlign: 'right' }}>{d.requests.toLocaleString()}</td>
                  <td style={{ textAlign: 'right', color: 'var(--accent-emerald)' }}>
                    ${d.cost.toFixed(6)}
                  </td>
                  <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                    {totalCost > 0 ? ((d.cost / totalCost) * 100).toFixed(1) : 0}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function TokensTab({ dateParams }) {
  const { data: tokenData, loading } = useApi('/analytics/tokens', { params: dateParams });
  const { data: overview } = useApi('/analytics/overview', { params: dateParams });

  const chartData = useMemo(() => {
    if (!tokenData) return [];
    const items = Array.isArray(tokenData) ? tokenData : tokenData.data || [];
    
    let days = [];
    try {
      days = eachDayOfInterval({
        start: parseISO(dateParams.startDate),
        end: parseISO(dateParams.endDate)
      });
    } catch (e) {
      return items.map((d) => ({
        date: format(new Date(d.date || d.period), 'MMM dd'),
        prompt: Number(d.prompt_tokens || d.input_tokens || 0),
        completion: Number(d.completion_tokens || d.output_tokens || 0),
        rawDate: format(new Date(d.date || d.period), 'yyyy-MM-dd'),
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
        rawDate: format(day, 'yyyy-MM-dd'),
      };
    });
  }, [tokenData, dateParams]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="analytics-kpi-grid">
        <div className="glass-card detail-meta-card">
          <div className="meta-label">Total Tokens</div>
          <div className="meta-value" style={{ color: 'var(--accent-blue)' }}>
            {Number(overview?.totalTokens || 0).toLocaleString()}
          </div>
        </div>
        <div className="glass-card detail-meta-card">
          <div className="meta-label">Avg Tokens / Request</div>
          <div className="meta-value" style={{ color: 'var(--accent-cyan)' }}>
            {overview?.totalRequests
              ? Math.round(
                  Number(overview?.totalTokens || 0) / Number(overview.totalRequests)
                ).toLocaleString()
              : '0'}
          </div>
        </div>
        <div className="glass-card detail-meta-card">
          <div className="meta-label">Total Requests</div>
          <div className="meta-value" style={{ color: 'var(--accent-purple)' }}>
            {Number(overview?.totalRequests || 0).toLocaleString()}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="glass-card-static chart-container">
          <div className="skeleton skeleton-chart" />
        </div>
      ) : (
        <AreaChart
          data={chartData}
          xKey="date"
          yKeys={['prompt', 'completion']}
          colors={['#3b82f6', '#06b6d4']}
          title="Token Usage Over Time"
          formatY={(v) => {
            if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M';
            if (v >= 1000) return (v / 1000).toFixed(1) + 'K';
            return v.toString();
          }}
          height={350}
          onClick={(payload) => {
            if (payload && payload.rawDate) {
              navigate(`/logs?startDate=${payload.rawDate}&endDate=${payload.rawDate}`);
            }
          }}
        />
      )}

      {!loading && (
        <div className="glass-card-static" style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <BookOpen size={16} style={{ color: 'var(--accent-blue)', flexShrink: 0 }} />
            <span>Understanding Token Types</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#3b82f6' }} />
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>Prompt Tokens (Input)</span>
              </div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                The raw context and instructions sent to the model (including system prompts, templates, variables, and past conversation history).
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#06b6d4' }} />
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>Completion Tokens (Output)</span>
              </div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                The actual response text generated by the model. Completion tokens typically carry a higher pricing rate per token than input prompts.
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LatencyTab({ dateParams }) {
  const { data: latencyData, loading } = useApi('/analytics/latency', { params: dateParams });

  const chartData = useMemo(() => {
    if (!latencyData) return [];
    const items = Array.isArray(latencyData) ? latencyData : latencyData.data || [];
    
    let days = [];
    try {
      days = eachDayOfInterval({
        start: parseISO(dateParams.startDate),
        end: parseISO(dateParams.endDate)
      });
    } catch (e) {
      return items.map((d) => ({
        date: format(new Date(d.date || d.period), 'MMM dd'),
        avg: Number(d.avg_latency || d.avg || 0),
        p50: Number(d.p50 || d.median || d.avg_latency || 0),
        p95: Number(d.p95 || 0),
        p99: Number(d.p99 || 0),
        rawDate: format(new Date(d.date || d.period), 'yyyy-MM-dd'),
      }));
    }

    const latencyMap = {};
    items.forEach((d) => {
      const dateStr = format(new Date(d.date || d.period), 'MMM dd');
      latencyMap[dateStr] = {
        avg: Number(d.avg_latency || d.avg || 0),
        p50: Number(d.p50 || d.median || d.avg_latency || 0),
        p95: Number(d.p95 || 0),
        p99: Number(d.p99 || 0),
      };
    });

    return days.map((day) => {
      const dateStr = format(day, 'MMM dd');
      const val = latencyMap[dateStr] || { avg: 0, p50: 0, p95: 0, p99: 0 };
      return {
        date: dateStr,
        avg: val.avg,
        p50: val.p50,
        p95: val.p95,
        p99: val.p99,
        rawDate: format(day, 'yyyy-MM-dd'),
      };
    });
  }, [latencyData, dateParams]);

  const hasPercentiles = chartData.some((d) => d.p95 > 0 || d.p99 > 0);
  const yKeys = hasPercentiles ? ['p50', 'p95', 'p99'] : ['avg'];
  const colors = hasPercentiles ? ['#06b6d4', '#f59e0b', '#f43f5e'] : ['#06b6d4'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {loading ? (
        <div className="glass-card-static chart-container">
          <div className="skeleton skeleton-chart" />
        </div>
      ) : (
        <AreaChart
          data={chartData}
          xKey="date"
          yKeys={yKeys}
          colors={colors}
          title="Latency Over Time"
          formatY={(v) => v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v.toFixed(0)}ms`}
          height={350}
          onClick={(payload) => {
            if (payload && payload.rawDate) {
              navigate(`/logs?startDate=${payload.rawDate}&endDate=${payload.rawDate}`);
            }
          }}
        />
      )}

      {!loading && hasPercentiles && (
        <div className="glass-card-static" style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <TrendingUp size={16} style={{ color: 'var(--accent-cyan)', flexShrink: 0 }} />
            <span>Understanding Latency Percentiles</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#06b6d4' }} />
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>P50 (Median)</span>
              </div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                Shows the average response speed. 50% of your requests are faster than this speed.
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#f59e0b' }} />
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>P95 Percentile</span>
              </div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                Worst-case speed for 95% of requests. Only 5% of requests took longer than this speed.
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#f43f5e' }} />
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>P99 Percentile</span>
              </div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                Extreme long-tail latency. 99% of requests are faster than this speed; useful for detecting worst-case lags.
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ModelsTab({ dateParams }) {
  const navigate = useNavigate();
  const { data: modelData, loading } = useApi('/analytics/models', { params: dateParams });

  const chartColors = ['#3b82f6', '#06b6d4', '#10b981', '#8b5cf6', '#f59e0b', '#f43f5e', '#6366f1', '#ec4899'];

  const barData = useMemo(() => {
    if (!modelData) return [];
    const items = Array.isArray(modelData) ? modelData : modelData.data || [];
    return items.map((d, i) => ({
      model: formatModelName(d.model),
      rawModel: d.model,
      requests: Number(d.request_count || d.count || d.requests || 0),
      color: chartColors[i % chartColors.length],
    }));
  }, [modelData]);

  const tableData = useMemo(() => {
    if (!modelData) return [];
    const items = Array.isArray(modelData) ? modelData : modelData.data || [];
    return items.map((d) => ({
      model: formatModelName(d.model),
      rawModel: d.model,
      requests: Number(d.request_count || d.count || d.requests || 0),
      tokens: Number(d.total_tokens || 0),
      cost: Number(d.total_cost || d.cost || 0),
      avgLatency: Number(d.avg_latency || 0),
    }));
  }, [modelData]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {loading ? (
        <div className="glass-card-static chart-container">
          <div className="skeleton skeleton-chart" />
        </div>
      ) : (
        <BarChart
          data={barData}
          xKey="model"
          yKeys={['requests']}
          title="Requests by Model"
          colorByBar
          height={350}
          onClick={(payload) => {
            if (payload && payload.rawModel) {
              navigate(`/logs?model=${encodeURIComponent(payload.rawModel)}`);
            }
          }}
        />
      )}

      <div className="glass-card-static" style={{ padding: 24 }}>
        <div className="chart-title">Model Comparison</div>
        {tableData.length === 0 ? (
          <div className="empty-state" style={{ padding: 32 }}>
            <p>No model data available</p>
          </div>
        ) : (
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Model</th>
                  <th style={{ textAlign: 'right' }}>Requests</th>
                  <th style={{ textAlign: 'right' }}>Tokens</th>
                  <th style={{ textAlign: 'right' }}>Cost</th>
                  <th style={{ textAlign: 'right' }}>Avg Latency</th>
                </tr>
              </thead>
              <tbody>
                {tableData.map((d, i) => (
                  <tr 
                    key={i}
                    className="clickable"
                    style={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/logs?model=${encodeURIComponent(d.rawModel)}`)}
                  >
                    <td style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{d.model}</td>
                    <td style={{ textAlign: 'right' }}>{d.requests.toLocaleString()}</td>
                    <td style={{ textAlign: 'right' }}>{d.tokens.toLocaleString()}</td>
                    <td style={{ textAlign: 'right', color: 'var(--accent-emerald)' }}>
                      ${d.cost.toFixed(6)}
                    </td>
                    <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                      {d.avgLatency > 0 ? (d.avgLatency >= 1000 ? `${(d.avgLatency / 1000).toFixed(2)}s` : `${d.avgLatency.toFixed(0)}ms`) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function ErrorsTab({ dateParams }) {
  const navigate = useNavigate();
  const { data: errorData, loading } = useApi('/analytics/errors', { params: dateParams });

  const chartData = useMemo(() => {
    if (!errorData) return [];
    const items = Array.isArray(errorData) ? errorData : errorData.data || [];
    
    let days = [];
    try {
      days = eachDayOfInterval({
        start: parseISO(dateParams.startDate),
        end: parseISO(dateParams.endDate)
      });
    } catch (e) {
      return items.map((d) => ({
        date: format(new Date(d.date || d.period), 'MMM dd'),
        errors: Number(d.error_count || d.errors || 0),
        errorRate: Number(d.error_rate || 0),
        rawDate: format(new Date(d.date || d.period), 'yyyy-MM-dd'),
      }));
    }

    const errorMap = {};
    items.forEach((d) => {
      const dateStr = format(new Date(d.date || d.period), 'MMM dd');
      errorMap[dateStr] = {
        errors: Number(d.error_count || d.errors || 0),
        errorRate: Number(d.error_rate || 0),
      };
    });

    return days.map((day) => {
      const dateStr = format(day, 'MMM dd');
      const val = errorMap[dateStr] || { errors: 0, errorRate: 0 };
      return {
        date: dateStr,
        errors: val.errors,
        errorRate: val.errorRate,
        rawDate: format(day, 'yyyy-MM-dd'),
      };
    });
  }, [errorData, dateParams]);

  const hasErrorRate = chartData.some((d) => d.errorRate > 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {loading ? (
        <div className="glass-card-static chart-container">
          <div className="skeleton skeleton-chart" />
        </div>
      ) : (
        <AreaChart
          data={chartData}
          xKey="date"
          yKeys={hasErrorRate ? ['errorRate'] : ['errors']}
          colors={['#f43f5e']}
          title={hasErrorRate ? 'Error Rate Over Time' : 'Errors Over Time'}
          formatY={hasErrorRate ? (v) => `${v.toFixed(1)}%` : undefined}
          height={350}
          onClick={(payload) => {
            if (payload && payload.rawDate) {
              navigate(`/logs?startDate=${payload.rawDate}&endDate=${payload.rawDate}`);
            }
          }}
        />
      )}

      {chartData.length > 0 && (
        <div className="glass-card-static" style={{ padding: 24 }}>
          <div className="chart-title">Error Details</div>
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th style={{ textAlign: 'right' }}>Errors</th>
                  {hasErrorRate && <th style={{ textAlign: 'right' }}>Error Rate</th>}
                </tr>
              </thead>
              <tbody>
                {chartData.map((d, i) => (
                  <tr 
                    key={i} 
                    className={d.errors > 0 ? "clickable" : ""}
                    style={{ cursor: d.errors > 0 ? 'pointer' : 'default' }}
                    onClick={() => {
                      if (d.errors > 0) {
                        navigate('/logs?status=error');
                      }
                    }}
                  >
                    <td>{d.date}</td>
                    <td style={{ textAlign: 'right', color: d.errors > 0 ? 'var(--accent-rose)' : 'var(--text-muted)' }}>
                      {d.errors}
                    </td>
                    {hasErrorRate && (
                      <td style={{ textAlign: 'right', color: d.errorRate > 5 ? 'var(--accent-rose)' : 'var(--text-muted)' }}>
                        {d.errorRate.toFixed(1)}%
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
