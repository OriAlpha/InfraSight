import { useState, useMemo } from 'react';
import {
  Clock,
  Zap,
  Activity,
  Cpu,
  Sparkles,
  ShieldCheck,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  GitFork,
  ArrowRight,
  Info,
  FileCode
} from 'lucide-react';
import Badge from './ui/Badge';
import Tooltip from './ui/Tooltip';

import { computeLatencyBreakdown } from '../utils/latencyBreakdown';

const ICON_MAP = {
  FileCode,
  ShieldCheck,
  Cpu,
  Sparkles,
  CheckCircle2,
};

/**
 * LatencyFlow component renders an interactive execution timeline and latency flow
 * for an LLM request or multi-span trace session.
 *
 * @param {Object} props
 * @param {Object} props.log - The current request log
 * @param {Object} [props.traceTree] - Optional trace execution tree for multi-span sessions
 */
export default function LatencyFlow({ log, traceTree }) {
  const [activeTab, setActiveTab] = useState('stages'); // 'stages' | 'waterfall'
  const [hoveredStage, setHoveredStage] = useState(null);

  const totalLatency = Number(log?.latency_ms || 0);

  // Check if trace has multiple spans to offer trace waterfall view
  const flattenedTraceSpans = useMemo(() => {
    if (!traceTree?.rootSpans || traceTree.rootSpans.length === 0) return [];
    const list = [];
    const traverse = (node, depth = 0) => {
      list.push({ ...node, depth });
      if (node.children && node.children.length > 0) {
        node.children.forEach(child => traverse(child, depth + 1));
      }
    };
    traceTree.rootSpans.forEach(root => traverse(root, 0));
    return list;
  }, [traceTree]);

  const hasMultipleSpans = flattenedTraceSpans.length > 1;

  // Derive request lifecycle timing breakdown using shared, thoroughly tested algorithm
  const timing = useMemo(() => {
    return computeLatencyBreakdown(log);
  }, [log]);

  // Waterfall timing for multi-span traces
  const traceWaterfall = useMemo(() => {
    if (!hasMultipleSpans) return null;

    let minTime = Infinity;
    let maxTime = -Infinity;

    flattenedTraceSpans.forEach(span => {
      const start = new Date(span.created_at.replace(' ', 'T')).getTime();
      const end = start + (Number(span.latency_ms) || 0);
      if (start < minTime) minTime = start;
      if (end > maxTime) maxTime = end;
    });

    const totalSpanWindow = Math.max(1, maxTime - minTime);

    const spans = flattenedTraceSpans.map(span => {
      const start = new Date(span.created_at.replace(' ', 'T')).getTime();
      const latency = Number(span.latency_ms) || 0;
      const offsetMs = Math.max(0, start - minTime);
      const leftPct = Math.min(98, Math.max(0, (offsetMs / totalSpanWindow) * 100));
      const widthPct = Math.max(2, Math.min(100 - leftPct, (latency / totalSpanWindow) * 100));

      const type = span.span_type || 'llm';
      let color = 'var(--accent-blue)';
      if (type === 'agent') color = 'var(--accent-purple)';
      else if (type === 'tool') color = 'var(--accent-emerald)';
      else if (type === 'chain') color = 'var(--accent-cyan)';
      else if (type === 'check') color = 'var(--accent-amber)';

      return {
        ...span,
        offsetMs,
        latencyMs: latency,
        leftPct,
        widthPct,
        color
      };
    });

    return {
      totalSpanWindow,
      spans
    };
  }, [flattenedTraceSpans, hasMultipleSpans]);

  if (totalLatency <= 0) return null;

  return (
    <div className="glass-card animate-slide-up" style={{ padding: 24, marginBottom: 28 }}>
      {/* Header & Tabs */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 'var(--radius-md)',
              background: 'rgba(6, 182, 212, 0.1)',
              border: '1px solid rgba(6, 182, 212, 0.25)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--accent-cyan)'
            }}
          >
            <Activity size={18} />
          </div>
          <div>
            <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
              Execution & Latency Flow
            </h4>
            <p style={{ margin: '2px 0 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Step-by-step breakdown of execution time, model inference, and token streaming
            </p>
          </div>
        </div>

        {/* Action / View Switcher */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {hasMultipleSpans && (
            <div className="tabs" style={{ display: 'inline-flex', padding: 2, background: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-sm)' }}>
              <button
                className={`tab-btn ${activeTab === 'stages' ? 'active' : ''}`}
                onClick={() => setActiveTab('stages')}
                style={{ fontSize: '0.75rem', padding: '4px 10px', height: 'auto' }}
              >
                <Zap size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                Lifecycle Stages
              </button>
              <button
                className={`tab-btn ${activeTab === 'waterfall' ? 'active' : ''}`}
                onClick={() => setActiveTab('waterfall')}
                style={{ fontSize: '0.75rem', padding: '4px 10px', height: 'auto' }}
              >
                <GitFork size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                Trace Waterfall ({flattenedTraceSpans.length} spans)
              </button>
            </div>
          )}

          {/* Quick Metrics Pills */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {timing.isGuardrailBlocked ? (
              <>
                <span
                  style={{
                    fontSize: '0.75rem',
                    padding: '4px 10px',
                    borderRadius: 'var(--radius-full)',
                    background: 'rgba(244, 63, 94, 0.12)',
                    border: '1px solid rgba(244, 63, 94, 0.3)',
                    color: 'var(--accent-rose)'
                  }}
                  title="Prompt was intercepted and rejected directly at the InfraSight gateway guardrail"
                >
                  🛡️ Guardrail Intercept: <strong style={{ color: '#fda4af' }}>{timing.infrasightMs}ms (100%)</strong>
                </span>
                <span
                  style={{
                    fontSize: '0.75rem',
                    padding: '4px 10px',
                    borderRadius: 'var(--radius-full)',
                    background: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-muted)'
                  }}
                  title="Upstream model was not invoked — zero inference latency incurred"
                >
                  🤖 Upstream LLM: <strong style={{ color: 'var(--text-secondary)' }}>0ms (Bypassed)</strong>
                </span>
                <span
                  style={{
                    fontSize: '0.75rem',
                    padding: '4px 10px',
                    borderRadius: 'var(--radius-full)',
                    background: 'rgba(16, 185, 129, 0.08)',
                    border: '1px solid rgba(16, 185, 129, 0.25)',
                    color: 'var(--accent-emerald)'
                  }}
                  title="Zero completion tokens generated — zero API inference cost billed"
                >
                  💰 Upstream Cost: <strong>$0.00</strong>
                </span>
              </>
            ) : (
              <>
                <span
                  style={{
                    fontSize: '0.75rem',
                    padding: '4px 10px',
                    borderRadius: 'var(--radius-full)',
                    background: 'rgba(99, 102, 241, 0.12)',
                    border: '1px solid rgba(99, 102, 241, 0.3)',
                    color: 'var(--accent-indigo)'
                  }}
                  title="Total latency added by InfraSight gateway routing, PII guardrails, and egress logging"
                >
                  ⚡ InfraSight: <strong style={{ color: '#a5b4fc' }}>{timing.infrasightMs}ms ({timing.infrasightPct}%)</strong>
                </span>
                <span
                  style={{
                    fontSize: '0.75rem',
                    padding: '4px 10px',
                    borderRadius: 'var(--radius-full)',
                    background: 'rgba(16, 185, 129, 0.1)',
                    border: '1px solid rgba(16, 185, 129, 0.25)',
                    color: 'var(--accent-emerald)'
                  }}
                  title="Time spent waiting on the upstream model inference (TTFT + decode generation)"
                >
                  🤖 Upstream LLM: <strong style={{ color: '#6ee7b7' }}>{timing.upstreamMs}ms ({timing.upstreamPct}%)</strong>
                </span>
              </>
            )}
            <span style={{ fontSize: '0.75rem', padding: '4px 10px', borderRadius: 'var(--radius-full)', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
              Total: <strong style={{ color: 'var(--accent-cyan)' }}>{totalLatency >= 1000 ? `${(totalLatency / 1000).toFixed(2)}s` : `${totalLatency}ms`}</strong>
            </span>
            {!timing.isGuardrailBlocked && timing.tokensPerSec !== '0.0' && (
              <span style={{ fontSize: '0.75rem', padding: '4px 10px', borderRadius: 'var(--radius-full)', background: 'rgba(6, 182, 212, 0.08)', border: '1px solid rgba(6, 182, 212, 0.2)', color: 'var(--accent-cyan)' }}>
                Speed: <strong>{timing.tokensPerSec} tok/s</strong>
              </span>
            )}
          </div>
        </div>
      </div>

      {activeTab === 'stages' ? (
        <>
          {/* Proportional Segmented Latency Flow Bar */}
          <div style={{ marginBottom: 20 }}>
            <div
              style={{
                display: 'flex',
                height: 18,
                width: '100%',
                borderRadius: 'var(--radius-full)',
                overflow: 'hidden',
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid var(--border)',
                boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.3)',
                position: 'relative'
              }}
            >
              {timing.stages.map((stage) => {
                const isHovered = hoveredStage === stage.id;
                return (
                  <div
                    key={stage.id}
                    onMouseEnter={() => setHoveredStage(stage.id)}
                    onMouseLeave={() => setHoveredStage(null)}
                    style={{
                      width: `${stage.pct}%`,
                      height: '100%',
                      background: stage.color,
                      opacity: hoveredStage ? (isHovered ? 1 : 0.45) : 0.9,
                      transition: 'all 0.2s ease',
                      cursor: 'pointer',
                      position: 'relative'
                    }}
                    title={`${stage.name}: ${stage.durationMs}ms (${stage.pct}%)`}
                  />
                );
              })}
            </div>

            {/* Stage Legend */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 10, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {timing.stages.map((stage) => {
                const isHovered = hoveredStage === stage.id;
                return (
                  <div
                    key={stage.id}
                    onMouseEnter={() => setHoveredStage(stage.id)}
                    onMouseLeave={() => setHoveredStage(null)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      cursor: 'pointer',
                      opacity: hoveredStage ? (isHovered ? 1 : 0.5) : 1,
                      transition: 'opacity 0.15s ease'
                    }}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: stage.color, display: 'inline-block' }} />
                    <span style={{ color: isHovered ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: isHovered ? 600 : 400 }}>
                      {stage.name}
                    </span>
                    <span className="mono" style={{ color: stage.color, fontWeight: 600 }}>
                      {stage.durationMs}ms ({stage.pct}%)
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Detailed Stage Cards Grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
              gap: 12
            }}
          >
            {timing.stages.map((stage, idx) => {
              const StageIcon = ICON_MAP[stage.icon] || Activity;
              const isHovered = hoveredStage === stage.id;

              return (
                <div
                  key={stage.id}
                  onMouseEnter={() => setHoveredStage(stage.id)}
                  onMouseLeave={() => setHoveredStage(null)}
                  style={{
                    background: isHovered ? stage.bg : 'rgba(255, 255, 255, 0.02)',
                    border: `1px solid ${isHovered ? stage.border : 'var(--border)'}`,
                    borderRadius: 'var(--radius-md)',
                    padding: '14px 16px',
                    transition: 'all 0.2s ease',
                    position: 'relative'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                        Step 0{idx + 1}
                      </span>
                    </div>
                    <span
                      style={{
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        color: stage.color,
                        background: 'rgba(255, 255, 255, 0.04)',
                        padding: '2px 8px',
                        borderRadius: 'var(--radius-full)'
                      }}
                    >
                      {stage.pct}%
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <StageIcon size={16} style={{ color: stage.color, flexShrink: 0 }} />
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {stage.name}
                    </span>
                  </div>

                  <div style={{ fontSize: '1.15rem', fontWeight: 700, color: stage.color, marginBottom: 6 }} className="mono">
                    {stage.durationMs}ms
                  </div>

                  <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                    {stage.desc}
                  </p>

                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255, 255, 255, 0.04)', fontSize: '0.7rem', color: 'var(--text-dim)' }}>
                    {stage.detail}
                  </div>

                  {/* Detailed Pipeline Steps Checklist */}
                  {stage.steps && stage.steps.length > 0 && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>
                      <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
                        Steps Involved
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {stage.steps.map((st, sIdx) => {
                          const isBypassed = st.state === 'bypassed';
                          const isSkipped = st.state === 'skipped';
                          const isErr = st.state === 'error';

                          return (
                            <div key={sIdx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, fontSize: '0.72rem' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                                {isErr ? (
                                  <AlertTriangle size={12} style={{ color: 'var(--accent-rose)', flexShrink: 0 }} />
                                ) : isBypassed ? (
                                  <Info size={12} style={{ color: 'var(--accent-amber)', flexShrink: 0 }} />
                                ) : isSkipped ? (
                                  <Clock size={12} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
                                ) : (
                                  <CheckCircle2 size={12} style={{ color: stage.color, flexShrink: 0 }} />
                                )}
                                <span style={{
                                  color: isBypassed || isSkipped ? 'var(--text-muted)' : 'var(--text-secondary)',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap'
                                }}>
                                  {st.name}
                                </span>
                              </div>
                              <span
                                style={{
                                  color: isErr ? 'var(--accent-rose)' : isBypassed ? 'var(--accent-amber)' : isSkipped ? 'var(--text-dim)' : 'var(--text-secondary)',
                                  fontSize: '0.68rem',
                                  flexShrink: 0,
                                  fontWeight: isBypassed ? 600 : 400
                                }}
                                className="mono"
                              >
                                {st.status}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Throughput & Performance Summary Banner */}
          <div
            style={{
              marginTop: 16,
              padding: '12px 16px',
              borderRadius: 'var(--radius-md)',
              background: timing.isGuardrailBlocked ? 'rgba(244, 63, 94, 0.04)' : 'rgba(6, 182, 212, 0.03)',
              border: `1px solid ${timing.isGuardrailBlocked ? 'rgba(244, 63, 94, 0.2)' : 'rgba(6, 182, 212, 0.15)'}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 12,
              fontSize: '0.8125rem'
            }}
          >
            {timing.isGuardrailBlocked ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)' }}>
                  <ShieldAlert size={15} style={{ color: 'var(--accent-rose)' }} />
                  <span>
                    Gateway Guardrail Intercept: <strong style={{ color: 'var(--text-primary)' }}>Upstream inference bypassed. Zero tokens billed to model.</strong>
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                  <ShieldCheck size={14} style={{ color: 'var(--accent-indigo)', flexShrink: 0 }} />
                  <span>
                    InfraSight Security Policy: <strong>{timing.infrasightMs}ms (100%)</strong> · <strong style={{ color: 'var(--accent-emerald)' }}>⚡ Intercepted in {totalLatency}ms</strong>
                  </span>
                </div>
              </>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)' }}>
                  <Zap size={15} style={{ color: 'var(--accent-cyan)' }} />
                  <span>
                    Streaming Speed: <strong style={{ color: 'var(--text-primary)' }}>{timing.tokensPerSec} tokens/sec</strong>
                  </span>
                  <span style={{ color: 'var(--text-dim)' }}>•</span>
                  <span>
                    Inter-token Latency: <strong style={{ color: 'var(--text-primary)' }}>{timing.msPerToken}</strong>
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                  <ShieldCheck size={14} style={{ color: 'var(--accent-indigo)', flexShrink: 0 }} />
                  <span>
                    InfraSight overhead: <strong>{timing.infrasightMs}ms ({timing.infrasightPct}%)</strong> vs Upstream LLM: <strong>{timing.upstreamMs}ms ({timing.upstreamPct}%)</strong>
                    {' · '}
                    <strong style={{ color: timing.infrasightPct < 8 ? 'var(--accent-emerald)' : 'var(--accent-amber)' }}>
                      {timing.infrasightPct < 8 ? '⚡ Negligible proxy latency' : '✓ Normal proxy throughput'}
                    </strong>
                  </span>
                </div>
              </>
            )}
          </div>
        </>
      ) : (
        /* Multi-Span Trace Waterfall Mode */
        traceWaterfall && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Timeline scale header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-dim)', borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
              <span>0ms (Trace Start)</span>
              <span>{(traceWaterfall.totalSpanWindow / 2).toFixed(0)}ms</span>
              <span>{traceWaterfall.totalSpanWindow}ms (End)</span>
            </div>

            {/* Waterfall bars */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
              {traceWaterfall.spans.map((span) => {
                const isCurrentLog = span.id === log.id || span.span_id === log.span_id;
                return (
                  <div
                    key={span.span_id}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-sm)',
                      background: isCurrentLog ? 'rgba(59, 130, 246, 0.08)' : 'rgba(255, 255, 255, 0.015)',
                      border: isCurrentLog ? '1px solid rgba(59, 130, 246, 0.3)' : '1px solid var(--border)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: span.depth * 16 }}>
                        <span style={{ fontSize: '0.65rem', fontWeight: 600, padding: '1px 6px', borderRadius: 4, background: 'rgba(255,255,255,0.06)', color: span.color, textTransform: 'uppercase' }}>
                          {span.span_type || 'span'}
                        </span>
                        <strong style={{ color: isCurrentLog ? 'var(--accent-blue)' : 'var(--text-primary)' }}>
                          {span.span_name}
                        </strong>
                        {isCurrentLog && (
                          <span style={{ fontSize: '0.65rem', color: 'var(--accent-blue)', background: 'rgba(59, 130, 246, 0.15)', padding: '1px 6px', borderRadius: 4 }}>
                            Current Log
                          </span>
                        )}
                      </div>
                      <span className="mono" style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>
                        {span.latencyMs}ms
                      </span>
                    </div>

                    {/* Timeline bar track */}
                    <div style={{ width: '100%', height: 12, background: 'rgba(255, 255, 255, 0.03)', borderRadius: 6, position: 'relative', overflow: 'hidden' }}>
                      <div
                        style={{
                          position: 'absolute',
                          left: `${span.leftPct}%`,
                          width: `${span.widthPct}%`,
                          height: '100%',
                          background: span.color,
                          borderRadius: 6,
                          opacity: 0.85
                        }}
                        title={`+${span.offsetMs}ms · Duration: ${span.latencyMs}ms`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )
      )}
    </div>
  );
}
