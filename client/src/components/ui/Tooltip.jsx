import { useState } from 'react';
import { HelpCircle } from 'lucide-react';

export default function Tooltip({ content, position = 'top', children }) {
  const [active, setActive] = useState(false);

  return (
    <div 
      className="tooltip-container"
      style={{ display: 'inline-flex', alignItems: 'center', position: 'relative' }}
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
    >
      <div 
        onClick={(e) => {
          e.stopPropagation();
          setActive(!active);
        }}
        style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}
      >
        {children || (
          <HelpCircle 
            size={13} 
            style={{ 
              marginLeft: 4, 
              color: 'var(--text-muted)', 
              opacity: 0.8,
              transition: 'color var(--transition-fast)' 
            }} 
            onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}
            onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
          />
        )}
      </div>
      {active && (
        <div 
          className="tooltip-bubble"
          style={{
            position: 'absolute',
            zIndex: 10000,
            padding: '10px 14px',
            borderRadius: 'var(--radius-md)',
            fontSize: '0.75rem',
            fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            color: 'var(--text-primary)',
            background: 'var(--bg-secondary)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            boxShadow: 'var(--shadow-xl), 0 0 20px rgba(0, 0, 0, 0.5)',
            width: 'max-content',
            maxWidth: '280px',
            whiteSpace: 'normal',
            pointerEvents: 'none',
            lineHeight: '1.4',
            textAlign: 'left',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            ...(position === 'top' && {
              bottom: '100%',
              left: '50%',
              transform: 'translateX(-50%) translateY(-10px)',
            }),
            ...(position === 'bottom' && {
              top: '100%',
              left: '50%',
              transform: 'translateX(-50%) translateY(10px)',
            }),
            ...(position === 'left' && {
              right: '100%',
              top: '50%',
              transform: 'translateY(-50%) translateX(-10px)',
            }),
            ...(position === 'right' && {
              left: '100%',
              top: '50%',
              transform: 'translateY(-50%) translateX(10px)',
            }),
          }}
        >
          {content}
        </div>
      )}
    </div>
  );
}
