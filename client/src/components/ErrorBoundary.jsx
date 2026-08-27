import { Component } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

/**
 * Catches render-time errors so one broken page does not blank the whole
 * dashboard. Without this, any exception thrown during render unmounts the
 * entire React tree and leaves the user looking at an empty document.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Keep the stack in the console for local debugging.
    console.error('[ui] Render error:', error, info?.componentStack);
  }

  handleReset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1rem',
          padding: '3rem 1.5rem',
          minHeight: '60vh',
          textAlign: 'center',
        }}
      >
        <AlertTriangle size={40} style={{ color: 'var(--accent-amber)' }} />

        <h2 style={{ margin: 0, color: 'var(--text-primary)' }}>
          Something went wrong on this page
        </h2>

        <p style={{ margin: 0, color: 'var(--text-secondary)', maxWidth: '32rem' }}>
          The rest of the dashboard is still working. You can retry this view, or
          navigate elsewhere using the sidebar.
        </p>

        <code
          style={{
            display: 'block',
            maxWidth: '40rem',
            overflowX: 'auto',
            padding: '0.75rem 1rem',
            borderRadius: '0.5rem',
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border)',
            color: 'var(--text-secondary)',
            fontSize: '0.8125rem',
            textAlign: 'left',
          }}
        >
          {String(error?.message || error)}
        </code>

        <button className="btn btn-primary" onClick={this.handleReset}>
          <RotateCcw size={16} />
          Try again
        </button>
      </div>
    );
  }
}
