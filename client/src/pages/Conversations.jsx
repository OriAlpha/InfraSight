import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, MessageSquare, DollarSign, Hash, Clock, ChevronRight } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { useApi } from '../hooks/useApi';
import ChatBubble from '../components/ui/ChatBubble';
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
                      {conv.message_count || conv.turn_count || 0} messages
                    </span>
                    {conv.model && (
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Clock size={12} />
                        {formatModelName(conv.model)}
                      </span>
                    )}
                    {(conv.total_cost !== undefined || conv.cost !== undefined) && (
                      <span style={{ fontSize: '0.75rem', color: 'var(--accent-emerald)', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <DollarSign size={12} />
                        ${Number(conv.total_cost || conv.cost || 0).toFixed(6)}
                      </span>
                    )}
                    {conv.created_at && (
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                        {formatDistanceToNow(parseDate(conv.created_at), { addSuffix: true })}
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

  const messages = conversation?.messages || conversation?.logs || [];
  const title = conversation.title || conversation.conversation_id || `Conversation ${id}`;

  // Flatten messages from logs if needed
  const chatMessages = [];
  if (messages.length > 0 && messages[0]?.input_messages) {
    // These are log entries, flatten them into messages
    messages.forEach((log) => {
      let inputs = [];
      try {
        inputs = typeof log.input_messages === 'string'
          ? JSON.parse(log.input_messages)
          : log.input_messages || [];
      } catch { inputs = []; }

      // Only include the last user message to avoid duplicating context
      const userMsg = [...inputs].reverse().find((m) => m.role === 'user');
      if (userMsg) {
        chatMessages.push({ ...userMsg, timestamp: log.created_at });
      }

      let output = null;
      try {
        output = log.output_message
          ? typeof log.output_message === 'string'
            ? JSON.parse(log.output_message)
            : log.output_message
          : log.response_body
            ? (typeof log.response_body === 'string' ? JSON.parse(log.response_body) : log.response_body)?.choices?.[0]?.message
            : null;
      } catch { output = null; }

      if (output) {
        chatMessages.push({
          ...output,
          tokens: log.completion_tokens,
          cost: log.estimated_cost !== undefined ? log.estimated_cost : log.cost,
          timestamp: log.created_at,
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
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
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700 }}>{title}</h2>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: 2 }}>
            {chatMessages.length} messages
            {conversation.total_cost && ` · $${Number(conversation.total_cost).toFixed(6)}`}
          </p>
        </div>
      </div>

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
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
