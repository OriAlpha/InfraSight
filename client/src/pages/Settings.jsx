import { useState, useMemo, useEffect } from 'react';
import {
  Copy,
  Check,
  Save,
  Trash2,
  Server,
  Database,
  DollarSign,
  Info,
  ExternalLink,
  Sparkles,
  ChevronDown,
  RefreshCw,
  Settings as SettingsIcon,
  Shield,
  Bell,
  Key,
} from 'lucide-react';
import { useApi, fetchApi } from '../hooks/useApi';
import CustomSelect from '../components/ui/CustomSelect';

function formatModelName(name) {
  if (!name) return 'Unknown';
  const parts = name.split('/');
  return parts[parts.length - 1];
}

export default function Settings() {
  return (
    <div className="animate-slide-up">
      <div className="page-header">
        <h2>Settings</h2>
        <p>Configure your InfraSight instance</p>
      </div>

      <SystemSettingsSection />
      <ApiConfigSection />
      <ModelPricingSection />
      <DataManagementSection />
      <AboutSection />
    </div>
  );
}

function SystemSettingsSection() {
  const { data: settingsData, loading, refetch } = useApi('/settings');
  const [form, setForm] = useState({
    UPSTREAM_API_BASE: '',
    UPSTREAM_PROVIDER: 'deepinfra',
    UPSTREAM_API_KEY: '',
    ALERT_SLACK_WEBHOOK_URL: '',
    ALERT_DISCORD_WEBHOOK_URL: '',
    ALERT_LATENCY_THRESHOLD_MS: '',
    ALERT_ON_FAILURE: true,
    LOG_PAYLOADS: true,
    MASK_PII: true,
    ACTIVE_PII_REDACTION: false,
    BANNED_KEYWORDS: '',
    EVALUATOR_MODEL: '',
    EVALUATOR_API_BASE: '',
  });
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    if (settingsData && settingsData.data) {
      const data = settingsData.data;
      setForm({
        UPSTREAM_API_BASE: data.UPSTREAM_API_BASE || '',
        UPSTREAM_PROVIDER: data.UPSTREAM_PROVIDER || 'deepinfra',
        UPSTREAM_API_KEY: data.UPSTREAM_API_KEY || '',
        ALERT_SLACK_WEBHOOK_URL: data.ALERT_SLACK_WEBHOOK_URL || '',
        ALERT_DISCORD_WEBHOOK_URL: data.ALERT_DISCORD_WEBHOOK_URL || '',
        ALERT_LATENCY_THRESHOLD_MS: data.ALERT_LATENCY_THRESHOLD_MS || '',
        ALERT_ON_FAILURE: data.ALERT_ON_FAILURE !== 'false',
        LOG_PAYLOADS: data.LOG_PAYLOADS !== 'false',
        MASK_PII: data.MASK_PII !== 'false',
        ACTIVE_PII_REDACTION: data.ACTIVE_PII_REDACTION === 'true',
        BANNED_KEYWORDS: data.BANNED_KEYWORDS || '',
        EVALUATOR_MODEL: data.EVALUATOR_MODEL || '',
        EVALUATOR_API_BASE: data.EVALUATOR_API_BASE || '',
      });
    }
  }, [settingsData]);

  const handleSaveSettings = async () => {
    setSaving(true);
    setSaveSuccess(false);
    try {
      const payload = {
        ...form,
        ALERT_ON_FAILURE: form.ALERT_ON_FAILURE ? 'true' : 'false',
        LOG_PAYLOADS: form.LOG_PAYLOADS ? 'true' : 'false',
        MASK_PII: form.MASK_PII ? 'true' : 'false',
        ACTIVE_PII_REDACTION: form.ACTIVE_PII_REDACTION ? 'true' : 'false',
      };

      const response = await fetchApi('/settings', {
        method: 'PUT',
        body: payload
      });

      if (response && response.success) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
        refetch();
      } else {
        alert(response?.error?.message || 'Failed to save settings');
      }
    } catch (err) {
      alert('Failed to save settings: ' + err.message);
    }
    setSaving(false);
  };

  return (
    <div className="settings-section">
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          userSelect: 'none',
          marginBottom: 8,
        }}
      >
        <h3 style={{ margin: 0 }}>
          <SettingsIcon size={18} style={{ marginRight: 8, verticalAlign: 'middle' }} />
          Instance Configuration
        </h3>
        <ChevronDown
          size={20}
          style={{
            color: 'var(--text-muted)',
            transition: 'transform 0.25s ease',
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
        />
      </div>
      <p className="section-description" style={{ marginBottom: expanded ? undefined : 0 }}>
        Manage database-driven credentials, upstream providers, alerts, privacy filters, and judge parameters dynamically.
      </p>

      <div style={{
        maxHeight: expanded ? '3000px' : '0px',
        overflow: 'hidden',
        transition: 'max-height 0.4s ease, opacity 0.3s ease',
        opacity: expanded ? 1 : 0,
      }}>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16 }}>
            <div className="skeleton skeleton-text" style={{ height: 40 }} />
            <div className="skeleton skeleton-text" style={{ height: 40 }} />
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
              
              {/* Upstream Routing Card */}
              <div className="glass-card-static settings-card">
                <h4 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 12 }}>
                  <Key size={14} style={{ color: 'var(--accent-blue)' }} />
                  Upstream LLM Provider
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <label className="label" style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Provider Type</label>
                    <CustomSelect 
                      value={form.UPSTREAM_PROVIDER}
                      onChange={val => setForm({...form, UPSTREAM_PROVIDER: val})}
                      options={[
                        { value: 'deepinfra', label: 'DeepInfra (Default)' },
                        { value: 'openai', label: 'OpenAI' },
                        { value: 'anthropic', label: 'Anthropic' },
                        { value: 'other', label: 'Other OpenAI-Compatible' }
                      ]}
                      style={{ width: '100%' }}
                      size="sm"
                    />
                  </div>
                  <div>
                    <label className="label" style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>API Base URL</label>
                    <input 
                      className="input input-sm" 
                      value={form.UPSTREAM_API_BASE}
                      onChange={e => setForm({...form, UPSTREAM_API_BASE: e.target.value})}
                      placeholder="e.g. https://api.deepinfra.com"
                    />
                  </div>
                  <div>
                    <label className="label" style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>API Key / Token</label>
                    <input 
                      className="input input-sm" 
                      type="password"
                      value={form.UPSTREAM_API_KEY}
                      onChange={e => setForm({...form, UPSTREAM_API_KEY: e.target.value})}
                      placeholder={form.UPSTREAM_API_KEY ? "••••••••" : "Enter API key"}
                    />
                  </div>
                </div>
              </div>

              {/* Privacy & Guardrails Card */}
              <div className="glass-card-static settings-card">
                <h4 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 12 }}>
                  <Shield size={14} style={{ color: 'var(--accent-emerald)' }} />
                  Privacy & Guardrails
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.8rem', color: 'var(--text-primary)' }}>
                      <input 
                        type="checkbox" 
                        checked={form.LOG_PAYLOADS}
                        onChange={e => setForm({...form, LOG_PAYLOADS: e.target.checked})}
                      />
                      Log Input/Output Payloads
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.8rem', color: 'var(--text-primary)' }}>
                      <input 
                        type="checkbox" 
                        checked={form.MASK_PII}
                        onChange={e => setForm({...form, MASK_PII: e.target.checked})}
                      />
                      Mask PII in Logs (Emails, IPs, Keys)
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.8rem', color: 'var(--text-primary)' }}>
                      <input 
                        type="checkbox" 
                        checked={form.ACTIVE_PII_REDACTION}
                        onChange={e => setForm({...form, ACTIVE_PII_REDACTION: e.target.checked})}
                      />
                      Active PII Redaction on Proxy
                    </label>
                  </div>
                  <div>
                    <label className="label" style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Banned Keywords (comma-separated)</label>
                    <input 
                      className="input input-sm" 
                      value={form.BANNED_KEYWORDS}
                      onChange={e => setForm({...form, BANNED_KEYWORDS: e.target.value})}
                      placeholder="exploit,jailbreak,bypass"
                    />
                  </div>
                </div>
              </div>

              {/* AI Evaluator Card */}
              <div className="glass-card-static settings-card">
                <h4 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 12 }}>
                  <Sparkles size={14} style={{ color: 'var(--accent-purple)' }} />
                  Background AI Judge
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <label className="label" style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Evaluator Model</label>
                    <input 
                      className="input input-sm" 
                      value={form.EVALUATOR_MODEL}
                      onChange={e => setForm({...form, EVALUATOR_MODEL: e.target.value})}
                      placeholder="e.g. meta-llama/Meta-Llama-3.1-8B-Instruct"
                    />
                  </div>
                  <div>
                    <label className="label" style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Evaluator API Base (optional)</label>
                    <input 
                      className="input input-sm" 
                      value={form.EVALUATOR_API_BASE}
                      onChange={e => setForm({...form, EVALUATOR_API_BASE: e.target.value})}
                      placeholder="Leave empty for upstream default"
                    />
                  </div>
                </div>
              </div>

              {/* Webhook Alerts Card */}
              <div className="glass-card-static settings-card">
                <h4 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 12 }}>
                  <Bell size={14} style={{ color: 'var(--accent-amber)' }} />
                  Webhook Alerts
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <label className="label" style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Slack Webhook URL</label>
                    <input 
                      className="input input-sm" 
                      type="password"
                      value={form.ALERT_SLACK_WEBHOOK_URL}
                      onChange={e => setForm({...form, ALERT_SLACK_WEBHOOK_URL: e.target.value})}
                      placeholder={form.ALERT_SLACK_WEBHOOK_URL ? "••••••••" : "https://hooks.slack.com/..."}
                    />
                  </div>
                  <div>
                    <label className="label" style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Discord Webhook URL</label>
                    <input 
                      className="input input-sm" 
                      type="password"
                      value={form.ALERT_DISCORD_WEBHOOK_URL}
                      onChange={e => setForm({...form, ALERT_DISCORD_WEBHOOK_URL: e.target.value})}
                      placeholder={form.ALERT_DISCORD_WEBHOOK_URL ? "••••••••" : "https://discord.com/api/..."}
                    />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'center' }}>
                    <div>
                      <label className="label" style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Latency Limit (ms)</label>
                      <input 
                        className="input input-sm" 
                        type="number"
                        value={form.ALERT_LATENCY_THRESHOLD_MS}
                        onChange={e => setForm({...form, ALERT_LATENCY_THRESHOLD_MS: e.target.value})}
                        placeholder="e.g. 5000"
                      />
                    </div>
                    <div style={{ marginTop: 16 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.8rem', color: 'var(--text-primary)' }}>
                        <input 
                          type="checkbox" 
                          checked={form.ALERT_ON_FAILURE}
                          onChange={e => setForm({...form, ALERT_ON_FAILURE: e.target.checked})}
                        />
                        On Failures
                      </label>
                    </div>
                  </div>
                </div>
              </div>

            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, marginTop: 16 }}>
              {saveSuccess && (
                <span style={{ fontSize: '0.85rem', color: 'var(--accent-emerald)', fontWeight: 500 }}>
                  ✓ Settings saved successfully!
                </span>
              )}
              <button 
                className="btn btn-primary btn-sm" 
                onClick={handleSaveSettings}
                disabled={saving}
                style={{ display: 'flex', alignItems: 'center', gap: 8 }}
              >
                <Save size={14} />
                {saving ? 'Saving...' : 'Save Configuration'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ApiConfigSection() {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const proxyUrl = `${window.location.origin}/api`;

  const handleCopy = (text) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const preStyle = {
    background: 'rgba(0,0,0,0.35)',
    border: '1px solid var(--glass-border)',
    borderRadius: 'var(--radius-md)',
    padding: '14px 16px',
    fontSize: '0.8rem',
    lineHeight: 1.6,
    overflowX: 'auto',
    color: 'var(--text-primary)',
    margin: 0,
  };

  const labelStyle = (color) => ({
    display: 'inline-block',
    fontSize: '0.7rem',
    fontWeight: 700,
    letterSpacing: '0.05em',
    color: `var(--accent-${color})`,
    textTransform: 'uppercase',
    marginBottom: 6,
  });

  return (
    <div className="settings-section">
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          userSelect: 'none',
          marginBottom: 8,
        }}
      >
        <h3 style={{ margin: 0 }}>
          <Server size={18} style={{ marginRight: 8, verticalAlign: 'middle' }} />
          API Configuration
        </h3>
        <ChevronDown
          size={20}
          style={{
            color: 'var(--text-muted)',
            transition: 'transform 0.25s ease',
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
        />
      </div>
      <p className="section-description" style={{ marginBottom: expanded ? undefined : 0 }}>
        Route your LLM API calls through InfraSight to automatically log all requests. Works with any OpenAI-compatible provider.
      </p>

      <div style={{
        maxHeight: expanded ? '2000px' : '0px',
        overflow: 'hidden',
        transition: 'max-height 0.35s ease, opacity 0.3s ease',
        opacity: expanded ? 1 : 0,
      }}>
        {/* Proxy Endpoint */}
        <div className="glass-card-static settings-card">
          <div>
            <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 8 }}>
              Proxy Endpoint
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="input"
                value={proxyUrl}
                readOnly
                style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.8125rem' }}
              />
              <button
                className="btn btn-secondary"
                onClick={() => handleCopy(proxyUrl)}
                style={{ flexShrink: 0 }}
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
          </div>
        </div>

        {/* Quick Start */}
        <div className="glass-card-static settings-card" style={{ marginTop: 16 }}>
          <h4 style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 12 }}>
            Quick Start — Connect Any OpenAI-Compatible Client
          </h4>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.5 }}>
            Point your existing OpenAI SDK at the InfraSight proxy. The server routes requests to whichever upstream provider is configured in <strong style={{ color: 'var(--text-secondary)' }}>.env</strong>.
          </p>

          {/* Step 1: .env */}
          <div style={{ marginBottom: 16 }}>
            <span style={labelStyle('purple')}>
              Step 1 — Server .env (choose your provider)
            </span>
            <pre style={preStyle}>
{`# DeepInfra (default — no extra config needed)
DEEPINFRA_API_KEY=your-deepinfra-key

# — OR — any OpenAI-compatible provider:
UPSTREAM_PROVIDER=openai
UPSTREAM_API_BASE=https://api.openai.com/v1
UPSTREAM_API_KEY=sk-...`}
            </pre>
          </div>

          {/* Step 2: Python */}
          <div style={{ marginBottom: 16 }}>
            <span style={labelStyle('emerald')}>
              Step 2 — Client Code (Python)
            </span>
            <pre style={preStyle}>
{`from openai import OpenAI

# Point at InfraSight proxy — it forwards to
# whichever provider is set in the server's .env
client = OpenAI(
    base_url="${proxyUrl}/proxy/v1/openai",
    api_key="your-api-key"
)

response = client.chat.completions.create(
    model="meta-llama/Llama-3.3-70B-Instruct",
    messages=[{"role": "user", "content": "Hello!"}]
)`}
            </pre>
          </div>

          {/* Step 2 alt: JS */}
          <div>
            <span style={labelStyle('amber')}>
              Step 2 — Client Code (JavaScript / TypeScript)
            </span>
            <pre style={preStyle}>
{`import OpenAI from "openai";

// Point at InfraSight proxy — it forwards to
// whichever provider is set in the server's .env
const client = new OpenAI({
  baseURL: "${proxyUrl}/proxy/v1",
  apiKey: process.env.UPSTREAM_API_KEY,
});

const response = await client.chat.completions.create({
  model: "meta-llama/Llama-3.3-70B-Instruct",
  messages: [{ role: "user", content: "Hello!" }],
});`}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}

function ModelPricingSection() {
  const { data: modelsData, loading, refetch } = useApi('/models');
  const [editingId, setEditingId] = useState(null);
  const [editValues, setEditValues] = useState({});
  const [saving, setSaving] = useState(false);

  const [showAddForm, setShowAddForm] = useState(false);
  const [newModel, setNewModel] = useState({
    id: '',
    name: '',
    provider: 'deepinfra',
    input_cost_per_million: 0,
    output_cost_per_million: 0,
  });

  const [showRecalculate, setShowRecalculate] = useState(false);
  const [recalculating, setRecalculating] = useState(false);

  const handleAddModel = async (e) => {
    e.preventDefault();
    if (!newModel.id.trim()) {
      alert('Model ID is required');
      return;
    }
    try {
      const response = await fetchApi('/models', {
        method: 'POST',
        body: {
          id: newModel.id.trim(),
          name: newModel.name.trim() || newModel.id.trim(),
          provider: newModel.provider,
          input_cost_per_million: Number(newModel.input_cost_per_million) || 0,
          output_cost_per_million: Number(newModel.output_cost_per_million) || 0,
        }
      });
      if (response.error) {
        alert(response.error.message || 'Failed to add model');
      } else {
        setShowAddForm(false);
        setNewModel({
          id: '',
          name: '',
          provider: 'deepinfra',
          input_cost_per_million: 0,
          output_cost_per_million: 0,
        });
        refetch();
      }
    } catch (err) {
      alert('Failed to add model: ' + err.message);
    }
  };

  const models = useMemo(() => {
    if (!modelsData) return [];
    return Array.isArray(modelsData) ? modelsData : modelsData.data || [];
  }, [modelsData]);

  const handleEdit = (model) => {
    const modelId = model.id || model.model_id;
    setEditingId(modelId);
    setEditValues({
      input_cost_per_million: model.input_cost_per_million || 0,
      output_cost_per_million: model.output_cost_per_million || 0,
    });
  };

  const handleSave = async (model) => {
    const modelId = model.id || model.model_id;
    setSaving(true);
    try {
      await fetchApi(`/models/${modelId}`, {
        method: 'PUT',
        body: {
          input_cost_per_million: Number(editValues.input_cost_per_million),
          output_cost_per_million: Number(editValues.output_cost_per_million),
        },
      });
      setEditingId(null);
      refetch();
    } catch (err) {
      alert('Failed to save: ' + err.message);
    }
    setSaving(false);
  };

  const handleRecalculate = async () => {
    setRecalculating(true);
    try {
      const response = await fetchApi('/models/recalculate', { method: 'POST' });
      if (response && response.success) {
        setShowRecalculate(false);
        window.location.reload();
      } else {
        alert(response?.error?.message || 'Failed to recalculate costs');
      }
    } catch (err) {
      alert('Failed to recalculate: ' + err.message);
    }
    setRecalculating(false);
  };

  return (
    <div className="settings-section">
      <h3>
        <DollarSign size={18} style={{ marginRight: 8, verticalAlign: 'middle' }} />
        Model Pricing
      </h3>
      <p className="section-description">
        Configure cost per million tokens for each model to track spending accurately.
      </p>

      <div className="glass-card-static settings-card">
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="skeleton skeleton-text" style={{ height: 40 }} />
            ))}
          </div>
        ) : models.length === 0 ? (
          <div className="empty-state" style={{ padding: 32 }}>
            <p>No models found. Models will appear after your first API call.</p>
          </div>
        ) : (
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Model</th>
                  <th style={{ textAlign: 'right' }}>Input $/1M tokens</th>
                  <th style={{ textAlign: 'right' }}>Output $/1M tokens</th>
                  <th style={{ textAlign: 'right', width: 100 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {models.map((model) => {
                  const modelId = model.id || model.model_id;
                  const isEditing = editingId === modelId;
                  return (
                    <tr key={modelId}>
                      <td style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                        {formatModelName(model.model_id || model.name)}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {isEditing ? (
                          <input
                            className="input input-sm"
                            type="number"
                            step="0.01"
                            value={editValues.input_cost_per_million}
                            onChange={(e) =>
                              setEditValues({ ...editValues, input_cost_per_million: e.target.value })
                            }
                            style={{ width: 120, marginLeft: 'auto' }}
                          />
                        ) : (
                          <span className="mono" style={{ color: 'var(--accent-emerald)' }}>
                            ${Number(model.input_cost_per_million || 0).toFixed(2)}
                          </span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {isEditing ? (
                          <input
                            className="input input-sm"
                            type="number"
                            step="0.01"
                            value={editValues.output_cost_per_million}
                            onChange={(e) =>
                              setEditValues({ ...editValues, output_cost_per_million: e.target.value })
                            }
                            style={{ width: 120, marginLeft: 'auto' }}
                          />
                        ) : (
                          <span className="mono" style={{ color: 'var(--accent-emerald)' }}>
                            ${Number(model.output_cost_per_million || 0).toFixed(2)}
                          </span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {isEditing ? (
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                            <button
                              className="btn btn-primary btn-sm"
                              onClick={() => handleSave(model)}
                              disabled={saving}
                            >
                              <Save size={14} />
                            </button>
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() => setEditingId(null)}
                            >
                              ✕
                            </button>
                          </div>
                        ) : (
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => handleEdit(model)}
                          >
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {showAddForm ? (
          <form onSubmit={handleAddModel} style={{ borderTop: '1px solid var(--border)', marginTop: 16, paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h4 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>Add New Model Registry</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Model ID</label>
                <input
                  required
                  placeholder="e.g. openai/gpt-4o"
                  className="input input-sm"
                  value={newModel.id}
                  onChange={(e) => setNewModel({ ...newModel, id: e.target.value })}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Name (Optional)</label>
                <input
                  placeholder="e.g. GPT-4o"
                  className="input input-sm"
                  value={newModel.name}
                  onChange={(e) => setNewModel({ ...newModel, name: e.target.value })}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Provider</label>
                <CustomSelect
                  value={newModel.provider}
                  onChange={val => setNewModel({ ...newModel, provider: val })}
                  options={[
                    { value: 'deepinfra', label: 'DeepInfra' },
                    { value: 'openai', label: 'OpenAI' },
                    { value: 'anthropic', label: 'Anthropic' },
                    { value: 'other', label: 'Other' }
                  ]}
                  style={{ width: '100%' }}
                  size="sm"
                />
              </div>
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Input $/1M tokens</label>
                <input
                  type="number"
                  step="0.0001"
                  className="input input-sm"
                  value={newModel.input_cost_per_million}
                  onChange={(e) => setNewModel({ ...newModel, input_cost_per_million: e.target.value })}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Output $/1M tokens</label>
                <input
                  type="number"
                  step="0.0001"
                  className="input input-sm"
                  value={newModel.output_cost_per_million}
                  onChange={(e) => setNewModel({ ...newModel, output_cost_per_million: e.target.value })}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowAddForm(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary btn-sm">
                Add Model
              </button>
            </div>
          </form>
        ) : (
          <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setShowAddForm(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <span>+ Add Model Registry</span>
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setShowRecalculate(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, borderColor: 'var(--accent-blue)', color: 'var(--text-primary)' }}
            >
              <RefreshCw size={14} style={{ color: 'var(--accent-blue)' }} />
              <span>Recalculate Costs</span>
            </button>
          </div>
        )}
      </div>

      {showRecalculate && (
        <div className="modal-overlay" onClick={() => setShowRecalculate(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>🔄 Recalculate Historical Costs</h3>
            <p>
              This will update the estimated costs of all historical request logs and conversation totals to match your current pricing configuration. 
              This process runs instantly in the background.
            </p>
            <div className="modal-actions">
              <button
                className="btn btn-secondary"
                onClick={() => setShowRecalculate(false)}
                disabled={recalculating}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleRecalculate}
                disabled={recalculating}
                style={{ background: 'var(--accent-blue)', borderColor: 'var(--accent-blue)' }}
              >
                {recalculating ? 'Recalculating...' : 'Yes, Recalculate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DataManagementSection() {
  const [showClear, setShowClear] = useState(false);
  const [showSeed, setShowSeed] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const { data: health } = useApi('/health');

  const handleClearAll = async () => {
    setClearing(true);
    try {
      await fetchApi('/logs', { method: 'DELETE' });
      setShowClear(false);
      window.location.reload();
    } catch (err) {
      alert('Failed to clear logs: ' + err.message);
    }
    setClearing(false);
  };

  const handleSeedDemo = async () => {
    setSeeding(true);
    try {
      await fetchApi('/logs/seed-demo', { method: 'POST' });
      setShowSeed(false);
      window.location.reload();
    } catch (err) {
      alert('Failed to seed demo data: ' + err.message);
    }
    setSeeding(false);
  };

  return (
    <div className="settings-section">
      <h3>
        <Database size={18} style={{ marginRight: 8, verticalAlign: 'middle' }} />
        Data Management
      </h3>
      <p className="section-description">
        Manage your stored log data. Seed the database with mock logs for demonstrations, or clear them to start fresh.
      </p>

      <div className="glass-card-static settings-card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: 4 }}>
              Database Status
            </div>
            <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
              {health ? (
                <span style={{ color: 'var(--accent-emerald)' }}>
                  ● Connected — {health.database || 'SQLite'}
                </span>
              ) : (
                <span style={{ color: 'var(--accent-rose)' }}>● Disconnected</span>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => setShowSeed(true)}
              disabled={seeding || clearing}
            >
              <Sparkles size={14} style={{ marginRight: 6 }} />
              Seed Demo Data
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setShowClear(true)}
              disabled={seeding || clearing}
              style={{ borderColor: 'var(--accent-rose)', color: 'var(--accent-rose)' }}
            >
              <Trash2 size={14} style={{ marginRight: 6 }} />
              Clear All Logs
            </button>
          </div>
        </div>
      </div>

      {showClear && (
        <div className="modal-overlay" onClick={() => setShowClear(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>⚠️ Clear All Logs</h3>
            <p>
              This will permanently delete all stored request logs. This action cannot be undone.
              Model pricing configuration will be preserved.
            </p>
            <div className="modal-actions">
              <button
                className="btn btn-secondary"
                onClick={() => setShowClear(false)}
                disabled={clearing}
              >
                Cancel
              </button>
              <button
                className="btn btn-danger"
                onClick={handleClearAll}
                disabled={clearing}
              >
                {clearing ? 'Clearing...' : 'Yes, Clear All'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showSeed && (
        <div className="modal-overlay" onClick={() => setShowSeed(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>✨ Seed Demo Logs</h3>
            <p>
              This will clear the current database logs and seed 30 days of mock request conversations, latencies, cost distributions, and error stats.
            </p>
            <div className="modal-actions">
              <button
                className="btn btn-secondary"
                onClick={() => setShowSeed(false)}
                disabled={seeding}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSeedDemo}
                disabled={seeding}
              >
                {seeding ? 'Seeding...' : 'Yes, Seed Demo Logs'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AboutSection() {
  return (
    <div className="settings-section">
      <h3>
        <Info size={18} style={{ marginRight: 8, verticalAlign: 'middle' }} />
        About
      </h3>

      <div className="glass-card-static settings-card">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Version</span>
            <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>1.0.0</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Developer</span>
            <span style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--accent-blue)' }}>Suhas Goravale Siddaramu</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Platform</span>
            <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>OpenAI-Compatible</span>
          </div>
        </div>
      </div>
    </div>
  );
}
