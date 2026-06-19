import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Clock,
  Hash,
  DollarSign,
  Layers,
  Trash2,
  Code,
  MessageSquare,
  ThumbsUp,
  ThumbsDown,
  Sparkles,
  Star,
  Check,
  BookOpen,
  Target,
  Cpu,
  Info,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import { format } from 'date-fns';
import { useApi, fetchApi } from '../hooks/useApi';
import Badge from '../components/ui/Badge';
import ChatBubble from '../components/ui/ChatBubble';
import JsonViewer from '../components/ui/JsonViewer';
import Tooltip from '../components/ui/Tooltip';

function formatModelName(name) {
  if (!name) return 'Unknown';
  const parts = name.split('/');
  return parts[parts.length - 1];
}

export default function LogDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState('chat');
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const { data: log, loading, error, refetch } = useApi(`/logs/${id}`);
  const { data: traceTree, refetch: refetchTraceTree } = useApi(log?.trace_id ? `/traces/${log.trace_id}` : null);
  const [updatingSpanId, setUpdatingSpanId] = useState(null);
  const [isManualSyncing, setIsManualSyncing] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await fetchApi(`/logs/${id}`, { method: 'DELETE' });
      navigate('/logs');
    } catch (err) {
      alert('Failed to delete: ' + err.message);
      setDeleting(false);
    }
  };

  const handleUpdateStatus = async (newStatus, spanId = null) => {
    const targetId = spanId || id;
    setUpdatingSpanId(targetId);
    try {
      await fetchApi(`/logs/${targetId}/status`, {
        method: 'PATCH',
        body: { status: newStatus },
      });
      refetch();
      if (refetchTraceTree) refetchTraceTree();
      // Delay a second refetch to allow background script steps to be written to DB
      setTimeout(async () => {
        await refetch();
        if (refetchTraceTree) await refetchTraceTree();
        setUpdatingSpanId(null);
      }, 1500);
    } catch (err) {
      alert('Failed to update status: ' + err.message);
      setUpdatingSpanId(null);
    }
  };

  const traceMessages = useMemo(() => {
    if (!traceTree?.rootSpans) return null;

    const list = [];
    const traverse = (node) => {
      list.push(node);
      if (node.children) {
        node.children.forEach(traverse);
      }
    };
    traceTree.rootSpans.forEach(traverse);

    // Sort by created_at to guarantee chronological chat sequence
    list.sort((a, b) => new Date(a.created_at.replace(' ', 'T')) - new Date(b.created_at.replace(' ', 'T')));

    const msgs = [];
    list.forEach(span => {
      if (span.span_type === 'llm' || span.span_type === 'agent' || !span.span_type) {
        let inputs = [];
        try {
          inputs = typeof span.input_messages === 'string' ? JSON.parse(span.input_messages) : span.input_messages;
        } catch {}
        if (!Array.isArray(inputs)) inputs = [];

        const userInputs = inputs.filter(m => m.role === 'user');
        userInputs.forEach(msg => {
          msgs.push({
            id: `${span.span_id}-user-${msg.content.substring(0, 10)}`,
            role: 'user',
            content: msg.content,
            spanName: span.span_name
          });
        });

        let output = null;
        try {
          output = typeof span.output_message === 'string' ? JSON.parse(span.output_message) : span.output_message;
        } catch {}
        if (output && output.content) {
          msgs.push({
            id: `${span.span_id}-assistant`,
            role: 'assistant',
            content: output.content,
            tokens: span.completion_tokens,
            cost: span.estimated_cost !== undefined ? span.estimated_cost : span.cost,
            spanName: span.span_name
          });
        }
      }
      else if (span.span_type === 'check') {
        let inputs = [];
        try {
          inputs = typeof span.input_messages === 'string' ? JSON.parse(span.input_messages) : span.input_messages;
        } catch {}
        if (!Array.isArray(inputs)) inputs = [];

        const userInputs = inputs.filter(m => m.role === 'user');
        userInputs.forEach(msg => {
          msgs.push({
            id: `${span.span_id}-check-user`,
            role: 'user',
            content: `[Verification Check: ${span.span_name}] ${msg.content}`
          });
        });

        if (span.status === 'success') {
          msgs.push({
            id: `${span.span_id}-check-status`,
            role: 'assistant',
            content: `✅ Check approved.`
          });
        } else if (span.status === 'rejected') {
          msgs.push({
            id: `${span.span_id}-check-status`,
            role: 'assistant',
            content: `❌ Check rejected.`
          });
        } else if (span.status === 'awaiting_approval' || span.status === 'paused') {
          msgs.push({
            id: `${span.span_id}-check-status`,
            role: 'assistant',
            content: `⏳ Awaiting review/approval.`,
            isPendingCheck: true,
            spanId: span.span_id
          });
        }
      }
      else if (span.span_type === 'tool') {
        let inputStr = '';
        let outputStr = '';
        let parsed = false;

        try {
          const inputs = typeof span.input_messages === 'string' ? JSON.parse(span.input_messages) : span.input_messages;
          if (Array.isArray(inputs) && inputs.length > 0) {
            const userMsg = inputs.find(m => m.role === 'user');
            if (userMsg && userMsg.content) {
              const content = userMsg.content;
              if (content.startsWith('Input: ') && content.includes('\nOutput: ')) {
                const parts = content.split('\nOutput: ');
                inputStr = parts[0].substring(7).trim(); // Remove 'Input: '
                outputStr = parts.slice(1).join('\nOutput: ').trim();
                parsed = true;
              }
            }
          }
        } catch (e) {}

        if (!parsed) {
          try {
            inputStr = typeof span.input_messages === 'string' ? span.input_messages : JSON.stringify(span.input_messages);
          } catch {}
          try {
            outputStr = typeof span.output_message === 'string' ? span.output_message : JSON.stringify(span.output_message);
          } catch {}
          inputStr = span.raw_request || inputStr || '';
          outputStr = span.raw_response || outputStr || '';
        }

        msgs.push({
          id: span.span_id,
          role: 'tool',
          name: span.span_name,
          input: inputStr,
          output: outputStr,
          error: span.error_message
        });
      }
    });

    return msgs;
  }, [traceTree]);

  if (loading) {
    return (
      <div className="animate-slide-up">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 32 }}>
          <button className="btn btn-ghost" onClick={() => navigate('/logs')}>
            <ArrowLeft size={18} />
          </button>
          <div className="skeleton skeleton-heading" style={{ width: 200 }} />
        </div>
        <div className="detail-meta-grid">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="glass-card detail-meta-card">
              <div className="skeleton skeleton-card" />
            </div>
          ))}
        </div>
        <div className="glass-card-static" style={{ padding: 24 }}>
          <div className="skeleton skeleton-chart" />
        </div>
      </div>
    );
  }

  if (error || !log) {
    return (
      <div className="animate-slide-up">
        <button className="btn btn-ghost" onClick={() => navigate('/logs')}>
          <ArrowLeft size={18} /> Back to Logs
        </button>
        <div className="glass-card-static" style={{ padding: 48, textAlign: 'center', marginTop: 24 }}>
          <p style={{ color: 'var(--accent-rose)' }}>{error || 'Log not found'}</p>
        </div>
      </div>
    );
  }

  const statusVariant = log.status === 'success' ? 'success' : 'error';

  // Parse messages
  let inputMessages = [];
  try {
    if (log.input_messages) {
      inputMessages = typeof log.input_messages === 'string'
        ? JSON.parse(log.input_messages)
        : log.input_messages;
    } else if (log.request_body) {
      const body = typeof log.request_body === 'string'
        ? JSON.parse(log.request_body)
        : log.request_body;
      inputMessages = body?.messages || [];
    }
  } catch {
    inputMessages = [];
  }

  // Normalize inputMessages to array
  if (!Array.isArray(inputMessages)) {
    if (inputMessages && typeof inputMessages === 'object') {
      inputMessages = [{ role: 'user', content: JSON.stringify(inputMessages, null, 2) }];
    } else if (inputMessages) {
      inputMessages = [{ role: 'user', content: String(inputMessages) }];
    } else {
      inputMessages = [];
    }
  }

  let outputMessage = null;
  try {
    if (log.output_message) {
      outputMessage = typeof log.output_message === 'string'
        ? JSON.parse(log.output_message)
        : log.output_message;
    } else if (log.response_body) {
      const body = typeof log.response_body === 'string'
        ? JSON.parse(log.response_body)
        : log.response_body;
      outputMessage = body?.choices?.[0]?.message || null;
    }
  } catch {
    outputMessage = null;
  }

  // Normalize outputMessage
  if (outputMessage) {
    if (typeof outputMessage !== 'object') {
      outputMessage = { role: 'assistant', content: String(outputMessage) };
    } else if (outputMessage.content === undefined) {
      outputMessage = {
        role: outputMessage.role || 'assistant',
        content: JSON.stringify(outputMessage, null, 2)
      };
    }
  }

  let requestBody = null;
  try {
    requestBody = log.request_body
      ? typeof log.request_body === 'string'
        ? JSON.parse(log.request_body)
        : log.request_body
      : null;
  } catch {
    requestBody = log.request_body;
  }

  let responseBody = null;
  try {
    responseBody = log.response_body
      ? typeof log.response_body === 'string'
        ? JSON.parse(log.response_body)
        : log.response_body
      : null;
  } catch {
    responseBody = log.response_body;
  }

  const handleOpenInPlayground = () => {
    let systemPromptText = 'You are a helpful and clear AI assistant.';
    let chatMsgs = [];
    
    const sysMsg = inputMessages.find(m => m.role === 'system');
    if (sysMsg) {
      systemPromptText = sysMsg.content;
      chatMsgs = inputMessages.filter(m => m.role !== 'system');
    } else {
      chatMsgs = [...inputMessages];
    }
    
    if (outputMessage) {
      chatMsgs.push({
        role: outputMessage.role || 'assistant',
        content: outputMessage.content
      });
    }

    const payload = {
      mode: 'chat',
      model: log.model,
      temperature: log.temperature !== undefined ? log.temperature : 0.7,
      systemPrompt: systemPromptText,
      messages: chatMsgs
    };

    localStorage.setItem('infrasight_playground_import', JSON.stringify(payload));
    navigate('/playground');
  };

  const tags = log.tags
    ? typeof log.tags === 'string'
      ? JSON.parse(log.tags)
      : log.tags
    : [];

  return (
    <div className="animate-slide-up">
      {/* Header */}
      <div className="detail-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button className="btn btn-ghost" onClick={() => navigate('/logs')}>
            <ArrowLeft size={18} />
          </button>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 700 }}>
                {formatModelName(log.model)}
              </h2>
              <Badge variant={statusVariant}>{log.status ? log.status.toUpperCase() : 'UNKNOWN'}</Badge>
            </div>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: 4 }}>
              {(() => {
                if (!log.created_at) return '—';
                try {
                  const d = new Date(log.created_at.replace(' ', 'T'));
                  if (isNaN(d.getTime())) return log.created_at;
                  return format(d, 'PPpp');
                } catch {
                  return log.created_at;
                }
              })()}
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={async () => {
              setIsManualSyncing(true);
              await refetch();
              if (refetchTraceTree) await refetchTraceTree();
              setTimeout(() => setIsManualSyncing(false), 800);
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 6, borderColor: 'var(--accent-blue)' }}
          >
            <RefreshCw
              size={14}
              className={`sync-icon ${isManualSyncing ? 'sync-icon--spinning' : ''}`}
              style={{
                color: 'var(--accent-blue)',
              }}
            />
            {isManualSyncing ? 'Syncing...' : 'Sync'}
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={handleOpenInPlayground}
            style={{ display: 'flex', alignItems: 'center', gap: 6, borderColor: 'var(--accent-purple)' }}
          >
            <Sparkles size={14} style={{ color: 'var(--accent-purple)' }} />
            Open in Playground
          </button>
          <button
            className="btn btn-danger btn-sm"
            onClick={() => setShowDelete(true)}
          >
            <Trash2 size={14} />
            Delete
          </button>
        </div>
      </div>

      {/* Tags */}
      {Array.isArray(tags) && tags.length > 0 && (
        <div className="tags-list" style={{ marginBottom: 20 }}>
          {tags.map((tag, i) => (
            <span key={i} className="tag">
              {typeof tag === 'string' ? tag : `${tag.key}: ${tag.value}`}
            </span>
          ))}
        </div>
      )}

      {/* Metadata Cards */}
      <div className="detail-meta-grid">
        <div className="glass-card detail-meta-card">
          <div className="meta-label" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <Clock size={12} style={{ marginRight: 4 }} />
              Latency
            </div>
            <Tooltip position="bottom" content="Total time taken to complete the request." />
          </div>
          <div className="meta-value" style={{ color: 'var(--accent-cyan)' }}>
            {log.latency_ms ? (Number(log.latency_ms) >= 1000 ? `${(Number(log.latency_ms) / 1000).toFixed(2)}s` : `${Number(log.latency_ms).toFixed(0)}ms`) : '—'}
          </div>
        </div>
        <div className="glass-card detail-meta-card">
          <div className="meta-label" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <Hash size={12} style={{ marginRight: 4 }} />
              Total Tokens
            </div>
            <Tooltip position="bottom" content="Total tokens used (Prompt + Completion)." />
          </div>
          <div className="meta-value" style={{ color: 'var(--accent-blue)' }}>
            {(log.total_tokens || 0).toLocaleString()}
          </div>
        </div>
        <div className="glass-card detail-meta-card">
          <div className="meta-label" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <Layers size={12} style={{ marginRight: 4 }} />
              Token Split
            </div>
            <Tooltip position="bottom" content={`Prompt (${log.prompt_tokens || 0}) / Completion (${log.completion_tokens || 0}) tokens.`} />
          </div>
          <div className="meta-value" style={{ fontSize: '1.1rem' }}>
            <span style={{ color: 'var(--accent-blue)' }}>{log.prompt_tokens || 0}</span>
            <span style={{ color: 'var(--text-dim)', margin: '0 6px' }}>/</span>
            <span style={{ color: 'var(--accent-cyan)' }}>{log.completion_tokens || 0}</span>
          </div>
        </div>
        <div className="glass-card detail-meta-card">
          <div className="meta-label" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <DollarSign size={12} style={{ marginRight: 4 }} />
              Cost
            </div>
            <Tooltip position="bottom" content="Estimated USD cost based on model pricing." />
          </div>
          <div className="meta-value" style={{ color: 'var(--accent-emerald)' }}>
            ${Number(log.estimated_cost !== undefined ? log.estimated_cost : (log.cost || 0)).toFixed(6)}
          </div>
        </div>
      </div>


      {/* Error Message Alert */}
      {log.status === 'error' && log.error_message && (
        <div 
          className="glass-card animate-slide-up" 
          style={{ 
            marginTop: 20, 
            marginBottom: 24, 
            padding: '18px 24px', 
            background: 'rgba(244, 63, 94, 0.04)', 
            border: '1px solid rgba(244, 63, 94, 0.15)', 
            boxShadow: 'var(--shadow-glow-rose)',
            borderRadius: 'var(--radius-md)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 16
          }}
        >
          <div style={{ color: 'var(--accent-rose)', display: 'flex', marginTop: 2 }}>
            <AlertTriangle size={20} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--accent-rose)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
              API Request Error Details
            </div>
            <div style={{ fontSize: '0.875rem', color: 'var(--text-primary)', fontFamily: 'var(--font-mono, monospace)', wordBreak: 'break-word', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
              {log.error_message}
            </div>
          </div>
        </div>
      )}

      {/* Evaluations & Feedback panels */}
      <div className="eval-dashboard-grid">
        <FeedbackPanel logId={log.id} initialFeedback={log.feedback} onSave={refetch} />
        <EvaluationPanel evaluation={log.evaluation} />
      </div>

      {/* View Mode Toggle */}
      <div className="tabs" style={{ display: 'inline-flex', marginBottom: 20 }}>
        <button
          className={`tab-btn ${viewMode === 'chat' ? 'active' : ''}`}
          onClick={() => setViewMode('chat')}
        >
          <MessageSquare size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
          Chat View
        </button>
        <button
          className={`tab-btn ${viewMode === 'raw' ? 'active' : ''}`}
          onClick={() => setViewMode('raw')}
        >
          <Code size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
          Raw JSON
        </button>
      </div>
      {/* Content */}
      {viewMode === 'chat' ? (
        <div className="glass-card-static">
          <div className="chat-container" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
             {traceMessages && traceMessages.length > 0 ? (
              traceMessages.map((msg, index) => {
                const staggerDelay = `${Math.min(index * 40, 400)}ms`;
                if (msg.role === 'tool') {
                  const formatToolPayload = (p) => {
                    if (!p) return '—';
                    if (typeof p === 'object') return JSON.stringify(p, null, 2);
                    return p;
                  };
                  return (
                    <div 
                      key={msg.id} 
                      className="tool-call-card"
                      style={{
                        background: 'rgba(255,255,255,0.02)',
                        borderLeft: '3px solid var(--accent-emerald)',
                        padding: '12px 16px',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: '0.8125rem',
                        fontFamily: 'var(--font-mono, monospace)',
                        color: 'var(--text-secondary)',
                        '--stagger-delay': staggerDelay
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, color: 'var(--accent-emerald)', marginBottom: 6 }}>
                        ⚙️ Tool Call: {msg.name}
                      </div>
                      <div style={{ color: 'var(--text-dim)', marginBottom: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                        <strong>Input:</strong> {formatToolPayload(msg.input)}
                      </div>
                      {msg.error ? (
                        <div style={{ color: 'var(--accent-rose)' }}>
                          <strong>Error:</strong> {msg.error}
                        </div>
                      ) : (
                        <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                          <strong>Output:</strong> {formatToolPayload(msg.output)}
                        </div>
                      )}
                    </div>
                  );
                }
                return (
                  <ChatBubble
                    key={msg.id}
                    role={msg.role}
                    content={msg.content}
                    tokens={msg.tokens}
                    cost={msg.cost}
                    style={{ '--stagger-delay': staggerDelay }}
                  >
                    {msg.isPendingCheck && (
                      <div style={{ marginTop: 12 }}>
                        {updatingSpanId === msg.spanId ? (
                          <div 
                            className="hitl-spinner-enter"
                            style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--accent-amber)', fontSize: '0.75rem', fontWeight: 500 }}
                          >
                            <span className="spinner"></span>
                            Processing decision...
                          </div>
                        ) : (
                          <div style={{ display: 'flex', gap: 10 }}>
                            <button
                              className="btn btn-secondary btn-xs hitl-btn"
                              onClick={() => handleUpdateStatus('rejected', msg.spanId)}
                              style={{ borderColor: 'var(--accent-rose)', color: 'var(--accent-rose)', background: 'transparent', padding: '4px 8px', fontSize: '0.75rem' }}
                            >
                              Reject
                            </button>
                            <button
                              className="btn btn-xs hitl-btn"
                              onClick={() => handleUpdateStatus('success', msg.spanId)}
                              style={{ background: 'var(--accent-amber)', color: 'black', fontWeight: 600, border: 'none', padding: '4px 8px', fontSize: '0.75rem' }}
                            >
                              Approve
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </ChatBubble>
                );
              })
            ) : inputMessages.length === 0 && !outputMessage ? (
              <div className="empty-state" style={{ padding: 32 }}>
                <p>No messages to display</p>
              </div>
            ) : (
              <>
                {inputMessages.map((msg, i) => (
                  <ChatBubble
                    key={i}
                    role={msg.role || 'user'}
                    content={msg.content}
                    style={{ '--stagger-delay': `${Math.min(i * 40, 400)}ms` }}
                  />
                ))}
                {outputMessage && (
                  <ChatBubble
                    role={outputMessage.role || 'assistant'}
                    content={outputMessage.content}
                    tokens={log.completion_tokens}
                    cost={log.estimated_cost !== undefined ? log.estimated_cost : log.cost}
                    style={{ '--stagger-delay': `${Math.min(inputMessages.length * 40, 400)}ms` }}
                  />
                )}
              </>
            )}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {requestBody && (
            <div>
              <h4 style={{ marginBottom: 10, fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                Request Body
              </h4>
              <JsonViewer data={requestBody} />
            </div>
          )}
          {responseBody && (
            <div>
              <h4 style={{ marginBottom: 10, fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                Response Body
              </h4>
              <JsonViewer data={responseBody} />
            </div>
          )}
          {!requestBody && !responseBody && (
            <div className="glass-card-static" style={{ padding: 32, textAlign: 'center' }}>
              <p style={{ color: 'var(--text-dim)' }}>No raw data available</p>
            </div>
          )}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDelete && (
        <div className="modal-overlay" onClick={() => setShowDelete(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Delete Log Entry</h3>
            <p>
              Are you sure you want to delete this log entry? This action cannot be undone.
            </p>
            <div className="modal-actions">
              <button
                className="btn btn-secondary"
                onClick={() => setShowDelete(false)}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                className="btn btn-danger"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FeedbackPanel({ logId, initialFeedback, onSave }) {
  const parsed = initialFeedback ? (typeof initialFeedback === 'string' ? JSON.parse(initialFeedback) : initialFeedback) : null;
  const [rating, setRating] = useState(parsed?.rating || null);
  const [comment, setComment] = useState(parsed?.comment || '');
  const [taskSuccess, setTaskSuccess] = useState(parsed?.task_success === true);
  const [expectedAnswer, setExpectedAnswer] = useState(parsed?.expected_answer || '');
  const [saving, setSaving] = useState(false);
  const [hoverRating, setHoverRating] = useState(null);
  const [statusMsg, setStatusMsg] = useState(null);

  // Sync local state when initialFeedback changes (e.g. after refetch)
  useEffect(() => {
    const p = initialFeedback ? (typeof initialFeedback === 'string' ? JSON.parse(initialFeedback) : initialFeedback) : null;
    setRating(p?.rating || null);
    setComment(p?.comment || '');
    setTaskSuccess(p?.task_success === true);
    setExpectedAnswer(p?.expected_answer || '');
  }, [initialFeedback]);

  const saveFeedback = async () => {
    setSaving(true);
    setStatusMsg(null);
    try {
      await fetchApi(`/logs/${logId}/feedback`, {
        method: 'PATCH',
        body: { rating, comment, task_success: taskSuccess, expected_answer: expectedAnswer },
      });
      if (onSave) onSave();
      setStatusMsg({ type: 'success', text: 'Feedback saved! Evaluation will recalculate in background.' });
      setTimeout(() => setStatusMsg(null), 4000);
    } catch (err) {
      setStatusMsg({ type: 'error', text: 'Failed to save: ' + err.message });
    }
    setSaving(false);
  };

  return (
    <div className="glass-card feedback-card animate-slide-up" style={{ padding: 24, gap: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Star size={18} style={{ color: 'var(--accent-amber)' }} />
          User Feedback & Ground Truth
        </h4>
        
        {/* 5 Star Rating */}
        <div>
          <div className="meta-label" style={{ marginBottom: 8, fontSize: '0.8125rem' }}>User Score Rating</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                className="feedback-star-btn"
                onMouseEnter={() => setHoverRating(star)}
                onMouseLeave={() => setHoverRating(null)}
                onClick={() => setRating(star)}
                style={{ cursor: 'pointer' }}
              >
                <Star
                  size={26}
                  color={(hoverRating || rating) >= star ? '#f59e0b' : 'var(--text-dim)'}
                  fill={(hoverRating || rating) >= star ? '#f59e0b' : 'none'}
                />
              </button>
            ))}
          </div>
        </div>

        {/* Task Success Checkbox */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: '0.85rem', color: 'var(--text-primary)', background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border)', padding: '10px 14px', borderRadius: 'var(--radius-md)' }}>
          <input
            type="checkbox"
            checked={taskSuccess}
            onChange={(e) => setTaskSuccess(e.target.checked)}
            style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--accent-indigo)' }}
          />
          <span style={{ fontWeight: 500 }}>Goal Achieved / Task Succeeded</span>
        </label>

        {/* Expected Answer Input */}
        <div>
          <label className="meta-label" style={{ display: 'block', marginBottom: 8, fontSize: '0.8125rem' }}>
            Expected Answer (Ground Truth Reference)
          </label>
          <textarea
            className="input"
            placeholder="Enter reference answer. Saving will trigger Exact Match, F1, ROUGE, and BLEU evaluation metrics automatically."
            value={expectedAnswer}
            onChange={(e) => setExpectedAnswer(e.target.value)}
            disabled={saving}
            style={{ width: '100%', minHeight: 80, resize: 'vertical', fontFamily: 'inherit', fontSize: '0.8125rem', lineHeight: 1.5 }}
          />
        </div>

        {/* Notes / Comment Input */}
        <div>
          <label className="meta-label" style={{ display: 'block', marginBottom: 8, fontSize: '0.8125rem' }}>
            Feedback Comments & Insights
          </label>
          <input
            className="input"
            placeholder="Add comments explaining rating or response behavior..."
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            disabled={saving}
            style={{ width: '100%', fontSize: '0.8125rem' }}
          />
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
        <button
          className="btn btn-primary"
          onClick={saveFeedback}
          disabled={saving}
          style={{ padding: '10px 20px', width: '100%' }}
        >
          {saving ? 'Updating feedback...' : 'Save Feedback & Recalculate'}
        </button>
        {statusMsg && (
          <div style={{
            padding: '8px 12px',
            borderRadius: 6,
            fontSize: '0.8125rem',
            fontWeight: 500,
            background: statusMsg.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(244, 63, 94, 0.15)',
            color: statusMsg.type === 'success' ? 'var(--accent-emerald)' : 'var(--accent-rose)',
            border: `1px solid ${statusMsg.type === 'success' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(244, 63, 94, 0.3)'}`,
            textAlign: 'center',
          }}>
            {statusMsg.text}
          </div>
        )}
      </div>
    </div>
  );
}

function EvaluationPanel({ evaluation }) {
  const evalObj = evaluation ? (typeof evaluation === 'string' ? JSON.parse(evaluation) : evaluation) : null;
  const safety = evalObj?.safety || null;

  if (!evalObj) {
    return (
      <div className="glass-card eval-card" style={{ padding: 24, gap: 16 }}>
        <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Sparkles size={18} style={{ color: 'var(--accent-amber)' }} />
          AI Quality Evaluation
        </h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.5 }}>
          <p>
            No evaluation data has been calculated for this request yet.
          </p>
          <div style={{ background: 'rgba(255,255,255,0.02)', padding: 12, borderRadius: 'var(--radius-md)', border: '1px dashed var(--border)' }}>
            <strong style={{ color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>How to run evaluations:</strong>
            <ul style={{ listStyleType: 'disc', paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <li>Provide an <strong>Expected Answer</strong> in the Feedback panel to instantly calculate Exact Match, F1, BLEU, and ROUGE-L alignment scores.</li>
              <li>Configure your <code>UPSTREAM_API_KEY</code> on the server to automatically run LLM-as-a-judge metrics (Faithfulness, Relevancy, Hallucinations).</li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  const hasRAG = evalObj.faithfulness != null || evalObj.answer_relevancy != null || evalObj.context_precision != null || evalObj.context_recall != null || evalObj.hallucination_rate != null;
  const hasRetrieval = evalObj.recall_at_k != null || evalObj.precision_at_k != null || evalObj.mrr != null;
  const hasNLP = evalObj.exact_match != null || evalObj.f1_score != null || evalObj.bleu != null || evalObj.rouge_l != null;
  const hasAgent = evalObj.tool_success_rate != null || evalObj.iteration_count != null || evalObj.tool_selection_accuracy != null || evalObj.planning_accuracy != null || evalObj.goal_completion_rate != null;

  // Task-specific metrics detection
  const taskType = evalObj.task_type || null;
  const taskMetricKeys = Array.isArray(evalObj.task_metrics) ? evalObj.task_metrics : [];
  const hasTaskMetrics = taskType && taskMetricKeys.length > 0;

  // Set default tab based on available data — prefer task metrics for playground runs
  let defaultTab = 'task';
  if (hasTaskMetrics) defaultTab = 'task';
  else if (hasRAG) defaultTab = 'rag';
  else if (hasNLP || hasRetrieval) defaultTab = 'nlp';
  else if (hasAgent) defaultTab = 'agent';

  const [activeTab, setActiveTab] = useState(defaultTab);

  // Circular Score Configuration
  const score = Number(evalObj.score || 0);
  const maxScore = 5.0;
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (score / maxScore) * circumference;

  let strokeColor = 'var(--accent-rose)';
  if (score >= 4.0) strokeColor = 'var(--accent-emerald)';
  else if (score >= 3.0) strokeColor = 'var(--accent-amber)';

  // Task type display config
  const taskTypeConfig = {
    summarization:     { label: 'Summary',         icon: '📝', color: 'var(--accent-cyan)' },
    paraphrase:        { label: 'Paraphrase',      icon: '🔄', color: 'var(--accent-purple)' },
    translation:       { label: 'Translation',     icon: '🌐', color: 'var(--accent-blue)' },
    question_answering:{ label: 'Q&A',             icon: '❓', color: 'var(--accent-amber)' },
    code_generation:   { label: 'Code Gen',        icon: '💻', color: 'var(--accent-emerald)' },
    creative_writing:  { label: 'Creative',        icon: '✨', color: 'var(--accent-pink)' },
    classification:    { label: 'Classification',  icon: '🏷️', color: 'var(--accent-indigo)' },
    extraction:        { label: 'Extraction',      icon: '🔍', color: 'var(--accent-cyan)' },
    conversation:      { label: 'Conversation',    icon: '💬', color: 'var(--accent-blue)' },
    general:           { label: 'General',         icon: '⚡', color: 'var(--accent-amber)' },
  };

  const taskConfig = taskTypeConfig[taskType] || taskTypeConfig.general;

  // Task metric display names and descriptions
  const taskMetricInfo = {
    conciseness:            { name: 'Conciseness',            desc: 'How brief and compact without losing meaning',       color: 'var(--accent-cyan)' },
    information_retention:  { name: 'Information Retention',  desc: 'How much key information from the source is kept',   color: 'var(--accent-emerald)' },
    coherence:              { name: 'Coherence',              desc: 'Logical flow, readability, and structural quality',   color: 'var(--accent-blue)' },
    fluency:                { name: 'Fluency',                desc: 'Grammatical correctness and natural language quality', color: 'var(--accent-purple)' },
    semantic_preservation:  { name: 'Semantic Preservation',  desc: 'Does the output maintain the original meaning?',     color: 'var(--accent-amber)' },
    lexical_diversity:      { name: 'Lexical Diversity',      desc: 'Uses different words and phrasings from the source',  color: 'var(--accent-pink)' },
    instruction_following:  { name: 'Instruction Following',  desc: 'How well the response follows the prompt instructions', color: 'var(--accent-indigo)' },
    completeness:           { name: 'Completeness',           desc: 'Is the response thorough and comprehensive?',        color: 'var(--accent-emerald)' },
    creativity:             { name: 'Creativity',             desc: 'Originality, engagement, and creative quality',       color: 'var(--accent-pink)' },
    code_correctness:       { name: 'Code Correctness',       desc: 'Functional correctness and best practices',          color: 'var(--accent-emerald)' },
    translation_accuracy:   { name: 'Translation Accuracy',   desc: 'Fidelity, terminology, and correctness of translation', color: 'var(--accent-blue)' },
    factual_accuracy:       { name: 'Factual Accuracy',       desc: 'Factual correctness and grounding of the response',   color: 'var(--accent-amber)' },
    readability:            { name: 'Readability',            desc: 'Formatting clarity, structure, and comment quality',  color: 'var(--accent-cyan)' },
    code_efficiency:        { name: 'Code Efficiency',        desc: 'Optimality, complexity, and algorithmic simplicity',  color: 'var(--accent-emerald)' },
    tone_relevance:         { name: 'Tone Relevance',         desc: 'Consistency with the target persona, voice, or style', color: 'var(--accent-pink)' },
    classification_accuracy:{ name: 'Classification Accuracy',desc: 'Correctness of the predicted labels/categories',       color: 'var(--accent-indigo)' },
    reasoning_quality:      { name: 'Reasoning Quality',      desc: 'Quality and logic of the explanation for class choice', color: 'var(--accent-purple)' },
    extraction_precision:   { name: 'Extraction Precision',   desc: 'Fidelity of entities, fields, and values extracted',  color: 'var(--accent-cyan)' },
    format_compliance:      { name: 'Format Compliance',      desc: 'Compliance with output formats (JSON/markdown schemas)', color: 'var(--accent-emerald)' },
    conversational_flow:    { name: 'Conversational Flow',    desc: 'Context retention, turn transitions, and naturalness', color: 'var(--accent-blue)' },
    helpfulness:            { name: 'Helpfulness',            desc: 'Subjective helpfulness and user satisfaction indicator', color: 'var(--accent-purple)' },
  };

  const renderMetricRow = (name, value, max = 1.0, isPercentage = false, description = '', color = 'var(--accent-cyan)') => {
    if (value == null) return null;
    const numericValue = Number(value);
    const pct = Math.min(100, Math.max(0, (numericValue / max) * 100));
    
    let displayValue = '';
    if (isPercentage) {
      displayValue = `${(numericValue * 100).toFixed(0)}%`;
    } else if (max === 1.0) {
      displayValue = numericValue.toFixed(3);
    } else {
      displayValue = `${numericValue.toFixed(1)} / ${max.toFixed(1)}`;
    }

    return (
      <div className="eval-metric-card animate-fade-in" key={name}>
        <div className="eval-metric-header">
          <div>
            <span className="eval-metric-name">{name}</span>
            {description && <div className="eval-metric-description">{description}</div>}
          </div>
          <span className="eval-metric-value" style={{ color }}>{displayValue}</span>
        </div>
        <div className="eval-metric-progress-container">
          <div className="eval-metric-progress-wrapper">
            <div className="eval-metric-progress-fill" style={{ width: `${pct}%`, background: color }} />
          </div>
        </div>
      </div>
    );
  };

  const categoryLabel = evalObj.category || 'general';
  const showCategoryBadge = !taskType || taskType.toLowerCase().replace(/_/g, '') !== categoryLabel.toLowerCase().replace(/_/g, '');

  return (
    <div className="glass-card eval-card animate-slide-up" style={{ padding: 24, gap: 20 }}>
      {/* Top Header Summary */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Sparkles size={18} style={{ color: 'var(--accent-amber)' }} />
          AI Evaluator Quality Dashboard
        </h4>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {safety && (
            <Badge variant={safety.status === 'safe' ? 'success' : (safety.status === 'flagged' ? 'warning' : 'error')}>
              🛡️ {safety.status.toUpperCase()}
            </Badge>
          )}
          {taskType && (
            <Badge variant="purple" style={{ fontSize: '0.7rem', padding: '3px 8px' }}>
              {taskConfig.icon} {taskConfig.label}
            </Badge>
          )}
          {showCategoryBadge && (
            <Badge variant={score >= 4.0 ? 'success' : (score >= 3.0 ? 'warning' : 'error')}>
              {categoryLabel}
            </Badge>
          )}
        </div>
      </div>

      {safety && safety.status !== 'safe' && (
        <div style={{ 
          background: safety.status === 'unsafe' ? 'rgba(244, 63, 94, 0.08)' : 'rgba(245, 158, 11, 0.08)',
          border: `1px solid ${safety.status === 'unsafe' ? 'rgba(244, 63, 94, 0.2)' : 'rgba(245, 158, 11, 0.2)'}`,
          padding: 12,
          borderRadius: 'var(--radius-md)',
          fontSize: '0.8125rem',
          display: 'flex',
          flexDirection: 'column',
          gap: 4
        }}>
          <strong style={{ color: safety.status === 'unsafe' ? 'var(--accent-rose)' : 'var(--accent-amber)', display: 'flex', alignItems: 'center', gap: 6, margin: 0 }}>
            🛡️ Guardrail Alert: {safety.status.toUpperCase()}
          </strong>
          <span style={{ color: 'var(--text-secondary)' }}>
            {safety.reasoning || safety.reason || 'Safety issue detected in user query or assistant response.'}
          </span>
        </div>
      )}

      <div className="eval-header-summary">
        <div className="eval-ring-container">
          <svg className="eval-ring-svg" viewBox="0 0 80 80">
            <circle className="eval-ring-circle-bg" cx="40" cy="40" r={radius} />
            <circle 
              className="eval-ring-circle-val" 
              cx="40" 
              cy="40" 
              r={radius} 
              stroke={strokeColor}
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
            />
          </svg>
          <div className="eval-score-text">
            {score.toFixed(1)}
            <span>/ 5.0</span>
          </div>
        </div>

        <div className="eval-quote-card">
          <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', fontWeight: 600 }}>
            Evaluator Decision
          </div>
          <div className="eval-quote-text">
            "{evalObj.reasoning || 'No quality reasoning details provided by the evaluation model.'}"
          </div>
        </div>
      </div>

      {/* Tabs Navigator */}
      <div className="eval-tabs-nav">
        {hasTaskMetrics && (
          <button 
            type="button"
            className={`eval-tab-btn ${activeTab === 'task' ? 'active' : ''}`}
            onClick={() => setActiveTab('task')}
          >
            <span style={{ fontSize: '0.85rem' }}>{taskConfig.icon}</span>
            {taskConfig.label} Metrics
          </button>
        )}
        {hasRAG && (
          <button 
            type="button"
            className={`eval-tab-btn ${activeTab === 'rag' ? 'active' : ''}`}
            onClick={() => setActiveTab('rag')}
          >
            <BookOpen size={14} />
            RAG & Retrieval
          </button>
        )}
        {(hasNLP || hasRetrieval) && (
          <button 
            type="button"
            className={`eval-tab-btn ${activeTab === 'nlp' ? 'active' : ''}`}
            onClick={() => setActiveTab('nlp')}
          >
            <Target size={14} />
            Ground Truth NLP
          </button>
        )}
        {hasAgent && (
          <button 
            type="button"
            className={`eval-tab-btn ${activeTab === 'agent' ? 'active' : ''}`}
            onClick={() => setActiveTab('agent')}
          >
            <Cpu size={14} />
            Agent Workflow
          </button>
        )}
      </div>

      {/* Tab Contents */}
      <div className="eval-metric-list">
        {/* Task-Specific Metrics Tab */}
        {activeTab === 'task' && hasTaskMetrics && (
          <>
            {taskMetricKeys.map((key) => {
              const info = taskMetricInfo[key];
              if (!info || evalObj[key] == null) return null;
              return renderMetricRow(
                info.name,
                evalObj[key],
                5.0,
                false,
                info.desc,
                info.color
              );
            })}
          </>
        )}

        {activeTab === 'rag' && (
          <>
            {renderMetricRow('Faithfulness', evalObj.faithfulness, 5.0, false, 'Is the answer fully grounded in the retrieved context?', 'var(--accent-emerald)')}
            {renderMetricRow('Answer Relevancy', evalObj.answer_relevancy, 5.0, false, 'Does the response address the user prompt directly?', 'var(--accent-blue)')}
            {renderMetricRow('Context Precision', evalObj.context_precision, 5.0, false, 'Did retrieval capture highly relevant chunks in early ranks?', 'var(--accent-cyan)')}
            {renderMetricRow('Context Recall', evalObj.context_recall, 5.0, false, 'Did retrieval fetch all critical source information?', 'var(--accent-purple)')}
            
            {evalObj.hallucination_rate != null && (
              <div className="eval-metric-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span className="eval-metric-name">Hallucination Rate</span>
                    <div className="eval-metric-description">Percentage of ungrounded factual assumptions</div>
                  </div>
                  <span 
                    className="mono" 
                    style={{ 
                      fontWeight: 700, 
                      fontSize: '1.05rem',
                      color: Number(evalObj.hallucination_rate) > 0.2 ? 'var(--accent-rose)' : 'var(--accent-emerald)' 
                    }}
                  >
                    {(Number(evalObj.hallucination_rate) * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
            )}
          </>
        )}

        {activeTab === 'nlp' && (
          <>
            {evalObj.exact_match != null && (
              <div className="eval-metric-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span className="eval-metric-name">Exact Match</span>
                  <div className="eval-metric-description">Identical string match with reference target</div>
                </div>
                <Badge variant={evalObj.exact_match === 1 ? 'success' : 'default'} style={{ fontSize: '0.75rem', padding: '4px 12px' }}>
                  {evalObj.exact_match === 1 ? 'EXACT MATCH' : 'NO MATCH'}
                </Badge>
              </div>
            )}
            {renderMetricRow('F1 Token Score', evalObj.f1_score, 1.0, false, 'Token overlap ratio (Precision/Recall average)', 'var(--accent-blue)')}
            {renderMetricRow('BLEU Score', evalObj.bleu, 1.0, false, 'n-gram similarity benchmark for translation & fluency', 'var(--accent-cyan)')}
            {renderMetricRow('ROUGE-L Score', evalObj.rouge_l, 1.0, false, 'Longest Common Subsequence recall rate', 'var(--accent-purple)')}
            
            {hasRetrieval && (
              <div style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', fontWeight: 600 }}>
                  Retrieval Performance Indices
                </div>
                {renderMetricRow('Recall@K', evalObj.recall_at_k, 1.0, false, 'Fraction of all relevant items successfully retrieved', 'var(--accent-pink)')}
                {renderMetricRow('Precision@K', evalObj.precision_at_k, 1.0, false, 'Fraction of retrieved items that are relevant', 'var(--accent-amber)')}
                {renderMetricRow('Mean Reciprocal Rank (MRR)', evalObj.mrr, 1.0, false, 'Reciprocal rank of the first relevant retrieved item', 'var(--accent-indigo)')}
              </div>
            )}
          </>
        )}

        {activeTab === 'agent' && (
          <>
            {evalObj.goal_completion_rate != null && (
              <div className="eval-metric-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span className="eval-metric-name">Goal Completion</span>
                  <div className="eval-metric-description">Agent self-reported task resolution status</div>
                </div>
                <Badge variant={evalObj.goal_completion_rate === 1.0 ? 'success' : 'error'} style={{ fontSize: '0.75rem', padding: '4px 12px' }}>
                  {evalObj.goal_completion_rate === 1.0 ? 'COMPLETED' : 'UNRESOLVED'}
                </Badge>
              </div>
            )}
            
            {evalObj.iteration_count != null && (
              <div className="eval-metric-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span className="eval-metric-name">Agent Steps Count</span>
                    <div className="eval-metric-description">Total loops/actions executed inside this trace session</div>
                  </div>
                  <span className="mono" style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '1.05rem' }}>
                    {evalObj.iteration_count} iterations
                  </span>
                </div>
              </div>
            )}

            {renderMetricRow('Tool Success Rate', evalObj.tool_success_rate, 1.0, true, 'Ratio of successful tool executions vs total calls', 'var(--accent-emerald)')}
            {renderMetricRow('Tool Selection Accuracy', evalObj.tool_selection_accuracy, 1.0, true, 'Accuracy in selecting correct tool signatures', 'var(--accent-blue)')}
            {renderMetricRow('Planning Accuracy', evalObj.planning_accuracy, 1.0, true, 'Linguistic evaluation of agent prompt rationale', 'var(--accent-purple)')}
          </>
        )}
      </div>
    </div>
  );
}

