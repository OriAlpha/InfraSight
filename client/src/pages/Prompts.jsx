import { useState, useMemo, useEffect } from 'react';
import { useApi, fetchApi } from '../hooks/useApi';
import { extractVariables } from '../utils/extractVariables';
import { parseDate } from '../utils/date';
import {
  Sparkles,
  Save,
  Plus,
  History,
  ChevronRight,
  Trash2,
} from 'lucide-react';
import Badge from '../components/ui/Badge';

export default function Prompts() {
  const { data: promptsData, loading: loadingPrompts, refetch: refetchPrompts } = useApi('/prompts');

  const prompts = useMemo(() => {
    return promptsData?.data || [];
  }, [promptsData]);

  return (
    <div className="animate-slide-up">
      <div className="page-header">
        <h2>Prompt Registry</h2>
        <p>Version-control and manage prompt templates for production</p>
      </div>

      <RegistryTab prompts={prompts} loading={loadingPrompts} refetch={refetchPrompts} />
    </div>
  );
}

// ==========================================
// REGISTRY TAB
// ==========================================
function RegistryTab({ prompts, loading, refetch }) {
  const [selectedPrompt, setSelectedPrompt] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [userTemplate, setUserTemplate] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDeleteName, setConfirmDeleteName] = useState(null);
  const [statusMsg, setStatusMsg] = useState(null);
  const [compareMode, setCompareMode] = useState(false);

  const { data: historyData, refetch: refetchHistory } = useApi(
    selectedPrompt ? `/prompts/${encodeURIComponent(selectedPrompt.name)}/history` : null
  );

  const history = useMemo(() => {
    return historyData?.data || [];
  }, [historyData]);

  // Extract variables on change
  const variables = useMemo(() => {
    const combinedText = `${systemPrompt}\n${userTemplate}`;
    return extractVariables(combinedText);
  }, [systemPrompt, userTemplate]);

  const handleSelectPrompt = (prompt) => {
    setSelectedPrompt(prompt);
    setShowCreate(false);
    setConfirmDeleteName(null);
    setCompareMode(false);
  };

  const handleConfirmDelete = async (promptName) => {
    try {
      await fetchApi(`/prompts/${encodeURIComponent(promptName)}`, { method: 'DELETE' });
      setConfirmDeleteName(null);
      setSelectedPrompt(null);
      refetch();
      setStatusMsg({ type: 'success', text: 'Prompt template deleted.' });
      setTimeout(() => setStatusMsg(null), 3000);
    } catch (err) {
      setStatusMsg({ type: 'error', text: 'Failed to delete: ' + err.message });
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;

    setSaving(true);
    try {
      await fetchApi('/prompts', {
        method: 'POST',
        body: {
          name: name.trim(),
          system_prompt: systemPrompt,
          user_template: userTemplate,
          variables,
        },
      });
      setName('');
      setSystemPrompt('');
      setUserTemplate('');
      setShowCreate(false);
      refetch();
      if (selectedPrompt && selectedPrompt.name === name.trim()) {
        refetchHistory();
      }
      setStatusMsg({ type: 'success', text: 'Prompt template saved!' });
      setTimeout(() => setStatusMsg(null), 3000);
    } catch (err) {
      setStatusMsg({ type: 'error', text: 'Failed to save: ' + err.message });
    }
    setSaving(false);
  };

  const handleNewVersion = (prompt) => {
    setName(prompt.name);
    setSystemPrompt(prompt.system_prompt || '');
    setUserTemplate(prompt.user_template || '');
    setShowCreate(true);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {statusMsg && (
        <div style={{
          padding: '10px 16px',
          borderRadius: 8,
          fontSize: '0.8125rem',
          fontWeight: 500,
          background: statusMsg.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(244, 63, 94, 0.15)',
          color: statusMsg.type === 'success' ? 'var(--accent-emerald)' : 'var(--accent-rose)',
          border: `1px solid ${statusMsg.type === 'success' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(244, 63, 94, 0.3)'}`,
        }}>
          {statusMsg.text}
        </div>
      )}
    <div className="prompts-page-grid">
      {/* Sidebar List */}
      <div className="glass-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h4 style={{ margin: 0, fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
            Templates ({prompts.length})
          </h4>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setShowCreate(true);
              setSelectedPrompt(null);
              setName('');
              setSystemPrompt('');
              setUserTemplate('');
              setConfirmDeleteName(null);
            }}
            style={{ padding: 6, borderRadius: '50%' }}
          >
            <Plus size={16} />
          </button>
        </div>

        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skeleton" style={{ height: 48, borderRadius: 8 }} />
            ))}
          </div>
        ) : prompts.length === 0 ? (
          <div className="empty-state" style={{ padding: '24px 8px' }}>
            <p style={{ fontSize: '0.75rem' }}>No templates saved yet.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' }}>
            {prompts.map((p) => (
              <div
                key={p.name}
                className={`sidebar-nav-item ${selectedPrompt?.name === p.name && !showCreate ? 'active' : ''}`}
                onClick={() => handleSelectPrompt(p)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 12px',
                  borderRadius: 8,
                  fontSize: '0.8125rem',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
                  <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{p.name}</span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Created v{p.version}
                  </span>
                </div>
                <ChevronRight size={14} style={{ color: 'var(--text-muted)' }} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Detail or Create Form */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {showCreate ? (
          <form className="glass-card" onSubmit={handleSave} style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
            <h3 style={{ margin: 0, fontSize: '1.125rem' }}>
              {selectedPrompt ? `New Version for: ${name}` : 'Create Prompt Template'}
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                Template Name
              </label>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. customer_support_replier"
                disabled={!!selectedPrompt || saving}
                required
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                System Prompt (Context & Behavior)
              </label>
              <textarea
                className="input"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="You are a helpful customer support agent..."
                rows={5}
                style={{ fontFamily: 'inherit', resize: 'vertical' }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                User Prompt Template
              </label>
              <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Use <code>{"{{variable_name}}"}</code> to define variables. They will auto-populate in the playground.
              </p>
              <textarea
                className="input"
                value={userTemplate}
                onChange={(e) => setUserTemplate(e.target.value)}
                placeholder="Hello {{user_name}}, how can I help you today with {{issue_description}}?"
                rows={5}
                style={{ fontFamily: 'inherit', resize: 'vertical' }}
                required
              />
            </div>

            {variables.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  Auto-Detected Variables
                </span>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {variables.map((v) => (
                    <Badge key={v} variant="info">
                      {v}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 10 }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowCreate(false)}
                disabled={saving}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                <Save size={16} style={{ marginRight: 6 }} />
                {saving ? 'Saving...' : 'Save Template'}
              </button>
            </div>
          </form>
        ) : selectedPrompt ? (
          <div className="glass-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
              <div>
                <h3 style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  {selectedPrompt.name}
                  <Badge variant="info">v{selectedPrompt.version}</Badge>
                </h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Latest updated on {parseDate(selectedPrompt.created_at).toLocaleString()}
                </p>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                {confirmDeleteName === selectedPrompt.name ? (
                  <>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => handleConfirmDelete(selectedPrompt.name)}
                      style={{
                        backgroundColor: 'var(--accent-rose)',
                        color: 'white',
                        border: 'none',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <Trash2 size={14} />
                      Confirm Delete
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => setConfirmDeleteName(null)}
                    >
                      Cancel
                    </button>
                  </>
                ) : (() => {
                  const isLatest = history[0] && selectedPrompt.version === history[0].version;
                  return (
                    <>
                      {history.length > 1 && !isLatest && (
                        <button
                          type="button"
                          className={`btn ${compareMode ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                          onClick={() => setCompareMode(!compareMode)}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                        >
                          {compareMode ? 'Plain View' : 'Compare with Active'}
                        </button>
                      )}
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => setConfirmDeleteName(selectedPrompt.name)}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                        }}
                      >
                        <Trash2 size={14} />
                        Delete
                      </button>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => handleNewVersion(selectedPrompt)}
                      >
                        <Plus size={14} style={{ marginRight: 6 }} />
                        New Version
                      </button>
                    </>
                  );
                })()}
              </div>
            </div>

            {compareMode && history[0] ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 8 }}>
                    System Instructions Diff (Comparing v{selectedPrompt.version} with Active v{history[0].version})
                  </label>
                  <DiffViewer oldStr={selectedPrompt.system_prompt} newStr={history[0].system_prompt} />
                </div>
                <div>
                  <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 8 }}>
                    User Message Template Diff (Comparing v{selectedPrompt.version} with Active v{history[0].version})
                  </label>
                  <DiffViewer oldStr={selectedPrompt.user_template} newStr={history[0].user_template} />
                </div>
              </div>
            ) : (
              <>
                {selectedPrompt.system_prompt && (
                  <div>
                    <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 8 }}>
                      System Instructions
                    </label>
                    <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', padding: 12, borderRadius: 8, fontSize: '0.875rem', whiteSpace: 'pre-wrap' }}>
                      {selectedPrompt.system_prompt}
                    </div>
                  </div>
                )}

                <div>
                  <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 8 }}>
                    User Message Template
                  </label>
                  <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', padding: 12, borderRadius: 8, fontSize: '0.875rem', whiteSpace: 'pre-wrap' }}>
                    {selectedPrompt.user_template}
                  </div>
                </div>
              </>
            )}

            {history.length > 1 && (
              <div>
                <h4 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6, margin: '0 0 12px 0' }}>
                  <History size={16} />
                  Version History
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {history.map((h) => (
                    <button
                      key={h.id}
                      type="button"
                      onClick={() => setSelectedPrompt(h)}
                      className={`version-history-item ${selectedPrompt.version === h.version ? 'active' : ''}`}
                    >
                      <span style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        v{h.version}
                        {selectedPrompt.version === h.version && (
                          <Badge variant="info" style={{ fontSize: '0.65rem', padding: '2px 6px' }}>
                            Viewing
                          </Badge>
                        )}
                      </span>
                      <span style={{ color: 'var(--text-muted)' }}>
                        {parseDate(h.created_at).toLocaleDateString()}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="glass-card" style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
            <Sparkles size={40} style={{ margin: '0 auto 16px auto', color: 'var(--accent-blue)', opacity: 0.5 }} />
            <h3>Select a template or create one</h3>
            <p>Define dynamic templates to use in playground testing and version comparisons.</p>
            <button
              className="btn btn-primary"
              onClick={() => {
                setShowCreate(true);
                setSelectedPrompt(null);
                setName('');
                setSystemPrompt('');
                setUserTemplate('');
              }}
              style={{ marginTop: 12 }}
            >
              <Plus size={16} style={{ marginRight: 6 }} />
              Create Template
            </button>
          </div>
        )}
      </div>
    </div>
    </div>
  );
}

function diffLines(oldStr, newStr) {
  const oldLines = (oldStr || '').split('\n');
  const newLines = (newStr || '').split('\n');

  const dp = Array.from({ length: oldLines.length + 1 }, () => Array(newLines.length + 1).fill(0));

  for (let i = 1; i <= oldLines.length; i++) {
    for (let j = 1; j <= newLines.length; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const diffResult = [];
  let i = oldLines.length;
  let j = newLines.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      diffResult.unshift({ type: 'unchanged', text: oldLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      diffResult.unshift({ type: 'added', text: newLines[j - 1] });
      j--;
    } else {
      diffResult.unshift({ type: 'removed', text: oldLines[i - 1] });
      i--;
    }
  }

  return diffResult;
}

function DiffViewer({ oldStr, newStr }) {
  const diffs = useMemo(() => diffLines(oldStr, newStr), [oldStr, newStr]);

  return (
    <div style={{
      background: 'rgba(0,0,0,0.3)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      padding: 12,
      fontFamily: 'var(--font-mono, monospace)',
      fontSize: '0.85rem',
      lineHeight: 1.6,
      overflowX: 'auto',
      whiteSpace: 'pre-wrap',
    }}>
      {diffs.map((line, idx) => {
        let style = { display: 'block', padding: '1px 8px', borderRadius: 4, margin: '1px 0' };
        let prefix = ' ';
        if (line.type === 'added') {
          style.backgroundColor = 'rgba(16, 185, 129, 0.1)';
          style.color = '#34d399';
          prefix = '+';
        } else if (line.type === 'removed') {
          style.backgroundColor = 'rgba(244, 63, 94, 0.1)';
          style.color = '#f87171';
          prefix = '-';
        } else {
          style.color = 'var(--text-secondary)';
        }
        return (
          <div key={idx} style={style}>
            <span style={{ userSelect: 'none', marginRight: 8, opacity: 0.5 }}>{prefix}</span>
            {line.text}
          </div>
        );
      })}
    </div>
  );
}
