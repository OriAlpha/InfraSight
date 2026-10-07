import { useState, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, MessageSquare, DollarSign, Hash, Clock, ChevronRight, Code, ExternalLink } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { useApi } from '../hooks/useApi';
import ChatBubble from '../components/ui/ChatBubble';
import JsonViewer from '../components/ui/JsonViewer';
import { parseDate } from '../utils/date';

function formatModelName(name) {
  if (!name) return 'Unknown';
  const parts = name.split('/');
  return parts[parts.length - 1];
}

export default function Conversations({ conversationId, onSelectConversation }) {
  const { id: pathId } = useParams();
  const activeId = conversationId !== undefined ? conversationId : pathId;

  if (activeId) {
    return (
      <ConversationDetail
        id={activeId}
        onBack={() => {
          if (onSelectConversation) {
            onSelectConversation(null);
          } else {
            window.history.back();
          }
        }}
      />
    );
  }

  return (
    <ConversationList
      onSelect={(id) => {
        if (onSelectConversation) {
          onSelectConversation(id);
        }
      }}
    />
  );
}

function ConversationList({ onSelect }) {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const { data, loading, error } = useApi('/conversations', {
    params: { page, limit: 20 },
  });

  const conversations = data?.data || data?.conversations || (Array.isArray(data) ? data : []);
  const totalPages = data?.pagination?.totalPages || data?.totalPages || 1;

  if (loading) {
    return (
      <div className="animate-slide-up">
        <div className="page-header">
          <h2>Conversations</h2>
          <p>Multi-turn conversation threads</p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="glass-card" style={{ padding: 20 }}>
              <div className="skeleton skeleton-text" style={{ width: '60%' }} />
              <div className="skeleton skeleton-text" style={{ width: '40%', marginTop: 8 }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="animate-slide-up">
      <div className="page-header">
        <h2>Conversations</h2>
        <p>Multi-turn conversation threads</p>
      </div>

      {error ? (
        <div className="glass-card-static" style={{ padding: 48, textAlign: 'center' }}>
          <p style={{ color: 'var(--accent-rose)' }}>Error loading conversations: {error}</p>
        </div>
      ) : conversations.length === 0 ? (
        <div className="glass-card-static">
          <div className="empty-state">
            <MessageSquare size={48} className="empty-icon" />
            <h3>No conversations yet</h3>
            <p>Conversations will appear here when your API calls include conversation tracking.</p>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {conversations.map((conv) => (
            <div
              key={conv.id || conv.conversation_id}
              className="glass-card"
              style={{ padding: 20, cursor: 'pointer' }}
              onClick={() => {
                if (onSelect) {
                  onSelect(conv.id || conv.conversation_id);
                } else {
                  navigate(`/conversations/${conv.id || conv.conversation_id}`);
                }
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <MessageSquare size={16} style={{ color: 'var(--accent-blue)', flexShrink: 0 }} />
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {conv.title || conv.conversation_id || `Conversation ${conv.id}`}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 20, marginTop: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Hash size={12} />
                      {conv.total_messages || conv.message_count || conv.turn_count || 0} messages
                    </span>
                    {conv.model && (
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Clock size={12} />
                        {formatModelName(conv.model)}
                      </span>
                    )}
                    {conv.total_tokens > 0 && (
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 4 }}>
                        {conv.total_tokens.toLocaleString()} tokens
                      </span>
                    )}
                    {(conv.total_cost !== undefined || conv.cost !== undefined) && (
                      <span style={{ fontSize: '0.75rem', color: 'var(--accent-emerald)', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <DollarSign size={12} />
                        ${Number(conv.total_cost || conv.cost || 0).toFixed(6)}
                      </span>
                    )}
                    {(conv.last_message_at || conv.created_at) && (
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                        {formatDistanceToNow(parseDate(conv.last_message_at || conv.created_at), { addSuffix: true })}
                      </span>
                    )}
                  </div>
                </div>
                <ChevronRight size={18} style={{ color: 'var(--text-dim)', flexShrink: 0, marginLeft: 12 }} />
              </div>
            </div>
          ))}

          {totalPages > 1 && (
            <div className="pagination">
              <button
                className="pagination-btn"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                ‹
              </button>
              <span className="pagination-info">
                Page {page} of {totalPages}
              </span>
              <button
                className="pagination-btn"
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
              >
                ›
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ConversationDetail({ id, onBack }) {
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState('chat'); // 'chat' | 'raw'
  const { data: conversation, loading, error } = useApi(`/conversations/${id}`);

  if (loading) {
    return (
      <div className="animate-slide-up">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 32 }}>
          <button className="btn btn-ghost" onClick={() => navigate('/conversations')}>
            <ArrowLeft size={18} />
          </button>
          <div className="skeleton skeleton-heading" style={{ width: 200 }} />
        </div>
        <div className="glass-card-static" style={{ padding: 24 }}>
          <div className="skeleton skeleton-chart" />
        </div>
      </div>
    );
  }

  if (error || !conversation) {
    return (
      <div className="animate-slide-up">
        <button className="btn btn-ghost" onClick={() => navigate('/conversations')}>
          <ArrowLeft size={18} /> Back
        </button>
        <div className="glass-card-static" style={{ padding: 48, textAlign: 'center', marginTop: 24 }}>
          <p style={{ color: 'var(--accent-rose)' }}>{error || 'Conversation not found'}</p>
        </div>
      </div>
    );
  }

  const convMeta = conversation?.conversation || conversation || {};
  const messages = conversation?.messages || convMeta?.messages || conversation?.logs || [];
  const title = convMeta.title || convMeta.id || convMeta.conversation_id || `Conversation ${id}`;
  const totalCost = convMeta.total_cost != null ? convMeta.total_cost : conversation?.total_cost;
  const totalTokens = convMeta.total_tokens != null ? convMeta.total_tokens : conversation?.total_tokens;
  const primaryModel = convMeta.model || (messages.length > 0 ? messages[0].model : null);

  // Flatten messages from logs if needed
  const chatMessages = [];
  if (messages.length > 0 && messages[0]?.input_messages) {
    messages.forEach((log, logIdx) => {
      let inputs = [];
      try {
        inputs = typeof log.input_messages === 'string'
          ? JSON.parse(log.input_messages)
          : log.input_messages || [];
      } catch { inputs = []; }

      // For single-log conversations, render the full multi-turn input history
      if (messages.length === 1) {
        inputs.forEach((m) => {
          chatMessages.push({ ...m, timestamp: log.created_at, logId: log.id });
        });
      } else {
        // For multi-log conversations, include system prompt from initial turn
        if (logIdx === 0 && chatMessages.length === 0) {
          const sysMsg = inputs.find((m) => m.role === 'system');
          if (sysMsg) {
            chatMessages.push({ ...sysMsg, timestamp: log.created_at, logId: log.id });
          }
        }

        // Include the user message for this turn
        const userMsg = [...inputs].reverse().find((m) => m.role === 'user');
        if (userMsg) {
          chatMessages.push({ ...userMsg, timestamp: log.created_at, logId: log.id });
        }
      }

      let output = null;
      if (log.output_message) {
        if (typeof log.output_message === 'object') {
          output = log.output_message;
        } else if (typeof log.output_message === 'string') {
          try {
            output = JSON.parse(log.output_message);
          } catch {
            output = { role: 'assistant', content: log.output_message };
          }
        }
      } else if (log.output_text) {
        output = { role: 'assistant', content: log.output_text };
      } else if (log.raw_response) {
        try {
          const raw = typeof log.raw_response === 'string' ? JSON.parse(log.raw_response) : log.raw_response;
          output = raw?.choices?.[0]?.message;
        } catch {}
      }

      if (typeof output === 'string') output = { role: 'assistant', content: output };
      if (output && !output.role) output.role = 'assistant';

      if (output) {
        const lastMsg = chatMessages[chatMessages.length - 1];
        const isDuplicate = messages.length === 1 && lastMsg && lastMsg.role === output.role && lastMsg.content === output.content;
        if (!isDuplicate) {
          chatMessages.push({
            ...output,
            tokens: log.completion_tokens,
            cost: log.estimated_cost !== undefined ? log.estimated_cost : log.cost,
            timestamp: log.created_at,
            logId: log.id,
          });
        }
      } else if (log.status === 'error' || log.error_message) {
        chatMessages.push({
          role: 'system',
          content: `⚠️ Error (${log.status || 'error'}): ${log.error_message || 'Request failed'}`,
          timestamp: log.created_at,
          logId: log.id,
        });
      }
    });
  } else {
    // Already individual messages
    messages.forEach((msg) => {
      chatMessages.push(msg);
    });
  }

  return (
    <div className="animate-slide-up">
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
        <button
          className="btn btn-ghost"
          onClick={() => {
            if (onBack) {
              onBack();
            } else {
              navigate('/conversations');
            }
          }}
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 700, margin: 0 }}>{title}</h2>
            {primaryModel && (
              <span
                style={{
                  fontSize: '0.75rem',
                  padding: '2px 8px',
                  borderRadius: 'var(--radius-full)',
                  background: 'rgba(255, 255, 255, 0.06)',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border)',
                }}
              >
                {formatModelName(primaryModel)}
              </span>
            )}
          </div>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: 4 }}>
            {chatMessages.length} messages
            {totalTokens ? ` · ${totalTokens.toLocaleString()} tokens` : ''}
            {totalCost !== undefined && totalCost !== null ? ` · $${Number(totalCost).toFixed(6)}` : ''}
            {convMeta.created_at ? ` · Started ${formatDistanceToNow(parseDate(convMeta.created_at), { addSuffix: true })}` : ''}
          </p>
        </div>
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

      {viewMode === 'chat' ? (
        <div className="glass-card-static">
          {chatMessages.length === 0 ? (
            <div className="empty-state" style={{ padding: 48 }}>
              <MessageSquare size={40} className="empty-icon" />
              <h3>No messages</h3>
            </div>
          ) : (
            <div className="chat-container">
              {chatMessages.map((msg, i) => (
                <ChatBubble
                  key={i}
                  role={msg.role || 'user'}
                  content={msg.content}
                  tokens={msg.tokens}
                  cost={msg.cost}
                  timestamp={msg.timestamp ? format(parseDate(msg.timestamp), 'HH:mm:ss') : undefined}
                >
                  {msg.logId && (
                    <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                      <Link
                        to={`/logs/${msg.logId}`}
                        style={{
                          fontSize: '0.75rem',
                          color: 'var(--accent-blue)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          textDecoration: 'none',
                        }}
                      >
                        <ExternalLink size={11} /> View evaluation & log details
                      </Link>
                    </div>
                  )}
                </ChatBubble>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="glass-card-static" style={{ padding: 20 }}>
            <h4 style={{ marginBottom: 12, fontSize: '0.875rem', color: 'var(--text-muted)' }}>
              Conversation Log History (Raw JSON)
            </h4>
            <JsonViewer data={conversation} />
          </div>
        </div>
      )}
    </div>
  );
}
