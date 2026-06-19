import { useState, useMemo, useCallback, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, Filter, X, Download, Database, List, GitFork, MessageSquare, Upload, AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useApi, fetchApi } from '../hooks/useApi';
import DataTable from '../components/ui/DataTable';
import { parseDate } from '../utils/date';
import Badge from '../components/ui/Badge';
import DateRangePicker from '../components/ui/DateRangePicker';
import CustomSelect from '../components/ui/CustomSelect';
import TracesView from './Traces';
import ConversationsView from './Conversations';

function formatModelName(name) {
  if (!name) return 'Unknown';
  const parts = name.split('/');
  return parts[parts.length - 1];
}

function truncate(str, len = 60) {
  if (!str) return '—';
  if (typeof str !== 'string') str = JSON.stringify(str);
  return str.length > len ? str.slice(0, len) + '…' : str;
}

export default function Logs() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // View mode from URL: 'list' (default), 'traces', or 'conversations'
  const viewMode = searchParams.get('view') === 'traces'
    ? 'traces'
    : searchParams.get('view') === 'conversations'
      ? 'conversations'
      : 'list';
  const focusTraceId = searchParams.get('traceId') || null;
  const selectedConversationId = searchParams.get('conversationId') || null;

  const setViewMode = useCallback((mode) => {
    const next = new URLSearchParams(searchParams);
    if (mode === 'traces') {
      next.set('view', 'traces');
      next.delete('conversationId');
    } else if (mode === 'conversations') {
      next.set('view', 'conversations');
    } else {
      next.delete('view');
      next.delete('conversationId');
    }
    next.delete('traceId');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const handleSelectConversation = useCallback((id) => {
    const next = new URLSearchParams(searchParams);
    if (id) {
      next.set('conversationId', id);
    } else {
      next.delete('conversationId');
    }
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const parseQueryParam = (val) => {
    if (val === 'undefined' || val === 'null' || !val) return '';
    return val;
  };

  // Shared filter state
  const [showImportModal, setShowImportModal] = useState(false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(() => parseQueryParam(searchParams.get('search')));
  const [searchInput, setSearchInput] = useState(() => parseQueryParam(searchParams.get('search')));
  const [modelFilter, setModelFilter] = useState(() => parseQueryParam(searchParams.get('model')));
  const [statusFilter, setStatusFilter] = useState(() => parseQueryParam(searchParams.get('status')));
  const [feedbackFilter, setFeedbackFilter] = useState(() => parseQueryParam(searchParams.get('feedback')));
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState('desc');
  const [dateRange, setDateRange] = useState(() => ({
    startDate: parseQueryParam(searchParams.get('startDate')),
    endDate: parseQueryParam(searchParams.get('endDate')),
  }));

  // Saved filters state
  const [savedFilters, setSavedFilters] = useState(() => {
    try {
      const stored = localStorage.getItem('infrasight_saved_filters');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [showSaveFilterModal, setShowSaveFilterModal] = useState(false);
  const [newFilterName, setNewFilterName] = useState('');

  const saveCurrentFilter = (name) => {
    if (!name.trim()) return;
    const newFilter = {
      id: crypto.randomUUID(),
      name: name.trim(),
      filters: {
        model: modelFilter,
        status: statusFilter,
        feedback: feedbackFilter,
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        search: search,
      }
    };
    const updated = [...savedFilters, newFilter];
    setSavedFilters(updated);
    localStorage.setItem('infrasight_saved_filters', JSON.stringify(updated));
    setNewFilterName('');
    setShowSaveFilterModal(false);
  };

  const applySavedFilter = (filter) => {
    setModelFilter(filter.filters.model || '');
    setStatusFilter(filter.filters.status || '');
    setFeedbackFilter(filter.filters.feedback || '');
    setDateRange({
      startDate: filter.filters.startDate || '',
      endDate: filter.filters.endDate || '',
    });
    setSearch(filter.filters.search || '');
    setSearchInput(filter.filters.search || '');
    setPage(1);
  };

  const deleteSavedFilter = (id, e) => {
    e.stopPropagation();
    const updated = savedFilters.filter(f => f.id !== id);
    setSavedFilters(updated);
    localStorage.setItem('infrasight_saved_filters', JSON.stringify(updated));
  };

  useEffect(() => {
    const nextStatus = parseQueryParam(searchParams.get('status'));
    const nextModel = parseQueryParam(searchParams.get('model'));
    const nextFeedback = parseQueryParam(searchParams.get('feedback'));
    const nextStart = parseQueryParam(searchParams.get('startDate'));
    const nextEnd = parseQueryParam(searchParams.get('endDate'));
    const nextSearch = parseQueryParam(searchParams.get('search'));

    if (nextStatus !== statusFilter) setStatusFilter(nextStatus);
    if (nextModel !== modelFilter) setModelFilter(nextModel);
    if (nextFeedback !== feedbackFilter) setFeedbackFilter(nextFeedback);
    if (nextStart !== dateRange.startDate || nextEnd !== dateRange.endDate) {
      setDateRange({ startDate: nextStart, endDate: nextEnd });
    }
    if (nextSearch !== search) {
      setSearch(nextSearch);
      setSearchInput(nextSearch);
    }
  }, [searchParams]);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    
    if (modelFilter) next.set('model', modelFilter);
    else next.delete('model');
    
    if (statusFilter) next.set('status', statusFilter);
    else next.delete('status');
    
    if (feedbackFilter) next.set('feedback', feedbackFilter);
    else next.delete('feedback');
    
    if (dateRange.startDate) next.set('startDate', dateRange.startDate);
    else next.delete('startDate');
    
    if (dateRange.endDate) next.set('endDate', dateRange.endDate);
    else next.delete('endDate');
    
    if (search) next.set('search', search);
    else next.delete('search');
    
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [modelFilter, statusFilter, feedbackFilter, dateRange, search, searchParams, setSearchParams]);

  const limit = 20;

  const params = useMemo(
    () => ({
      page,
      limit,
      search: search || undefined,
      model: modelFilter || undefined,
      status: statusFilter || undefined,
      feedback: feedbackFilter || undefined,
      startDate: dateRange.startDate || undefined,
      endDate: dateRange.endDate || undefined,
      sortBy,
      sortOrder,
    }),
    [page, search, modelFilter, statusFilter, feedbackFilter, dateRange, sortBy, sortOrder]
  );

  const { data, loading, error, refetch } = useApi('/logs', { params, enabled: viewMode === 'list' });
  const { data: modelsData } = useApi('/models');

  const logs = data?.data || data?.logs || (Array.isArray(data) ? data : []);
  const totalPages = data?.pagination?.totalPages || data?.totalPages || 1;
  const totalCount = data?.pagination?.total || data?.total || logs.length;

  const models = useMemo(() => {
    if (!modelsData) return [];
    const list = Array.isArray(modelsData) ? modelsData : modelsData.data || [];
    return list;
  }, [modelsData]);

  const modelOptions = useMemo(() => {
    return [
      { value: '', label: 'All Models' },
      ...models.map((m) => ({
        value: m.model_id || m.name,
        label: formatModelName(m.model_id || m.name),
      })),
    ];
  }, [models]);

  const statusOptions = useMemo(() => [
    { value: '', label: 'All Status' },
    { value: 'success', label: 'Success' },
    { value: 'error', label: 'Error' },
  ], []);

  const feedbackOptions = useMemo(() => [
    { value: '', label: 'All Feedback' },
    { value: 'positive', label: '👍 Positive' },
    { value: 'negative', label: '👎 Negative' },
  ], []);

  const handleSearch = useCallback(
    (e) => {
      e.preventDefault();
      setSearch(searchInput);
      setPage(1);
    },
    [searchInput]
  );

  const handleSort = useCallback((key, order) => {
    setSortBy(key);
    setSortOrder(order);
    setPage(1);
  }, []);

  const clearFilters = () => {
    setSearch('');
    setSearchInput('');
    setModelFilter('');
    setStatusFilter('');
    setFeedbackFilter('');
    setDateRange({ startDate: '', endDate: '' });
    setPage(1);
  };

  const handleExportCsv = useCallback(() => {
    const query = new URLSearchParams({
      model: modelFilter || '',
      status: statusFilter || '',
      feedback: feedbackFilter || '',
      startDate: dateRange.startDate || '',
      endDate: dateRange.endDate || '',
      search: search || '',
    }).toString();
    window.open(`/api/logs/export/csv?${query}`, '_blank');
  }, [modelFilter, statusFilter, feedbackFilter, dateRange, search]);

  const handleExportFinetuning = useCallback(() => {
    const query = new URLSearchParams({
      model: modelFilter || '',
      status: statusFilter || 'success',
      feedback: feedbackFilter || '',
      startDate: dateRange.startDate || '',
      endDate: dateRange.endDate || '',
      search: search || '',
    }).toString();
    window.open(`/api/logs/export/finetuning?${query}`, '_blank');
  }, [modelFilter, statusFilter, feedbackFilter, dateRange, search]);

  const handleViewTrace = useCallback((traceId) => {
    const next = new URLSearchParams(searchParams);
    next.set('view', 'traces');
    next.set('traceId', traceId);
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const hasFilters = search || modelFilter || statusFilter || feedbackFilter || dateRange.startDate;

  const columns = [
    {
      key: 'created_at',
      label: 'Time',
      sortable: true,
      width: '140px',
      render: (val) => {
        if (!val) return '—';
        try {
          return formatDistanceToNow(parseDate(val), { addSuffix: true });
        } catch {
          return '—';
        }
      },
    },
    {
      key: 'model',
      label: 'Model',
      sortable: true,
      render: (val) => (
        <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
          {formatModelName(val)}
        </span>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      width: '90px',
      render: (val) => {
        const variant = val === 'success' ? 'success' : val === 'error' ? 'error' : 'warning';
        const displayVal = typeof val === 'string' ? val.charAt(0).toUpperCase() + val.slice(1) : val || '—';
        return <Badge variant={variant}>{displayVal}</Badge>;
      },
    },
    {
      key: 'input_preview',
      label: 'Task Type',
      render: (val, row) => {
        // Extract task type from evaluation JSON
        let taskType = 'general';
        try {
          if (row.evaluation) {
            const evalObj = typeof row.evaluation === 'string' ? JSON.parse(row.evaluation) : row.evaluation;
            if (evalObj && evalObj.task_type) {
              taskType = evalObj.task_type;
            } else if (evalObj && evalObj.category) {
              taskType = evalObj.category;
            }
          }
        } catch {}

        // Format task type for display
        const formatTaskType = (type) => {
          return type
            .split('_')
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
        };

        // Get custom color variables or backgrounds for tasks
        const getTaskBadgeStyle = (type) => {
          switch (type) {
            case 'code_generation':
              return { color: 'var(--accent-purple)', background: 'rgba(139, 92, 246, 0.1)', border: '1px solid rgba(139, 92, 246, 0.2)' };
            case 'summarization':
              return { color: 'var(--accent-cyan)', background: 'rgba(6, 182, 212, 0.1)', border: '1px solid rgba(6, 182, 212, 0.2)' };
            case 'translation':
              return { color: 'var(--accent-indigo)', background: 'rgba(99, 102, 241, 0.1)', border: '1px solid rgba(99, 102, 241, 0.2)' };
            case 'question_answering':
              return { color: 'var(--accent-blue)', background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.2)' };
            case 'creative_writing':
              return { color: 'var(--accent-pink)', background: 'rgba(236, 72, 153, 0.1)', border: '1px solid rgba(236, 72, 153, 0.2)' };
            case 'classification':
              return { color: 'var(--accent-amber)', background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.2)' };
            case 'extraction':
              return { color: 'var(--accent-rose)', background: 'rgba(244, 63, 94, 0.1)', border: '1px solid rgba(244, 63, 94, 0.2)' };
            case 'conversation':
              return { color: 'var(--accent-emerald)', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.2)' };
            default:
              return { color: 'var(--text-secondary)', background: 'rgba(148, 163, 184, 0.1)', border: '1px solid rgba(148, 163, 184, 0.2)' };
          }
        };

        const badgeStyle = getTaskBadgeStyle(taskType);

        return (
          <span
            style={{
              fontSize: '0.7rem',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              padding: '4px 10px',
              borderRadius: 'var(--radius-full)',
              display: 'inline-block',
              width: '140px',
              textAlign: 'center',
              ...badgeStyle
            }}
          >
            {formatTaskType(taskType)}
          </span>
        );
      },
    },
    {
      key: 'total_tokens',
      label: 'Tokens',
      sortable: true,
      width: '120px',
      render: (val, row) => (
        <span className="mono" style={{ fontSize: '0.8125rem' }}>
          <span style={{ color: 'var(--accent-blue)' }}>{row.prompt_tokens || 0}</span>
          <span style={{ color: 'var(--text-dim)' }}> / </span>
          <span style={{ color: 'var(--accent-cyan)' }}>{row.completion_tokens || 0}</span>
        </span>
      ),
    },
    {
      key: 'estimated_cost',
      label: 'Cost',
      sortable: true,
      width: '90px',
      render: (val) => (
        <span className="mono" style={{ color: 'var(--accent-emerald)', fontSize: '0.8125rem' }}>
          ${Number(val || 0).toFixed(5)}
        </span>
      ),
    },
    {
      key: 'latency_ms',
      label: 'Latency',
      sortable: true,
      width: '90px',
      render: (val) => (
        <span className="mono" style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
          {val ? (Number(val) >= 1000 ? `${(Number(val) / 1000).toFixed(2)}s` : `${Number(val).toFixed(0)}ms`) : '—'}
        </span>
      ),
    },
    {
      key: 'evaluation',
      label: 'Score',
      width: '90px',
      render: (val, row) => {
        try {
          const evalObj = row.evaluation ? (typeof row.evaluation === 'string' ? JSON.parse(row.evaluation) : row.evaluation) : null;
          if (evalObj && evalObj.score) {
            return (
              <span style={{ fontSize: '0.8125rem', color: 'var(--accent-amber)', fontWeight: 600 }}>
                ⭐ {evalObj.score}
              </span>
            );
          }
        } catch {}
        return <span style={{ color: 'var(--text-muted)' }}>—</span>;
      }
    },
    {
      key: 'trace_id',
      label: '',
      width: '40px',
      render: (val) => {
        if (!val) return null;
        return (
          <button
            onClick={(e) => { e.stopPropagation(); handleViewTrace(val); }}
            title="View in Trace Explorer"
            className="btn btn-ghost btn-sm"
            style={{ padding: 4, borderRadius: 4, lineHeight: 1 }}
          >
            <GitFork size={14} style={{ color: 'var(--accent-cyan)' }} />
          </button>
        );
      }
    },
  ];

  return (
    <div className="animate-slide-up">
      {/* Unified Header */}
      <div className="page-header" style={{ marginBottom: 16 }}>
        <h2>Request Logs</h2>
        <p>
          {viewMode === 'list' && `${totalCount.toLocaleString()} total request${totalCount !== 1 ? 's' : ''}${hasFilters ? ' (filtered)' : ''}`}
          {viewMode === 'traces' && 'Trace agent steps, chain runs, tool invocations, and LLM completions'}
          {viewMode === 'conversations' && 'Multi-turn conversation threads'}
        </p>
      </div>

      {/* Tabs & Actions Bar */}
      <div className="tabs-bar">
        <div className="tabs-list">
          <button
            onClick={() => setViewMode('list')}
            className={`tab-item ${viewMode === 'list' ? 'active' : ''}`}
          >
            <List size={16} />
            List
          </button>
          <button
            onClick={() => setViewMode('traces')}
            className={`tab-item ${viewMode === 'traces' ? 'active' : ''}`}
          >
            <GitFork size={16} />
            Traces
          </button>
          <button
            onClick={() => setViewMode('conversations')}
            className={`tab-item ${viewMode === 'conversations' ? 'active' : ''}`}
          >
            <MessageSquare size={16} />
            Conversations
          </button>
        </div>

        <div className="tabs-actions">
          {viewMode === 'list' && (
            <>
              <button
                onClick={() => setShowImportModal(true)}
                className="btn btn-secondary btn-sm"
                title="Import JSON/JSONL Logs Dataset"
                style={{ padding: '8px 12px', height: 'fit-content', borderColor: 'var(--accent-purple)' }}
              >
                <Upload size={14} style={{ color: 'var(--accent-purple)' }} />
                Import Logs
              </button>
              <button
                onClick={handleExportCsv}
                className="btn btn-secondary btn-sm"
                title="Export as CSV"
                style={{ padding: '8px 12px', height: 'fit-content' }}
              >
                <Download size={14} />
                Export CSV
              </button>
              <button
                onClick={handleExportFinetuning}
                className="btn btn-secondary btn-sm"
                title="Export OpenAI-compatible JSONL Dataset"
                style={{ padding: '8px 12px', height: 'fit-content', borderColor: 'var(--accent-cyan)' }}
              >
                <Database size={14} style={{ color: 'var(--accent-cyan)' }} />
                Export Dataset
              </button>
            </>
          )}

          {viewMode !== 'conversations' && (
            <DateRangePicker
              value={dateRange}
              onChange={(range) => {
                setDateRange(range);
                setPage(1);
              }}
            />
          )}
        </div>
      </div>

      {/* Saved Filters Row */}
      {viewMode === 'list' && (
        <div className="animate-slide-up" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 16, padding: '0 4px' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
            Saved Filters:
          </span>
          {savedFilters.length === 0 ? (
            <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontStyle: 'italic' }}>
              No saved filters yet.
            </span>
          ) : (
            savedFilters.map((f) => (
              <div
                key={f.id}
                onClick={() => applySavedFilter(f)}
                className="glass-card"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 10px',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  fontSize: '0.75rem',
                  fontWeight: 500,
                  background: 'rgba(255, 255, 255, 0.02)',
                  border: '1px solid var(--border)',
                  transition: 'all 0.2s',
                  transform: 'none',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'var(--accent-purple)';
                  e.currentTarget.style.background = 'rgba(139, 92, 246, 0.05)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border)';
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.02)';
                }}
              >
                <span>{f.name}</span>
                <button
                  onClick={(e) => deleteSavedFilter(f.id, e)}
                  style={{ display: 'flex', alignItems: 'center', padding: 2, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)' }}
                >
                  <X size={12} />
                </button>
              </div>
            ))
          )}
          
          <button
            onClick={() => setShowSaveFilterModal(true)}
            disabled={!hasFilters}
            className="btn btn-ghost btn-sm"
            style={{ padding: '2px 8px', fontSize: '0.75rem', height: 'auto', display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}
          >
            + Bookmark Current
          </button>
        </div>
      )}

      {/* Filter Bar — shared, but list-only filters hidden in traces mode */}
      {viewMode !== 'conversations' && (
        <div className="filter-bar">
          <form onSubmit={handleSearch} style={{ flex: 1, minWidth: 200 }}>
            <div className="input-group">
              <Search size={16} className="input-icon" />
              <input
                className="input"
                type="text"
                placeholder="Search requests..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </div>
          </form>

          <CustomSelect
            value={modelFilter}
            onChange={(val) => {
              setModelFilter(val);
              setPage(1);
            }}
            options={modelOptions}
            placeholder="All Models"
            style={{ width: 200 }}
          />

          <CustomSelect
            value={statusFilter}
            onChange={(val) => {
              setStatusFilter(val);
              setPage(1);
            }}
            options={statusOptions}
            placeholder="All Status"
            style={{ width: 140 }}
          />

          {viewMode === 'list' && (
            <CustomSelect
              value={feedbackFilter}
              onChange={(val) => {
                setFeedbackFilter(val);
                setPage(1);
              }}
              options={feedbackOptions}
              placeholder="All Feedback"
              style={{ width: 150 }}
            />
          )}

          {hasFilters && (
            <button className="btn btn-ghost btn-sm" onClick={clearFilters}>
              <X size={14} />
              Clear
            </button>
          )}
        </div>
      )}

      {/* View Content */}
      {viewMode === 'list' && (
        error ? (
          <div className="glass-card-static" style={{ padding: 32, textAlign: 'center' }}>
            <p style={{ color: 'var(--accent-rose)' }}>Error loading logs: {error}</p>
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={logs}
            loading={loading}
            emptyMessage="No logs found"
            emptyDescription="Try adjusting your filters or make some API calls to see logs here."
            onRowClick={(row) => navigate(`/logs/${row.id}`)}
            sortBy={sortBy}
            sortOrder={sortOrder}
            onSort={handleSort}
            pagination={{
              page,
              totalPages,
              onPageChange: setPage,
            }}
          />
        )
      )}

      {viewMode === 'traces' && (
        <TracesView
          modelFilter={modelFilter}
          statusFilter={statusFilter}
          dateRange={dateRange}
          focusTraceId={focusTraceId}
        />
      )}

      {viewMode === 'conversations' && (
        <ConversationsView
          conversationId={selectedConversationId}
          onSelectConversation={handleSelectConversation}
        />
      )}

      {/* Import Modal */}
      <ImportModal
        isOpen={showImportModal}
        onClose={() => {
          setShowImportModal(false);
          refetch();
        }}
      />

      {/* Save Filter Modal */}
      {showSaveFilterModal && (
        <div className="modal-overlay" onClick={() => setShowSaveFilterModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              Bookmark Current Filters
            </h3>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: 20 }}>
              Give a name to your active filters configuration so you can access it in one click later.
            </p>
            <form onSubmit={(e) => { e.preventDefault(); saveCurrentFilter(newFilterName); }}>
              <input
                autoFocus
                className="input"
                type="text"
                placeholder="e.g. Failed Llama-3.1 Requests"
                value={newFilterName}
                onChange={(e) => setNewFilterName(e.target.value)}
                style={{ marginBottom: 16, width: '100%' }}
              />
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowSaveFilterModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={!newFilterName.trim()} style={{ background: 'var(--accent-purple)', borderColor: 'var(--accent-purple)' }}>
                  Save Bookmark
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function ImportModal({ isOpen, onClose }) {
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState('idle'); // 'idle' | 'reading' | 'uploading' | 'success' | 'error'
  const [progressText, setProgressText] = useState('');
  const [resultMsg, setResultMsg] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  if (!isOpen) return null;

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
      setStatus('idle');
      setErrorMsg('');
      setResultMsg(null);
    }
  };

  const handleUpload = () => {
    if (!file) {
      setErrorMsg('Please select a file to import.');
      return;
    }

    setStatus('reading');
    setProgressText('Reading file...');

    const reader = new FileReader();

    reader.onload = async (e) => {
      const content = e.target.result;
      let logs = [];

      try {
        setProgressText('Parsing file data...');
        if (file.name.endsWith('.jsonl')) {
          logs = content
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
            .map((line) => JSON.parse(line));
        } else {
          // Default to standard JSON
          const parsed = JSON.parse(content);
          logs = Array.isArray(parsed) ? parsed : [parsed];
        }

        if (logs.length === 0) {
          throw new Error('No valid log records found in file');
        }

        setStatus('uploading');
        setProgressText(`Uploading ${logs.length} logs to database...`);

        const response = await fetchApi('/logs/import', {
          method: 'POST',
          body: { logs },
        });

        if (response.error) {
          throw new Error(response.error.message || 'Import failed');
        }

        setStatus('success');
        setResultMsg({
          importedCount: response.importedCount,
          failedCount: response.failedCount,
          errors: response.errors || [],
        });
      } catch (err) {
        setStatus('error');
        setErrorMsg(err.message || 'An error occurred during import');
      }
    };

    reader.onerror = () => {
      setStatus('error');
      setErrorMsg('Failed to read file from disk.');
    };

    reader.readAsText(file);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 500 }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Upload size={20} style={{ color: 'var(--accent-purple)' }} />
          Import Logs Dataset
        </h3>
        <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: 20 }}>
          Upload a <strong>JSON</strong> or <strong>JSONL</strong> file exported from InfraSight or other models pipelines to import logs into the SQLite database.
        </p>

        {status === 'idle' || status === 'error' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ border: '2px dashed var(--border)', borderRadius: 8, padding: '24px 16px', textAlign: 'center', background: 'rgba(255,255,255,0.01)' }}>
              <input
                type="file"
                accept=".json,.jsonl"
                onChange={handleFileChange}
                style={{ display: 'none' }}
                id="import-file-input"
              />
              <label htmlFor="import-file-input" style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <Database size={32} style={{ color: 'var(--text-muted)' }} />
                <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--accent-indigo)' }}>
                  Click to select file
                </span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                  Accepts .json or .jsonl up to 50MB
                </span>
              </label>
              {file && (
                <div style={{ marginTop: 16, fontSize: '0.8125rem', background: 'rgba(255,255,255,0.02)', padding: '6px 12px', borderRadius: 4, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{file.name}</span>
                  <span style={{ color: 'var(--text-dim)' }}>({(file.size / 1024).toFixed(1)} KB)</span>
                </div>
              )}
            </div>

            {errorMsg && (
              <div style={{
                padding: '10px 14px',
                background: 'rgba(244, 63, 94, 0.1)',
                border: '1px solid rgba(244, 63, 94, 0.2)',
                borderRadius: 6,
                fontSize: '0.8125rem',
                color: 'var(--accent-rose)',
                display: 'flex',
                alignItems: 'center',
                gap: 8
              }}>
                <AlertCircle size={14} />
                <span>{errorMsg}</span>
              </div>
            )}

            <div className="modal-actions" style={{ marginTop: 12 }}>
              <button className="btn btn-secondary" onClick={onClose}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleUpload} disabled={!file} style={{ background: 'var(--accent-purple)', borderColor: 'var(--accent-purple)' }}>
                Upload & Import
              </button>
            </div>
          </div>
        ) : status === 'reading' || status === 'uploading' ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '24px 0', textAlign: 'center' }}>
            <RefreshCw size={36} className="animate-spin" style={{ color: 'var(--accent-purple)' }} />
            <div>
              <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>Importing in progress...</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: 4 }}>{progressText}</div>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{
              background: 'rgba(16, 185, 129, 0.1)',
              border: '1px solid rgba(16, 185, 129, 0.2)',
              borderRadius: 8,
              padding: 16,
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8
            }}>
              <CheckCircle2 size={36} style={{ color: 'var(--accent-emerald)' }} />
              <div>
                <h4 style={{ fontSize: '0.9rem', color: 'var(--text-primary)', margin: 0 }}>Import Completed!</h4>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                  Successfully imported <strong>{resultMsg?.importedCount || 0}</strong> logs.
                  {resultMsg?.failedCount > 0 && (
                    <span> Failed to import <strong>{resultMsg.failedCount}</strong> rows due to constraint errors.</span>
                  )}
                </p>
              </div>
            </div>

            {resultMsg?.errors && resultMsg.errors.length > 0 && (
              <div style={{ maxHeight: 150, overflowY: 'auto', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)', padding: '10px 14px', borderRadius: 6, fontSize: '0.72rem', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                <div style={{ fontWeight: 600, color: 'var(--accent-rose)', marginBottom: 6 }}>Import Errors Sample:</div>
                {resultMsg.errors.map((e, idx) => (
                  <div key={idx} style={{ marginBottom: 4 }}>• {e}</div>
                ))}
              </div>
            )}

            <div className="modal-actions" style={{ marginTop: 12 }}>
              <button className="btn btn-primary" onClick={onClose} style={{ background: 'var(--accent-emerald)', borderColor: 'var(--accent-emerald)', width: '100%' }}>
                Close & Refresh Logs
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
