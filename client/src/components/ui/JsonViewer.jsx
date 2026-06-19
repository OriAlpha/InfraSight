import { useState, useCallback } from 'react';
import { Copy, Check, ChevronRight, ChevronDown } from 'lucide-react';

export default function JsonViewer({ data }) {
  const [copied, setCopied] = useState(false);

  const jsonStr = typeof data === 'string' ? data : JSON.stringify(data, null, 2);

  let parsed;
  try {
    parsed = typeof data === 'string' ? JSON.parse(data) : data;
  } catch {
    parsed = null;
  }

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(jsonStr).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [jsonStr]);

  return (
    <div className="json-viewer">
      <button className="copy-btn" onClick={handleCopy}>
        {copied ? <Check size={12} /> : <Copy size={12} />}
        {copied ? 'Copied' : 'Copy'}
      </button>
      <div style={{ paddingRight: 60 }}>
        {parsed !== null ? (
          <JsonNode value={parsed} depth={0} />
        ) : (
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{jsonStr}</pre>
        )}
      </div>
    </div>
  );
}

function JsonNode({ value, depth, keyName }) {
  const [collapsed, setCollapsed] = useState(depth > 2);
  const indent = depth * 18;

  if (value === null) {
    return (
      <span>
        {keyName !== undefined && <span className="json-key">"{keyName}"</span>}
        {keyName !== undefined && ': '}
        <span className="json-null">null</span>
      </span>
    );
  }

  if (typeof value === 'boolean') {
    return (
      <span>
        {keyName !== undefined && <span className="json-key">"{keyName}"</span>}
        {keyName !== undefined && ': '}
        <span className="json-boolean">{String(value)}</span>
      </span>
    );
  }

  if (typeof value === 'number') {
    return (
      <span>
        {keyName !== undefined && <span className="json-key">"{keyName}"</span>}
        {keyName !== undefined && ': '}
        <span className="json-number">{value}</span>
      </span>
    );
  }

  if (typeof value === 'string') {
    const displayVal = value.length > 300 ? value.slice(0, 300) + '…' : value;
    return (
      <span>
        {keyName !== undefined && <span className="json-key">"{keyName}"</span>}
        {keyName !== undefined && ': '}
        <span className="json-string">"{displayVal}"</span>
      </span>
    );
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return (
        <span>
          {keyName !== undefined && <span className="json-key">"{keyName}"</span>}
          {keyName !== undefined && ': '}
          <span className="json-bracket">[]</span>
        </span>
      );
    }

    return (
      <div>
        <span
          className="json-toggle"
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? <ChevronRight size={12} style={{ display: 'inline', verticalAlign: 'middle' }} /> : <ChevronDown size={12} style={{ display: 'inline', verticalAlign: 'middle' }} />}
        </span>
        {keyName !== undefined && <span className="json-key">"{keyName}"</span>}
        {keyName !== undefined && ': '}
        <span className="json-bracket">[</span>
        {collapsed ? (
          <span style={{ color: 'var(--text-dim)', cursor: 'pointer' }} onClick={() => setCollapsed(false)}>
            {` ${value.length} items `}
          </span>
        ) : (
          <div style={{ paddingLeft: indent + 18 }}>
            {value.map((item, i) => (
              <div key={i}>
                <JsonNode value={item} depth={depth + 1} />
                {i < value.length - 1 && <span className="json-bracket">,</span>}
              </div>
            ))}
          </div>
        )}
        <span className="json-bracket">]</span>
      </div>
    );
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) {
      return (
        <span>
          {keyName !== undefined && <span className="json-key">"{keyName}"</span>}
          {keyName !== undefined && ': '}
          <span className="json-bracket">{'{}'}</span>
        </span>
      );
    }

    return (
      <div>
        <span
          className="json-toggle"
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? <ChevronRight size={12} style={{ display: 'inline', verticalAlign: 'middle' }} /> : <ChevronDown size={12} style={{ display: 'inline', verticalAlign: 'middle' }} />}
        </span>
        {keyName !== undefined && <span className="json-key">"{keyName}"</span>}
        {keyName !== undefined && ': '}
        <span className="json-bracket">{'{'}</span>
        {collapsed ? (
          <span style={{ color: 'var(--text-dim)', cursor: 'pointer' }} onClick={() => setCollapsed(false)}>
            {` ${keys.length} keys `}
          </span>
        ) : (
          <div style={{ paddingLeft: indent + 18 }}>
            {keys.map((k, i) => (
              <div key={k}>
                <JsonNode value={value[k]} keyName={k} depth={depth + 1} />
                {i < keys.length - 1 && <span className="json-bracket">,</span>}
              </div>
            ))}
          </div>
        )}
        <span className="json-bracket">{'}'}</span>
      </div>
    );
  }

  return <span>{String(value)}</span>;
}
