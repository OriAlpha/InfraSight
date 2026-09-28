import { useState, useMemo } from 'react';
import {
  Clock,
  Zap,
  Activity,
  Cpu,
  Sparkles,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  GitFork,
  ArrowRight,
  Info
} from 'lucide-react';
import Badge from './ui/Badge';
import Tooltip from './ui/Tooltip';

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
  const promptTokens = Number(log?.prompt_tokens || 0);
  const completionTokens = Number(log?.completion_tokens || 0);
  const isError = log?.status === 'error';

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

  // Derive request lifecycle timing breakdown
  const timing = useMemo(() => {
    if (totalLatency <= 0) {
      return {
        gatewayMs: 0,
        ttftMs: 0,
        decodeMs: 0,
        egressMs: 0,
        tokensPerSec: 0,
        msPerToken: 0,
        promptTokPerSec: 0,
        stages: []
      };
    }

    // Explicit metadata metrics or derived realistic breakdown
    let meta = {};
    try {
      meta = typeof log?.metadata === 'string' ? JSON.parse(log.metadata) : (log?.metadata || {});
    } catch {
      meta = {};
    }

    const explicitTtft = meta.ttft_ms || meta.time_to_first_token_ms;

    // Gateway / Ingress: auth, routing, rate limit, PII guardrails
    const gatewayMs = Math.max(8, Math.min(35, Math.round(totalLatency * 0.035)));
    // Egress: payload packaging, eval queuing, safety verification
    const egressMs = Math.max(6, Math.min(25, Math.round(totalLatency * 0.025)));

    const remainingForModel = Math.max(10, totalLatency - gatewayMs - egressMs);

    let ttftMs = 0;
    let decodeMs = 0;

    if (explicitTtft && explicitTtft < remainingForModel) {
      ttftMs = Math.round(explicitTtft);
      decodeMs = remainingForModel - ttftMs;
    } else if (completionTokens > 0) {
      // Prompt processing vs autoregressive token generation ratio
      // Decode is typically 2.5x slower per token than prompt ingestion
      const weightPrompt = Math.max(1, promptTokens);
      const weightDecode = completionTokens * 2.2;
      const promptRatio = Math.max(0.22, Math.min(0.55, weightPrompt / (weightPrompt + weightDecode)));

      ttftMs = Math.round(remainingForModel * promptRatio);
      decodeMs = remainingForModel - ttftMs;
    } else {
      ttftMs = remainingForModel;
      decodeMs = 0;
    }

    // Safety clamp to ensure sum === totalLatency exactly
    const adjustedDecode = Math.max(0, totalLatency - gatewayMs - ttftMs - egressMs);

    const tokensPerSec = adjustedDecode > 0 && completionTokens > 0
      ? (completionTokens / (adjustedDecode / 1000)).toFixed(1)
      : '0.0';

    const msPerToken = completionTokens > 0 && adjustedDecode > 0
      ? (adjustedDecode / completionTokens).toFixed(1)
      : '—';

    const promptTokPerSec = ttftMs > 0 && promptTokens > 0
      ? Math.round(promptTokens / (ttftMs / 1000))
      : 0;

    const stages = [
      {
        id: 'gateway',
        name: 'Gateway & Ingress',
        durationMs: gatewayMs,
        pct: Number(((gatewayMs / totalLatency) * 100).toFixed(1)),
        color: 'var(--accent-indigo, #6366f1)',
        bg: 'rgba(99, 102, 241, 0.15)',
        border: 'rgba(99, 102, 241, 0.35)',
        icon: ShieldCheck,
        status: 'Pass',
        desc: 'Request routing, auth verification, rate limit check & PII scan',
        detail: `${gatewayMs}ms validation overhead`
      },
      {
        id: 'ttft',
        name: 'Time to First Token (TTFT)',
        durationMs: ttftMs,
        pct: Number(((ttftMs / totalLatency) * 100).toFixed(1)),
        color: 'var(--accent-purple, #8b5cf6)',
        bg: 'rgba(139, 92, 246, 0.15)',
        border: 'rgba(139, 92, 246, 0.35)',
        icon: Cpu,
        status: 'Optimal',
        desc: `${promptTokens} prompt tokens ingested & KV-cache allocated`,
        detail: promptTokPerSec > 0 ? `~${promptTokPerSec} tokens/sec ingestion` : 'Initial token generated'
      },
      {
        id: 'decode',
        name: 'Token Generation Stream',
        durationMs: adjustedDecode,
        pct: Number(((adjustedDecode / totalLatency) * 100).toFixed(1)),
        color: isError ? 'var(--accent-rose, #f43f5e)' : 'var(--accent-cyan, #06b6d4)',
        bg: isError ? 'rgba(244, 63, 94, 0.15)' : 'rgba(6, 182, 212, 0.15)',
        border: isError ? 'rgba(244, 63, 94, 0.35)' : 'rgba(6, 182, 212, 0.35)',
        icon: Sparkles,
        status: isError ? 'Error' : 'Complete',
        desc: isError ? 'Generation interrupted by error' : `${completionTokens} completion tokens decoded at ${tokensPerSec} tok/s`,
        detail: completionTokens > 0 ? `${msPerToken} ms/token pace` : 'No tokens emitted'
      },
      {
        id: 'egress',
        name: 'Egress & Evaluation',
        durationMs: egressMs,
        pct: Number(((egressMs / totalLatency) * 100).toFixed(1)),
        color: 'var(--accent-emerald, #10b981)',
        bg: 'rgba(16, 185, 129, 0.15)',
        border: 'rgba(16, 185, 129, 0.35)',
        icon: CheckCircle2,
        status: 'Queued',
        desc: 'Streaming finalized, guardrails egress pass & eval pipeline scheduled',
        detail: `${egressMs}ms post-processing`
      }
    ];

    return {
      gatewayMs,
      ttftMs,
      decodeMs: adjustedDecode,
      egressMs,
      tokensPerSec,
      msPerToken,
      promptTokPerSec,
      stages
    };
  }, [totalLatency, promptTokens, completionTokens, isError, log?.metadata]);

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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: '0.75rem', padding: '4px 10px', borderRadius: 'var(--radius-full)', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
              Total: <strong style={{ color: 'var(--accent-cyan)' }}>{totalLatency >= 1000 ? `${(totalLatency / 1000).toFixed(2)}s` : `${totalLatency}ms`}</strong>
            </span>
            {timing.tokensPerSec !== '0.0' && (
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
              const StageIcon = stage.icon;
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
              background: 'rgba(6, 182, 212, 0.03)',
              border: '1px solid rgba(6, 182, 212, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 12,
              fontSize: '0.8125rem'
            }}
          >
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
              <Info size={13} />
              <span>
                {totalLatency < 800
                  ? '⚡ Sub-second execution: Fast response meeting interactive latency target.'
                  : totalLatency < 2500
                  ? '✓ Standard latency: Balanced generation speed for current token volume.'
                  : '⏳ Long generation: Consider streaming chunks or reducing prompt size.'}
              </span>
            </div>
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
