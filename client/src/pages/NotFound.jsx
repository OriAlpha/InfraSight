import { useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft } from 'lucide-react';

export default function NotFound() {
  const navigate = useNavigate();

  return (
    <div className="animate-slide-up" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: 24, textAlign: 'center' }}>
      <div style={{ fontSize: '4rem', fontWeight: 800, background: 'linear-gradient(135deg, var(--accent-blue), var(--accent-purple))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
        404
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--text-primary)' }}>Page Not Found</h2>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.875rem', maxWidth: 400 }}>
          The page you're looking for doesn't exist or has been moved.
        </p>
      </div>
      <button className="btn btn-primary" onClick={() => navigate('/')} style={{ marginTop: 8 }}>
        <ArrowLeft size={16} style={{ marginRight: 6 }} />
        Back to Dashboard
      </button>
    </div>
  );
}
