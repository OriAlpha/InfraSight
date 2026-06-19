import { useState, useEffect, useMemo } from 'react';
import { 
  GitFork, 
  Clock, 
  Coins, 
  ChevronRight, 
  ChevronDown, 
  Layers, 
  Search, 
  Database, 
  AlertCircle, 
  Cpu, 
  Terminal, 
  Activity,
  ThumbsUp,
  ThumbsDown,
  Sparkles,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useApi } from '../hooks/useApi';
import JsonViewer from '../components/ui/JsonViewer';
import Badge from '../components/ui/Badge';
import { parseDate } from '../utils/date';

/**
 * TracesView — Reusable trace explorer component.
 * Accepts shared filters from parent (Logs page unified view).
 *
 * Props:
 *  - modelFilter: string
 *  - statusFilter: string
 *  - dateRange: { startDate: string, endDate: string }
 *  - focusTraceId: optional trace_id to auto-select on mount
 */
export default function TracesView({ modelFilter, statusFilter, dateRange, focusTraceId }) {
  const [selectedTraceId, setSelectedTraceId] = useState(focusTraceId || null);
  const [selectedSpanId, setSelectedSpanId] = useState(null);
  const [page, setPage] = useState(1);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [modelFilter, statusFilter, dateRange?.startDate, dateRange?.endDate]);

  // Auto-select focusTraceId when it changes
  useEffect(() => {
    if (focusTraceId) {
      setSelectedTraceId(focusTraceId);
    }
  }, [focusTraceId]);

  const traceParams = useMemo(() => ({
    page,
    limit: 15,
    startDate: dateRange?.startDate || undefined,
    endDate: dateRange?.endDate || undefined,
    model: modelFilter || undefined,
    status: statusFilter || undefined,
  }), [page, dateRange?.startDate, dateRange?.endDate, modelFilter, statusFilter]);

  const { data: tracesData, loading: loadingTraces, error: tracesError, refetch: refetchTraces } = useApi('/traces', {
    params: traceParams
  });

  const { data: treeData, loading: loadingTree, error: treeError, refetch: refetchTree } = useApi(
    selectedTraceId ? `/traces/${selectedTraceId}` : null
  );

  const handleUpdateSpanStatus = async (spanId, newStatus) => {
    try {
      await fetchApi(`/logs/${spanId}/status`, {
        method: 'PATCH',
        body: { status: newStatus },
      });
      refetchTree();
      refetchTraces();
      // Delay a second refetch to allow the background script to resume and log the next span
      setTimeout(() => {
        refetchTree();
        refetchTraces();
      }, 1500);
    } catch (err) {
      alert('Failed to update span status: ' + err.message);
    }
  };

  const traces = tracesData?.data || [];
  const totalPages = tracesData?.totalPages || 1;

  // Flatten spans map for quick lookup
  const spansMap = useMemo(() => {
    if (!treeData?.rootSpans) return {};
    const map = {};
    const traverse = (node) => {
      map[node.span_id] = node;
      if (node.children) {
        node.children.forEach(traverse);
      }
    };
    treeData.rootSpans.forEach(traverse);
    return map;
  }, [treeData]);

  const selectedSpan = selectedSpanId ? spansMap[selectedSpanId] : null;

  // Auto-select first trace on load
  useEffect(() => {
    if (traces.length > 0 && !selectedTraceId) {
      setSelectedTraceId(traces[0].trace_id);
    }
  }, [traces, selectedTraceId]);

  // Auto-select root span when trace changes
  useEffect(() => {
    if (treeData?.rootSpans && treeData.rootSpans.length > 0) {
      setSelectedSpanId(treeData.rootSpans[0].span_id);
    } else {
      setSelectedSpanId(null);
    }
  }, [treeData]);

  return (
    <div className="traces-page-grid">
      {/* Left Column: Trace List */}
      <div className="glass-card-static traces-list-column">
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Activity size={14} /> Trace Sessions
        </span>
        
        {loadingTraces ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="skeleton" style={{ height: 70, borderRadius: 'var(--radius-md)' }} />
            ))}
          </div>
        ) : tracesError ? (
          <div style={{ padding: 16, color: 'var(--accent-rose)', fontSize: '0.85rem', textAlign: 'center' }}>
            Error: {tracesError}
          </div>
        ) : traces.length === 0 ? (
          <div className="empty-state" style={{ padding: '40px 10px', textAlign: 'center' }}>
            <GitFork size={36} className="empty-icon" style={{ marginBottom: 12 }} />
            <h4 style={{ fontSize: '0.9rem', marginBottom: 6 }}>No traces found</h4>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Trace headers must be sent with proxy requests to create sessions.</p>
          </div>
        ) : (
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, paddingRight: 4 }}>
            {traces.map((trace) => {
              const isSelected = trace.trace_id === selectedTraceId;
              return (
                <div
                  key={trace.trace_id}
                  onClick={() => setSelectedTraceId(trace.trace_id)}
                  className="glass-card"
                  style={{
                    padding: 12,
                    cursor: 'pointer',
                    borderRadius: 'var(--radius-md)',
                    background: isSelected ? 'var(--bg-card-hover)' : 'var(--bg-card)',
                    borderColor: isSelected ? 'rgba(59, 130, 246, 0.4)' : 'var(--border)',
                    boxShadow: isSelected ? 'var(--shadow-glow-blue)' : 'none',
                    transform: 'none'
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                    {trace.name}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 12px', marginTop: 8, fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Clock size={11} />
                      {trace.total_latency_ms >= 1000 
                        ? `${(trace.total_latency_ms / 1000).toFixed(2)}s` 
                        : `${trace.total_latency_ms}ms`}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--accent-emerald)' }}>
                      <Coins size={11} />
                      ${Number(trace.total_cost || 0).toFixed(5)}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Layers size={11} />
                      {trace.total_spans} steps
                    </span>
                    {trace.last_span_at && (
                      <span style={{ color: 'var(--text-muted)' }}>
                        {formatDistanceToNow(parseDate(trace.last_span_at), { addSuffix: true })}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="pagination" style={{ marginTop: 12, padding: 0 }}>
            <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="pagination-btn">‹</button>
            <span className="pagination-info" style={{ fontSize: '0.75rem' }}>{page} / {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="pagination-btn">›</button>
          </div>
        )}
      </div>

      {/* Center Column: Trace Tree Viewer */}
      <div className="glass-card-static traces-tree-column">
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
          <GitFork size={14} /> Trace Tree Execution
        </span>

        {loadingTree ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="skeleton" style={{ height: 40, width: '90%' }} />
            <div className="skeleton" style={{ height: 40, width: '80%', marginLeft: 20 }} />
            <div className="skeleton" style={{ height: 40, width: '70%', marginLeft: 40 }} />
            <div className="skeleton" style={{ height: 40, width: '80%', marginLeft: 20 }} />
          </div>
        ) : treeError ? (
          <div className="empty-state">
            <AlertCircle size={40} className="empty-icon" style={{ color: 'var(--accent-rose)' }} />
            <h3>Failed to load trace</h3>
            <p>{treeError}</p>
          </div>
        ) : !selectedTraceId || !treeData?.rootSpans ? (
          <div className="empty-state">
            <GitFork size={48} className="empty-icon" />
            <h3>No trace selected</h3>
            <p>Select a trace session from the left column to view its execution tree hierarchy.</p>
          </div>
        ) : (
          <div style={{ flex: 1, overflowY: 'auto', paddingRight: 4 }}>
            {treeData.rootSpans.map((rootNode) => (
              <TreeNode
                key={rootNode.span_id}
                node={rootNode}
                selectedSpanId={selectedSpanId}
                onSelect={setSelectedSpanId}
                depth={0}
              />
            ))}
          </div>
        )}
      </div>

      {/* Right Column: Span Detail Inspector */}
      <div className="glass-card-static traces-inspector-column">
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Search size={14} /> Span Inspector
        </span>

        {!selectedSpan ? (
          <div className="empty-state" style={{ padding: '60px 10px', textAlign: 'center' }}>
            <Search size={36} className="empty-icon" style={{ marginBottom: 12 }} />
            <h4 style={{ fontSize: '0.9rem', marginBottom: 6 }}>Select a span node</h4>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Click on any node in the execution tree to inspect its parameters, inputs, outputs, and metrics.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Span Title & Badge */}
            <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                <span style={getSpanBadgeStyle(selectedSpan.span_type)}>
                  {selectedSpan.span_type?.toUpperCase() || 'SPAN'}
                </span>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  ID: {selectedSpan.span_id?.substring(0, 8)}...
                </span>
              </div>
              <h3 style={{ fontSize: '1.05rem', fontWeight: 700, wordBreak: 'break-all' }}>
                {selectedSpan.span_name}
              </h3>
            </div>

            {(selectedSpan.status === 'paused' || selectedSpan.status === 'awaiting_approval') && (
              <div style={{
                background: 'rgba(245, 158, 11, 0.06)',
                border: '1px solid rgba(245, 158, 11, 0.2)',
                borderRadius: 'var(--radius-md)',
                padding: '16px',
                fontSize: '0.8125rem',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <strong style={{ color: 'var(--accent-amber)', display: 'flex', alignItems: 'center', gap: 6, margin: 0 }}>
                    ⏳ Human-in-the-Loop Awaiting Review
                  </strong>
                  <span style={{ color: 'var(--text-secondary)' }}>
                    This agent tool call is currently paused and requires manual review. You can approve or reject it directly here.
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => handleUpdateSpanStatus(selectedSpan.span_id, 'rejected')}
                    style={{ borderColor: 'var(--accent-rose)', color: 'var(--accent-rose)', background: 'transparent', flex: 1 }}
                  >
                    Reject
                  </button>
                  <button
                    className="btn btn-sm"
                    onClick={() => handleUpdateSpanStatus(selectedSpan.span_id, 'success')}
                    style={{ background: 'var(--accent-amber)', color: 'black', fontWeight: 600, border: 'none', flex: 1 }}
                  >
                    Approve
                  </button>
                </div>
              </div>
            )}

            {/* Metrics Row */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <div className="glass-card" style={{ padding: '8px 12px', borderRadius: 'var(--radius-md)', flex: '1 1 45%', minWidth: 100, transform: 'none' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Latency</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)', marginTop: 2 }}>
                  {selectedSpan.latency_ms >= 1000 
                    ? `${(selectedSpan.latency_ms / 1000).toFixed(2)}s` 
                    : `${selectedSpan.latency_ms}ms`}
                </div>
              </div>
              <div className="glass-card" style={{ padding: '8px 12px', borderRadius: 'var(--radius-md)', flex: '1 1 45%', minWidth: 100, transform: 'none' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Estimated Cost</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--accent-emerald)', marginTop: 2 }}>
                  ${Number(selectedSpan.estimated_cost || 0).toFixed(6)}
                </div>
              </div>
              {selectedSpan.total_tokens > 0 && (
                <div className="glass-card" style={{ padding: '8px 12px', borderRadius: 'var(--radius-md)', flex: '1 1 45%', minWidth: 100, transform: 'none' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Tokens (In / Out)</div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', marginTop: 2 }}>
                    {selectedSpan.total_tokens} <span style={{ fontSize: '0.7rem', fontWeight: 400, color: 'var(--text-muted)' }}>({selectedSpan.prompt_tokens} / {selectedSpan.completion_tokens})</span>
                  </div>
                </div>
              )}
              {selectedSpan.model && (
                <div className="glass-card" style={{ padding: '8px 12px', borderRadius: 'var(--radius-md)', flex: '1 1 45%', minWidth: 100, transform: 'none' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Model</div>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {selectedSpan.model.split('/').pop()}
                  </div>
                </div>
              )}
            </div>

            {/* human feedback / evaluation scores */}
            {(selectedSpan.feedback || selectedSpan.evaluation) && (
              <div className="glass-card" style={{ padding: 14, borderRadius: 'var(--radius-md)', display: 'flex', flexDirection: 'column', gap: 10, border: '1px solid rgba(16, 185, 129, 0.2)', transform: 'none' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--accent-emerald)', display: 'flex', alignItems: 'center', gap: 6, borderBottom: '1px solid rgba(16, 185, 129, 0.1)', paddingBottom: 6 }}>
                  <Sparkles size={14} /> Evaluation & Feedback
                </span>
                
                {selectedSpan.feedback && (
                  <div style={{ fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      {selectedSpan.feedback.rating != null ? (
                        <span style={{ color: 'var(--accent-amber)', fontWeight: 600 }}>
                          {'⭐'.repeat(selectedSpan.feedback.rating)} ({selectedSpan.feedback.rating}/5)
                        </span>
                      ) : (
                        selectedSpan.feedback.score != null && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 6px', borderRadius: 4, background: 'rgba(255,255,255,0.05)' }}>
                            {selectedSpan.feedback.score === 1 ? <ThumbsUp size={12} style={{ color: 'var(--accent-emerald)' }} /> : <ThumbsDown size={12} style={{ color: 'var(--accent-rose)' }} />}
                            {selectedSpan.feedback.score === 1 ? 'Positive' : 'Negative'}
                          </span>
                        )
                      )}
                      {selectedSpan.feedback.task_success != null && (
                        <Badge variant={selectedSpan.feedback.task_success ? 'success' : 'danger'}>
                          {selectedSpan.feedback.task_success ? '🎯 Goal Met' : '❌ Goal Failed'}
                        </Badge>
                      )}
                    </div>
                    {selectedSpan.feedback.comment && (
                      <div style={{ color: 'var(--text-secondary)', fontStyle: 'italic', paddingLeft: 4, borderLeft: '2px solid var(--border)' }}>
                        "{selectedSpan.feedback.comment}"
                      </div>
                    )}
                  </div>
                )}

                {selectedSpan.evaluation && (() => {
                  const ev = selectedSpan.evaluation;
                  const hasAgent = ev.tool_success_rate != null || ev.iteration_count != null || ev.goal_completion_rate != null;
                  const hasRAG = ev.faithfulness != null || ev.answer_relevancy != null || ev.context_precision != null || ev.context_recall != null;
                  const hasRetrieval = ev.recall_at_k != null || ev.precision_at_k != null || ev.mrr != null;
                  const hasNLP = ev.f1_score != null || ev.exact_match != null || ev.bleu != null || ev.rouge_l != null;
                  const hasClassicScore = ev.score != null;

                  return (
                    <div style={{ fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {hasClassicScore && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, background: 'rgba(255, 255, 255, 0.02)', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>AI Grade ({ev.category || 'Quality'}):</span>
                            <span style={{ fontWeight: 600, color: ev.score >= 0.7 ? 'var(--accent-emerald)' : ev.score >= 0.4 ? 'var(--accent-amber)' : 'var(--accent-rose)' }}>
                              {ev.score.toFixed(1)} / 5.0
                            </span>
                          </div>
                        </div>
                      )}

                      {/* Agent Workflow Metrics */}
                      {hasAgent && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, background: 'rgba(0,0,0,0.15)', padding: 10, borderRadius: 6 }}>
                          <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--accent-purple)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Agent Workflow Metrics</span>
                          {ev.goal_completion_rate != null && (
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <span style={{ color: 'var(--text-muted)' }}>Goal Status:</span>
                              <span style={{ fontWeight: 600, color: ev.goal_completion_rate === 1 ? 'var(--accent-emerald)' : 'var(--accent-rose)' }}>
                                {ev.goal_completion_rate === 1 ? 'SUCCESS' : 'FAILED'}
                              </span>
                            </div>
                          )}
                          {ev.tool_success_rate != null && (
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <span style={{ color: 'var(--text-muted)' }}>Tool Success Rate:</span>
                              <span style={{ fontWeight: 600 }}>{(ev.tool_success_rate * 100).toFixed(0)}%</span>
                            </div>
                          )}
                          {ev.iteration_count != null && (
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <span style={{ color: 'var(--text-muted)' }}>Iterations/Steps:</span>
                              <span style={{ fontWeight: 600 }}>{ev.iteration_count} steps</span>
                            </div>
                          )}
                          {ev.planning_accuracy != null && (
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <span style={{ color: 'var(--text-muted)' }}>Planning Accuracy:</span>
                              <span style={{ fontWeight: 600 }}>{(ev.planning_accuracy * 100).toFixed(0)}%</span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* RAG & Retrieval Metrics */}
                      {(hasRAG || hasRetrieval) && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, background: 'rgba(0,0,0,0.15)', padding: 10, borderRadius: 6 }}>
                          <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--accent-blue)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>RAG & Retrieval</span>
                          {ev.faithfulness != null && (
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <span style={{ color: 'var(--text-muted)' }}>Faithfulness:</span>
                              <span style={{ fontWeight: 600 }}>{Number(ev.faithfulness).toFixed(1)} / 5.0</span>
                            </div>
                          )}
                          {ev.answer_relevancy != null && (
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <span style={{ color: 'var(--text-muted)' }}>Answer Relevancy:</span>
                              <span style={{ fontWeight: 600 }}>{Number(ev.answer_relevancy).toFixed(1)} / 5.0</span>
                            </div>
                          )}
                          {ev.context_precision != null && (
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <span style={{ color: 'var(--text-muted)' }}>Context Precision:</span>
                              <span style={{ fontWeight: 600 }}>{Number(ev.context_precision).toFixed(1)} / 5.0</span>
                            </div>
                          )}
                          {ev.recall_at_k != null && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 4, marginTop: 2 }}>
                              <span style={{ color: 'var(--text-muted)' }}>Recall@K:</span>
                              <span style={{ fontWeight: 600 }}>{Number(ev.recall_at_k).toFixed(2)}</span>
                            </div>
                          )}
                          {ev.precision_at_k != null && (
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <span style={{ color: 'var(--text-muted)' }}>Precision@K:</span>
                              <span style={{ fontWeight: 600 }}>{Number(ev.precision_at_k).toFixed(2)}</span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* NLP Metrics */}
                      {hasNLP && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, background: 'rgba(0,0,0,0.15)', padding: 10, borderRadius: 6 }}>
                          <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--accent-cyan)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Accuracy & NLP</span>
                          {ev.exact_match != null && (
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <span style={{ color: 'var(--text-muted)' }}>Exact Match:</span>
                              <span style={{ fontWeight: 600 }}>{ev.exact_match === 1 ? 'Yes' : 'No'}</span>
                            </div>
                          )}
                          {ev.f1_score != null && (
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <span style={{ color: 'var(--text-muted)' }}>F1 Score:</span>
                              <span style={{ fontWeight: 600 }}>{(ev.f1_score * 100).toFixed(0)}%</span>
                            </div>
                          )}
                          {ev.bleu != null && (
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <span style={{ color: 'var(--text-muted)' }}>BLEU Score:</span>
                              <span style={{ fontWeight: 600 }}>{(ev.bleu * 100).toFixed(0)}%</span>
                            </div>
                          )}
                        </div>
                      )}

                      {ev.reasoning && (
                        <div style={{ color: 'var(--text-secondary)', background: 'rgba(0,0,0,0.2)', padding: 8, borderRadius: 6, fontSize: '0.75rem', fontStyle: 'italic', lineHeight: 1.4 }}>
                          "{ev.reasoning}"
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Input details */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Inputs / Parameters</span>
              {selectedSpan.span_type === 'tool' ? (() => {
                let inputStr = '';
                let parsed = false;
                try {
                  const inputs = typeof selectedSpan.input_messages === 'string' ? JSON.parse(selectedSpan.input_messages) : selectedSpan.input_messages;
                  if (Array.isArray(inputs) && inputs.length > 0) {
                    const userMsg = inputs.find(m => m.role === 'user');
                    if (userMsg && userMsg.content) {
                      const content = userMsg.content;
                      if (content.startsWith('Input: ') && content.includes('\nOutput: ')) {
                        const parts = content.split('\nOutput: ');
                        inputStr = parts[0].substring(7).trim(); // Remove 'Input: '
                        parsed = true;
                      }
                    }
                  }
                } catch {}
                if (!parsed) {
                  inputStr = typeof selectedSpan.input_messages === 'string' ? selectedSpan.input_messages : JSON.stringify(selectedSpan.input_messages);
                }
                return (
                  <div className="glass-card" style={{ padding: '10px 12px', borderRadius: 'var(--radius-md)', fontSize: '0.75rem', transform: 'none', background: 'rgba(59, 130, 246, 0.05)' }}>
                    <div style={{ whiteSpace: 'pre-wrap', color: 'var(--text-primary)' }}>
                      {inputStr}
                    </div>
                  </div>
                );
              })() : Array.isArray(selectedSpan.input_messages) ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 300, overflowY: 'auto' }}>
                  {selectedSpan.input_messages.map((msg, i) => (
                    <div key={i} className="glass-card" style={{ padding: '10px 12px', borderRadius: 'var(--radius-md)', fontSize: '0.75rem', transform: 'none', background: msg.role === 'user' ? 'rgba(59, 130, 246, 0.05)' : 'rgba(255,255,255,0.02)' }}>
                      <span style={{ fontWeight: 600, color: msg.role === 'user' ? 'var(--accent-blue)' : 'var(--text-secondary)', textTransform: 'capitalize' }}>
                        {msg.role}:
                      </span>
                      <div style={{ marginTop: 4, whiteSpace: 'pre-wrap', color: 'var(--text-primary)' }}>
                        {msg.content}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <JsonViewer data={selectedSpan.input_messages} />
              )}
            </div>

            {/* Output details */}
            {selectedSpan.span_type === 'tool' ? (() => {
              let outputStr = '';
              let parsed = false;
              try {
                const inputs = typeof selectedSpan.input_messages === 'string' ? JSON.parse(selectedSpan.input_messages) : selectedSpan.input_messages;
                if (Array.isArray(inputs) && inputs.length > 0) {
                  const userMsg = inputs.find(m => m.role === 'user');
                  if (userMsg && userMsg.content) {
                    const content = userMsg.content;
                    if (content.startsWith('Input: ') && content.includes('\nOutput: ')) {
                      const parts = content.split('\nOutput: ');
                      outputStr = parts.slice(1).join('\nOutput: ').trim();
                      parsed = true;
                    }
                  }
                }
              } catch {}
              if (!parsed) {
                outputStr = typeof selectedSpan.output_message === 'string' ? selectedSpan.output_message : JSON.stringify(selectedSpan.output_message);
              }
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Output / Response</span>
                  <div className="glass-card" style={{ padding: '10px 12px', borderRadius: 'var(--radius-md)', fontSize: '0.75rem', transform: 'none', background: 'rgba(16, 185, 129, 0.05)' }}>
                    <div style={{ whiteSpace: 'pre-wrap', color: 'var(--text-primary)' }}>
                      {outputStr}
                    </div>
                  </div>
                </div>
              );
            })() : selectedSpan.output_message && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Output / Response</span>
                {selectedSpan.output_message.content ? (
                  <div className="glass-card" style={{ padding: '10px 12px', borderRadius: 'var(--radius-md)', fontSize: '0.75rem', transform: 'none', background: 'rgba(16, 185, 129, 0.05)' }}>
                    <div style={{ whiteSpace: 'pre-wrap', color: 'var(--text-primary)' }}>
                      {selectedSpan.output_message.content}
                    </div>
                  </div>
                ) : (
                  <JsonViewer data={selectedSpan.output_message} />
                )}
              </div>
            )}

            {/* Raw JSON payload Toggle */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>Raw Trace Entry Payload</span>
              <JsonViewer data={selectedSpan} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Tree node helper component to draw nested child spans recursively
 */
export function TreeNode({ node, selectedSpanId, onSelect, depth }) {
  const [collapsed, setCollapsed] = useState(false);
  const isSelected = selectedSpanId === node.span_id;
  const hasChildren = node.children && node.children.length > 0;

  // Icon depending on span type
  const getIcon = (type) => {
    switch (type) {
      case 'agent': return <Cpu size={14} style={{ color: 'var(--accent-purple)' }} />;
      case 'tool': return <Terminal size={14} style={{ color: 'var(--accent-amber)' }} />;
      case 'llm': return <Activity size={14} style={{ color: 'var(--accent-blue)' }} />;
      case 'chain': return <GitFork size={14} style={{ color: 'var(--accent-cyan)' }} />;
      default: return <Database size={14} style={{ color: 'var(--text-secondary)' }} />;
    }
  };

  return (
    <div style={{ marginLeft: depth > 0 ? 16 : 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
      {/* Curved L-connector line for nested child tree spans */}
      {depth > 0 && (
        <div style={{
          position: 'absolute',
          left: -12,
          top: -12,
          width: 12,
          height: 30,
          borderLeft: '1.5px solid rgba(255, 255, 255, 0.08)',
          borderBottom: '1.5px solid rgba(255, 255, 255, 0.08)',
          borderBottomLeftRadius: 6,
          pointerEvents: 'none'
        }} />
      )}

      {/* Node details */}
      <div 
        onClick={() => onSelect(node.span_id)}
        className="glass-card"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          margin: '4px 0',
          cursor: 'pointer',
          borderRadius: 'var(--radius-sm)',
          background: isSelected ? 'var(--bg-card-hover)' : 'var(--bg-card)',
          borderColor: isSelected ? 'rgba(99, 102, 241, 0.4)' : node.status === 'error' ? 'rgba(244, 63, 94, 0.4)' : node.status === 'paused' || node.status === 'awaiting_approval' ? 'rgba(245, 158, 11, 0.5)' : 'var(--border)',
          transform: 'none',
          boxShadow: isSelected ? 'var(--shadow-glow-purple)' : 'none',
          zIndex: 1
        }}
      >
        {hasChildren ? (
          <button 
            onClick={(e) => { e.stopPropagation(); setCollapsed(!collapsed); }}
            style={{ display: 'flex', alignItems: 'center', padding: 2, marginRight: -2 }}
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </button>
        ) : (
          <div style={{ width: 16 }} />
        )}
        
        {getIcon(node.span_type)}

        <span style={{ fontWeight: 600, fontSize: '0.8rem', color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)', flex: 1, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
          {node.span_name}
        </span>

        {/* Latency tag */}
        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 3 }}>
          <Clock size={10} />
          {node.latency_ms >= 1000 ? `${(node.latency_ms / 1000).toFixed(1)}s` : `${node.latency_ms}ms`}
        </span>

        {/* Cost tag */}
        {node.estimated_cost > 0 && (
          <span style={{ fontSize: '0.7rem', color: 'var(--accent-emerald)' }}>
            ${Number(node.estimated_cost).toFixed(5)}
          </span>
        )}

        {(node.status === 'paused' || node.status === 'awaiting_approval') && (
          <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--accent-amber)', background: 'rgba(245, 158, 11, 0.1)', padding: '2px 6px', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 3 }}>
            ⏳ Awaiting Review
          </span>
        )}
      </div>

      {/* Child Nodes */}
      {hasChildren && !collapsed && (
        <div style={{ 
          display: 'flex', 
          flexDirection: 'column',
          borderLeft: '1.5px solid rgba(255, 255, 255, 0.08)',
          marginLeft: 23,
          paddingLeft: 4
        }}>
          {node.children.map((child) => (
            <TreeNode
              key={child.span_id}
              node={child}
              selectedSpanId={selectedSpanId}
              onSelect={onSelect}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Badge styling depending on span type
export function getSpanBadgeStyle(type) {
  const base = {
    padding: '3px 8px',
    borderRadius: 4,
    fontSize: '0.65rem',
    fontWeight: 700,
    textTransform: 'uppercase'
  };

  switch (type) {
    case 'agent':
      return { ...base, color: 'var(--accent-purple)', background: 'rgba(139, 92, 246, 0.15)', border: '1px solid rgba(139, 92, 246, 0.3)' };
    case 'tool':
      return { ...base, color: 'var(--accent-amber)', background: 'rgba(245, 158, 11, 0.15)', border: '1px solid rgba(245, 158, 11, 0.3)' };
    case 'llm':
      return { ...base, color: 'var(--accent-blue)', background: 'rgba(59, 130, 246, 0.15)', border: '1px solid rgba(59, 130, 246, 0.3)' };
    case 'chain':
      return { ...base, color: 'var(--accent-cyan)', background: 'rgba(6, 182, 212, 0.15)', border: '1px solid rgba(6, 182, 212, 0.3)' };
    default:
      return { ...base, color: 'var(--text-secondary)', background: 'rgba(255, 255, 255, 0.05)', border: '1px solid var(--border)' };
  }
}
