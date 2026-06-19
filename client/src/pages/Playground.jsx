import { useState, useMemo, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useApi, fetchApi } from '../hooks/useApi';
import { extractVariables } from '../utils/extractVariables';
import ChatBubble from '../components/ui/ChatBubble';
import CustomSelect from '../components/ui/CustomSelect';
import {
  Sparkles,
  Play,
  Split,
  AlertCircle,
  Code,
  Zap,
  ExternalLink,
  MessageSquare,
  Send,
  Trash2,
  Copy,
} from 'lucide-react';

export default function Playground() {
  const { data: promptsData } = useApi('/prompts');
  const { data: modelsData } = useApi('/models');

  const prompts = useMemo(() => {
    return promptsData?.data || [];
  }, [promptsData]);

  // Mode tab state
  const [activeTab, setActiveTab] = useState('template'); // 'template' | 'chat'

  // --- Template Sandbox State ---
  const [selectedTemplateName, setSelectedTemplateName] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('You are an expert customer support agent for a SaaS platform called CloudFlow. Be polite, professional, and clear.');
  const [userTemplate, setUserTemplate] = useState("Hello! I am having issues with my subscription. My account email is {{email}} and I am seeing an error that says '{{error_message}}'. Can you help me resolve this?");
  const [variables, setVariables] = useState({
    email: 'john.doe@example.com',
    error_message: 'Payment failed: Card declined'
  });

  // Runner configs
  const [modelA, setModelA] = useState('meta-llama/Meta-Llama-3.1-8B-Instruct');
  const [tempA, setTempA] = useState(0.7);
  const [runnerAOutput, setRunnerAOutput] = useState('');
  const [runnerAMetrics, setRunnerAMetrics] = useState(null);
  const [runnerALogId, setRunnerALogId] = useState(null);
  const [runningA, setRunningA] = useState(false);
  const [errorA, setErrorA] = useState('');

  // Runner B (for split comparison)
  const [enableSplit, setEnableSplit] = useState(false);
  const [modelB, setModelB] = useState('meta-llama/Meta-Llama-3.1-70B-Instruct');
  const [tempB, setTempB] = useState(0.7);
  const [runnerBOutput, setRunnerBOutput] = useState('');
  const [runnerBMetrics, setRunnerBMetrics] = useState(null);
  const [runnerBLogId, setRunnerBLogId] = useState(null);
  const [runningB, setRunningB] = useState(false);
  const [errorB, setErrorB] = useState('');

  // --- Chat Sandbox State ---
  const [chatModel, setChatModel] = useState('meta-llama/Meta-Llama-3.1-8B-Instruct');
  const [chatTemp, setChatTemp] = useState(0.7);
  const [chatSystemPrompt, setChatSystemPrompt] = useState('You are a helpful and clear AI assistant.');
  const [chatConversationId, setChatConversationId] = useState(() => crypto.randomUUID());
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatRunning, setChatRunning] = useState(false);
  const [chatError, setChatError] = useState('');
  const [chatLastMetrics, setChatLastMetrics] = useState(null);

  const chatBottomRef = useRef(null);
  const chatInputRef = useRef(null);

  const models = useMemo(() => {
    if (!modelsData) return [];
    return Array.isArray(modelsData) ? modelsData : modelsData.data || [];
  }, [modelsData]);

  const modelOptions = useMemo(() => {
    return models.map((m) => ({ value: m.model_id || m.id, label: m.model_id || m.id }));
  }, [models]);

  const templateOptions = useMemo(() => {
    return [
      { value: '', label: '-- Manual Entry --' },
      ...prompts.map((p) => ({ value: p.name, label: `${p.name} (v${p.version})` }))
    ];
  }, [prompts]);

  // Check for imported log from detail page to run in playground
  useEffect(() => {
    try {
      const importedStr = localStorage.getItem('infrasight_playground_import');
      if (importedStr) {
        const imported = JSON.parse(importedStr);
        if (imported.mode === 'chat') {
          setActiveTab('chat');
          if (imported.model) setChatModel(imported.model);
          if (imported.temperature !== undefined) setChatTemp(imported.temperature);
          if (imported.systemPrompt !== undefined) setChatSystemPrompt(imported.systemPrompt);
          if (imported.messages) setChatMessages(imported.messages);
        }
        localStorage.removeItem('infrasight_playground_import');
      }
    } catch (err) {
      console.error('Failed to import log into playground:', err);
    }
  }, []);

  // Sync default models once loaded
  useEffect(() => {
    if (models.length > 0) {
      const defaultModel = models[0].model_id || models[0].id;
      if (defaultModel) {
        // Only set if not already selected to avoid overwriting user edits
        if (!modelA) setModelA(defaultModel);
        if (!modelB) setModelB(defaultModel);
        if (!chatModel) setChatModel(defaultModel);
      }
    }
  }, [models, modelA, modelB, chatModel]);

  // Load selected template
  useEffect(() => {
    if (!selectedTemplateName) return;
    const template = prompts.find((p) => p.name === selectedTemplateName);
    if (template) {
      setSystemPrompt(template.system_prompt || '');
      setUserTemplate(template.user_template || '');
      
      // Load initial variables
      const vars = extractVariables(`${template.system_prompt}\n${template.user_template}`);
      const newVars = {};
      vars.forEach((v) => {
        newVars[v] = variables[v] || '';
      });
      setVariables(newVars);
    }
  }, [selectedTemplateName, prompts]);

  // Extract variables dynamically on manual typing
  const variableNames = useMemo(() => {
    return extractVariables(`${systemPrompt}\n${userTemplate}`);
  }, [systemPrompt, userTemplate]);

  // Sync variables state
  useEffect(() => {
    setVariables((prev) => {
      const nextVars = {};
      variableNames.forEach((v) => {
        nextVars[v] = prev[v] || '';
      });
      return nextVars;
    });
  }, [variableNames]);

  // Scroll to bottom of chat
  useEffect(() => {
    if (activeTab === 'chat') {
      chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages, chatRunning, activeTab]);

  // Focus input field when assistant finishes responding or when switching to chat tab
  useEffect(() => {
    if (!chatRunning && activeTab === 'chat') {
      chatInputRef.current?.focus();
    }
  }, [chatRunning, activeTab]);

  const handleVarChange = (name, val) => {
    setVariables((prev) => ({ ...prev, [name]: val }));
  };

  // --- Template Runner Execution ---
  const executeRunner = async (runnerId) => {
    const isA = runnerId === 'A';
    const setRunning = isA ? setRunningA : setRunningB;
    const setOutput = isA ? setRunnerAOutput : setRunnerBOutput;
    const setMetrics = isA ? setRunnerAMetrics : setRunnerBMetrics;
    const setLogId = isA ? setRunnerALogId : setRunnerBLogId;
    const setError = isA ? setErrorA : setErrorB;
    const model = isA ? modelA : modelB;
    const temp = isA ? tempA : tempB;

    setRunning(true);
    setError('');
    setOutput('');
    setMetrics(null);
    setLogId(null);

    try {
      const response = await fetchApi('/prompts/playground', {
        method: 'POST',
        body: {
          model,
          temperature: Number(temp) || 0.7,
          system_prompt: systemPrompt,
          user_template: userTemplate,
          variables,
        },
      });

      if (response.error) {
        setError(response.error.message || 'Execution failed');
      } else {
        setOutput(response.output);
        setMetrics(response.metrics);
        if (response.log_id) setLogId(response.log_id);
      }
    } catch (err) {
      setError(err.message);
    }
    setRunning(false);
  };

  const handleRunAll = () => {
    executeRunner('A');
    if (enableSplit) {
      executeRunner('B');
    }
  };

  // --- Chat Runner Execution ---
  const executeChatTurn = async (e) => {
    if (e) e.preventDefault();
    if (!chatInput.trim() || chatRunning) return;

    const userText = chatInput.trim();
    setChatInput('');
    setChatError('');
    setChatRunning(true);

    const newMessages = [...chatMessages, { role: 'user', content: userText }];
    setChatMessages(newMessages);

    // Prepare API history block
    const apiMessages = [];
    if (chatSystemPrompt.trim()) {
      apiMessages.push({ role: 'system', content: chatSystemPrompt.trim() });
    }
    apiMessages.push(...newMessages.map((m) => ({ role: m.role, content: m.content })));

    try {
      const response = await fetchApi('/prompts/playground', {
        method: 'POST',
        body: {
          model: chatModel,
          temperature: Number(chatTemp) || 0.7,
          messages: apiMessages,
          conversation_id: chatConversationId,
        },
      });

      if (response.error) {
        setChatError(response.error.message || 'Execution failed');
      } else {
        const assistantText = response.output;
        const metrics = response.metrics;
        setChatMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: assistantText,
            metrics: metrics,
            log_id: response.log_id,
          },
        ]);
        setChatLastMetrics(metrics);
      }
    } catch (err) {
      setChatError(err.message);
    }
    setChatRunning(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      executeChatTurn();
    }
  };

  const handleNewSession = () => {
    setChatConversationId(crypto.randomUUID());
    setChatMessages([]);
    setChatInput('');
    setChatError('');
    setChatLastMetrics(null);
  };

  const chatAggregate = useMemo(() => {
    let totalCost = 0;
    let totalTokens = 0;
    let turnCount = 0;
    chatMessages.forEach((m) => {
      if (m.metrics) {
        totalCost += m.metrics.cost || 0;
        totalTokens += m.metrics.total_tokens || 0;
        turnCount += 1;
      }
    });
    return { totalCost, totalTokens, turnCount };
  }, [chatMessages]);

  return (
    <div className="animate-slide-up">
      <div className="page-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h2>Playground Sandbox</h2>
            <p>Experiment with prompts and compare model executions side-by-side</p>
          </div>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: 4, background: 'rgba(255,255,255,0.03)', padding: 4, borderRadius: 8, border: '1px solid var(--border)' }}>
            <button
              className={`btn btn-sm ${activeTab === 'template' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setActiveTab('template')}
              style={{ fontSize: '0.8125rem', padding: '6px 12px' }}
            >
              <Code size={14} style={{ marginRight: 6 }} />
              Template Sandbox
            </button>
            <button
              className={`btn btn-sm ${activeTab === 'chat' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setActiveTab('chat')}
              style={{ fontSize: '0.8125rem', padding: '6px 12px' }}
            >
              <MessageSquare size={14} style={{ marginRight: 6 }} />
              Chat Sandbox
            </button>
          </div>
        </div>
      </div>

      {activeTab === 'template' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Configuration Header */}
          <div className="glass-card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
              <h4 style={{ margin: 0, fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                Sandbox Configuration
              </h4>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <button
                  className={`btn btn-sm ${enableSplit ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setEnableSplit(!enableSplit)}
                >
                  <Split size={14} style={{ marginRight: 6 }} />
                  Compare Split Screen
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleRunAll}
                  disabled={runningA || runningB}
                >
                  <Play size={14} style={{ marginRight: 6 }} />
                  {runningA || runningB ? 'Executing...' : 'Run Benchmarks'}
                </button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  Load From Template
                </label>
                <CustomSelect
                  value={selectedTemplateName}
                  onChange={(val) => setSelectedTemplateName(val)}
                  options={templateOptions}
                  style={{ width: '100%' }}
                  size="sm"
                />
              </div>
            </div>
          </div>

          {/* Editor & Variables Split Grid */}
          <div className="playground-templates-grid">
            {/* Templates Panel */}
            <div className="glass-card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  System instructions
                </label>
                <textarea
                  className="input text-sm"
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder="You are a helpful assistant..."
                  rows={3}
                  style={{ fontFamily: 'inherit', resize: 'vertical' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  User Prompt Template
                </label>
                <textarea
                  className="input text-sm"
                  value={userTemplate}
                  onChange={(e) => setUserTemplate(e.target.value)}
                  placeholder="Write user instructions here. Use {{variable}} format."
                  rows={4}
                  style={{ fontFamily: 'inherit', resize: 'vertical' }}
                />
              </div>
            </div>

            {/* Variables panel */}
            <div className="glass-card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <h4 style={{ margin: 0, fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                Render Variables
              </h4>
              {variableNames.length === 0 ? (
                <div className="empty-state" style={{ padding: 16 }}>
                  <p style={{ fontSize: '0.75rem' }}>No variables detected. Type double curly braces in user prompt template to add some.</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {variableNames.map((name) => (
                    <div key={name} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <label style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-muted)' }}>
                        {name}
                      </label>
                      <input
                        className="input input-sm"
                        value={variables[name] || ''}
                        onChange={(e) => handleVarChange(name, e.target.value)}
                        placeholder="Enter value..."
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Runner Split Comparison Screens */}
          <div className="playground-split-grid" style={{ '--split-cols': enableSplit ? '1fr 1fr' : '1fr' }}>
            {/* Runner A */}
            <div className="glass-card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--accent-blue)' }}>
                  {enableSplit ? 'CONFIGURATION A' : 'RUN CONFIGURATION'}
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: 12 }}>
                <CustomSelect
                  value={modelA}
                  onChange={(val) => setModelA(val)}
                  options={modelOptions}
                  style={{ width: '100%' }}
                  size="sm"
                />
                <input
                  className="input input-sm"
                  type="number"
                  step="0.1"
                  min="0"
                  max="2"
                  value={tempA}
                  onChange={(e) => setTempA(Number(e.target.value) || 0)}
                  placeholder="Temp"
                  title="Temperature"
                />
              </div>

              {runnerAMetrics && <MetricsStrip metrics={runnerAMetrics} />}

              <div
                style={{
                  minHeight: 180,
                  background: 'rgba(0,0,0,0.2)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: 12,
                  fontSize: '0.875rem',
                  whiteSpace: 'pre-wrap',
                  color: errorA ? 'var(--accent-rose)' : 'var(--text-primary)',
                  fontFamily: runnerAOutput ? 'inherit' : 'monospace',
                }}
              >
                {runningA && <div className="skeleton" style={{ width: '100%', height: 100 }} />}
                {errorA && <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}><AlertCircle size={14} /> {errorA}</div>}
                {!runningA && !errorA && (runnerAOutput || 'Output response will appear here...')}
              </div>
              {runnerALogId && (
                <Link to={`/logs/${runnerALogId}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', color: 'var(--accent-blue)', textDecoration: 'none', marginTop: 4 }}>
                  <ExternalLink size={12} /> View full evaluation & log details
                </Link>
              )}
            </div>

            {/* Runner B (Split) */}
            {enableSplit && (
              <div className="glass-card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--accent-purple)' }}>
                    CONFIGURATION B
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: 12 }}>
                  <CustomSelect
                    value={modelB}
                    onChange={(val) => setModelB(val)}
                    options={modelOptions}
                    style={{ width: '100%' }}
                    size="sm"
                  />
                  <input
                    className="input input-sm"
                    type="number"
                    step="0.1"
                    min="0"
                    max="2"
                    value={tempB}
                    onChange={(e) => setTempB(Number(e.target.value) || 0)}
                    placeholder="Temp"
                    title="Temperature"
                  />
                </div>

                {runnerBMetrics && <MetricsStrip metrics={runnerBMetrics} />}

                <div
                  style={{
                    minHeight: 180,
                    background: 'rgba(0,0,0,0.2)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: 12,
                    fontSize: '0.875rem',
                    whiteSpace: 'pre-wrap',
                    color: errorB ? 'var(--accent-rose)' : 'var(--text-primary)',
                    fontFamily: runnerBOutput ? 'inherit' : 'monospace',
                  }}
                >
                  {runningB && <div className="skeleton" style={{ width: '100%', height: 100 }} />}
                  {errorB && <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}><AlertCircle size={14} /> {errorB}</div>}
                  {!runningB && !errorB && (runnerBOutput || 'Output response will appear here...')}
                </div>
                {runnerBLogId && (
                  <Link to={`/logs/${runnerBLogId}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', color: 'var(--accent-purple)', textDecoration: 'none', marginTop: 4 }}>
                    <ExternalLink size={12} /> View full evaluation & log details
                  </Link>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="playground-chat-grid">
          {/* Chat Pane */}
          <div className="glass-card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16, height: 600 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
              <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <MessageSquare size={16} style={{ color: 'var(--accent-blue)' }} />
                Interactive Chat Session
              </span>
              <button
                className="btn btn-sm btn-ghost"
                onClick={handleNewSession}
                title="Reset conversation session"
                style={{ color: 'var(--accent-rose)', display: 'flex', alignItems: 'center', gap: 4 }}
              >
                <Trash2 size={14} /> Reset
              </button>
            </div>

            {/* Chat message bubbles */}
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12, paddingRight: 8 }}>
              {chatSystemPrompt.trim() && (
                <div style={{
                  padding: '10px 14px',
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px dashed var(--border)',
                  borderRadius: 6,
                  fontSize: '0.75rem',
                  color: 'var(--text-dim)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4
                }}>
                  <strong style={{ color: 'var(--text-muted)' }}>⚙️ System Instructions:</strong>
                  <span>{chatSystemPrompt}</span>
                </div>
              )}

              {chatMessages.length === 0 ? (
                <div className="empty-state" style={{ margin: 'auto', padding: 32 }}>
                  <MessageSquare size={36} className="empty-icon" />
                  <h4>Start a new chat</h4>
                  <p>Send a message below to test multi-turn conversations.</p>
                </div>
              ) : (
                chatMessages.map((msg, index) => (
                  <ChatBubble
                    key={index}
                    role={msg.role}
                    content={msg.content}
                    tokens={msg.metrics?.completion_tokens}
                    cost={msg.metrics?.cost}
                  />
                ))
              )}

              {chatRunning && (
                <div style={{
                  alignSelf: 'flex-start',
                  padding: '12px 16px',
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid var(--border)',
                  borderRadius: '12px 12px 12px 0px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8
                }}>
                  <div className="skeleton" style={{ width: 8, height: 8, borderRadius: '50%', animation: 'pulse 1.2s infinite' }} />
                  <div className="skeleton" style={{ width: 8, height: 8, borderRadius: '50%', animation: 'pulse 1.2s infinite', animationDelay: '0.2s' }} />
                  <div className="skeleton" style={{ width: 8, height: 8, borderRadius: '50%', animation: 'pulse 1.2s infinite', animationDelay: '0.4s' }} />
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: 4 }}>Assistant is typing...</span>
                </div>
              )}

              {chatError && (
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
                  <span>Error: {chatError}</span>
                </div>
              )}

              <div ref={chatBottomRef} />
            </div>

            {/* Input Form */}
            <form onSubmit={executeChatTurn} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', borderTop: '1px solid var(--border)', paddingTop: 16 }}>
              <textarea
                ref={chatInputRef}
                className="input"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type your message here... (Press Enter to send)"
                rows={2}
                disabled={chatRunning}
                style={{
                  flex: 1,
                  fontFamily: 'inherit',
                  resize: 'none',
                  fontSize: '0.875rem',
                  padding: '10px 14px'
                }}
              />
              <button
                type="submit"
                className="btn btn-primary"
                disabled={chatRunning || !chatInput.trim()}
                style={{ height: 42, padding: '0 16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <Send size={16} />
              </button>
            </form>
          </div>

          {/* Config Sidebar */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div className="glass-card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <h4 style={{ margin: 0, fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                Session Configuration
              </h4>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                    Model
                  </label>
                  <CustomSelect
                    value={chatModel}
                    onChange={(val) => setChatModel(val)}
                    options={modelOptions}
                    style={{ width: '100%' }}
                    size="sm"
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                      Temperature
                    </label>
                    <span className="mono" style={{ fontSize: '0.75rem', color: 'var(--accent-primary)' }}>
                      {chatTemp}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.1"
                    value={chatTemp}
                    onChange={(e) => setChatTemp(Number(e.target.value))}
                    style={{ accentColor: 'var(--accent-primary)' }}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                    System Instructions
                  </label>
                  <textarea
                    className="input text-sm"
                    value={chatSystemPrompt}
                    onChange={(e) => setChatSystemPrompt(e.target.value)}
                    placeholder="Enter agent background instructions..."
                    rows={4}
                    style={{ fontFamily: 'inherit', resize: 'vertical' }}
                  />
                </div>
              </div>
            </div>

            <div className="glass-card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <h4 style={{ margin: 0, fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                Session Statistics
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: '0.8125rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-dim)' }}>Conversation turns:</span>
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{chatAggregate.turnCount}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-dim)' }}>Total Session Cost:</span>
                  <span style={{ fontWeight: 600, color: 'var(--accent-emerald)' }}>${chatAggregate.totalCost.toFixed(6)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-dim)' }}>Total Session Tokens:</span>
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{chatAggregate.totalTokens}</span>
                </div>
                {chatLastMetrics && (
                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 4 }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 8 }}>Last Turn Metrics:</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.75rem' }}>
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        <Zap size={12} style={{ color: 'var(--accent-amber)' }} />
                        <span>Latency: <strong style={{ color: 'var(--text-primary)' }}>{chatLastMetrics.latency_ms >= 1000 ? `${(chatLastMetrics.latency_ms / 1000).toFixed(2)}s` : `${chatLastMetrics.latency_ms}ms`}</strong></span>
                      </div>
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        <Sparkles size={12} style={{ color: 'var(--accent-emerald)' }} />
                        <span>TPS: <strong style={{ color: 'var(--text-primary)' }}>{chatLastMetrics.tokens_per_second} t/s</strong></span>
                      </div>
                    </div>
                  </div>
                )}
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 4 }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>Conversation ID:</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input
                      className="input input-sm mono"
                      value={chatConversationId}
                      readOnly
                      style={{ fontSize: '0.75rem', padding: '4px 8px', flex: 1, background: 'rgba(0,0,0,0.1)' }}
                    />
                    <button
                      type="button"
                      className="btn btn-sm btn-secondary"
                      onClick={() => {
                        navigator.clipboard.writeText(chatConversationId);
                      }}
                      title="Copy Conversation ID"
                      style={{ padding: '4px 8px' }}
                    >
                      <Copy size={12} />
                    </button>
                    {chatMessages.some(m => m.role === 'assistant') && (
                      <Link
                        to={`/conversations/${chatConversationId}`}
                        className="btn btn-sm btn-secondary"
                        title="View Logged Conversation Details"
                        style={{ padding: '4px 8px', display: 'inline-flex', alignItems: 'center' }}
                      >
                        <ExternalLink size={12} />
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MetricsStrip({ metrics }) {
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', padding: '8px 12px', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 6, fontSize: '0.75rem' }}>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <Zap size={12} style={{ color: 'var(--accent-amber)' }} />
        <span>Latency: <strong style={{ color: 'var(--text-primary)' }}>{metrics.latency_ms >= 1000 ? `${(metrics.latency_ms / 1000).toFixed(2)}s` : `${metrics.latency_ms}ms`}</strong></span>
      </div>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <Code size={12} style={{ color: 'var(--accent-blue)' }} />
        <span>Tokens: <strong style={{ color: 'var(--text-primary)' }}>{metrics.prompt_tokens} in / {metrics.completion_tokens} out</strong></span>
      </div>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <Sparkles size={12} style={{ color: 'var(--accent-emerald)' }} />
        <span>TPS: <strong style={{ color: 'var(--text-primary)' }}>{metrics.tokens_per_second} t/s</strong></span>
      </div>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginLeft: 'auto' }}>
        <span style={{ color: 'var(--accent-emerald)', fontWeight: 600 }}>${Number(metrics.cost).toFixed(6)}</span>
      </div>
    </div>
  );
}
