import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';

export default function CustomSelect({ 
  value, 
  onChange, 
  options = [], 
  placeholder = 'Select...', 
  style = {}, 
  className = '',
  size = 'md'
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0 });

  // Normalize options to { value, label } objects
  const normalizedOptions = options.map((opt) => {
    if (opt && typeof opt === 'object') {
      return { value: opt.value, label: opt.label };
    }
    return { value: opt, label: opt };
  });

  const selectedOption = normalizedOptions.find((opt) => opt.value === value);

  // Close dropdown on click outside
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  // Update fixed position coordinates when open
  useEffect(() => {
    if (isOpen && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setCoords({
        top: rect.bottom,
        left: rect.left,
        width: rect.width
      });
    }
  }, [isOpen]);

  // Track scroll & resize to dynamically re-position the dropdown popup
  useEffect(() => {
    if (!isOpen) return;
    const updateCoords = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setCoords({
          top: rect.bottom,
          left: rect.left,
          width: rect.width
        });
      }
    };

    window.addEventListener('scroll', updateCoords, true);
    window.addEventListener('resize', updateCoords);
    return () => {
      window.removeEventListener('scroll', updateCoords, true);
      window.removeEventListener('resize', updateCoords);
    };
  }, [isOpen]);

  const handleSelect = (val) => {
    onChange(val);
    setIsOpen(false);
  };

  return (
    <div
      ref={containerRef}
      className={`custom-select-container ${className}`}
      style={{ position: 'relative', userSelect: 'none', width: '200px', ...style }}
    >
      {/* Trigger Button */}
      <div
        className="custom-select-trigger"
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: size === 'sm' ? '6px 12px' : '10px 14px',
          background: 'rgba(255, 255, 255, 0.04)',
          border: isOpen ? '1px solid var(--border-focus)' : '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          cursor: 'pointer',
          fontSize: size === 'sm' ? '0.8125rem' : '0.875rem',
          color: 'var(--text-primary)',
          transition: 'all var(--transition-base)',
          height: size === 'sm' ? '32px' : '40px',
          boxSizing: 'border-box',
          boxShadow: isOpen ? '0 0 0 3px rgba(99, 102, 241, 0.15)' : 'none',
        }}
        onMouseEnter={(e) => {
          if (!isOpen) {
            e.currentTarget.style.borderColor = 'var(--border-hover)';
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
          }
        }}
        onMouseLeave={(e) => {
          if (!isOpen) {
            e.currentTarget.style.borderColor = 'var(--border)';
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
          }
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown
          size={size === 'sm' ? 14 : 16}
          style={{
            color: 'var(--text-muted)',
            transition: 'transform var(--transition-base)',
            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            marginLeft: 8,
            flexShrink: 0,
          }}
        />
      </div>

      {/* Options Dropdown Menu (Rendered via React Portal directly into body) */}
      {isOpen && createPortal(
        <div
          className="custom-select-dropdown animate-fade-in"
          style={{
            position: 'fixed',
            top: `${coords.top + 6}px`,
            left: `${coords.left}px`,
            width: `${coords.width}px`,
            background: 'var(--bg-secondary)',
            backdropFilter: 'blur(20px)',
            border: '1px solid var(--border-hover)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-lg), 0 10px 30px rgba(0, 0, 0, 0.6), 0 0 15px rgba(99, 102, 241, 0.05)',
            zIndex: 10000,
            maxHeight: '260px',
            overflowY: 'auto',
            padding: '6px',
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
          }}
        >
          {normalizedOptions.length === 0 ? (
            <div style={{ padding: '8px 12px', fontSize: '0.75rem', color: 'var(--text-dim)', textAlign: 'center' }}>
              No options available
            </div>
          ) : (
            normalizedOptions.map((opt) => {
              const isSelected = opt.value === value;
              return (
                <div
                  key={opt.value}
                  onClick={() => handleSelect(opt.value)}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: size === 'sm' ? '0.8125rem' : '0.875rem',
                    color: isSelected ? '#ffffff' : 'var(--text-secondary)',
                    fontWeight: isSelected ? 600 : 400,
                    cursor: 'pointer',
                    transition: 'all var(--transition-fast)',
                    background: isSelected ? 'var(--gradient-primary)' : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    boxShadow: isSelected ? '0 2px 8px rgba(139, 92, 246, 0.25)' : 'none',
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                      e.currentTarget.style.color = 'var(--text-primary)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.background = 'transparent';
                      e.currentTarget.style.color = 'var(--text-secondary)';
                    }
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {opt.label}
                  </span>
                </div>
              );
            })
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
