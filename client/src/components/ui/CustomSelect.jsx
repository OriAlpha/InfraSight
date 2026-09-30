import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';

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
  const dropdownRef = useRef(null);
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0, openUpwards: false });

  // Normalize options to { value, label } objects
  const normalizedOptions = options.map((opt) => {
    if (opt && typeof opt === 'object') {
      return { value: opt.value, label: opt.label };
    }
    return { value: opt, label: opt };
  });

  const selectedOption = normalizedOptions.find((opt) => {
    if (opt.value === value) return true;
    if (value && opt.value && typeof value === 'string' && typeof opt.value === 'string') {
      return opt.value.endsWith(`/${value}`) || value.endsWith(`/${opt.value}`);
    }
    return false;
  });

  // Compute position relative to viewport
  const updateCoords = useCallback(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const openUpwards = spaceBelow < 240 && rect.top > 240;
      setCoords({
        top: openUpwards ? rect.top - 6 : rect.bottom + 6,
        left: Math.max(8, Math.min(window.innerWidth - 220, rect.left)),
        width: rect.width,
        openUpwards
      });
    }
  }, []);

  // Update fixed position coordinates when opened
  useEffect(() => {
    if (isOpen) {
      updateCoords();
    }
  }, [isOpen, updateCoords]);

  // Track scroll & resize to dynamically re-position the dropdown popup
  useEffect(() => {
    if (!isOpen) return;

    window.addEventListener('scroll', updateCoords, true);
    window.addEventListener('resize', updateCoords);
    return () => {
      window.removeEventListener('scroll', updateCoords, true);
      window.removeEventListener('resize', updateCoords);
    };
  }, [isOpen, updateCoords]);

  // Close dropdown on click outside
  useEffect(() => {
    const handleOutsideClick = (e) => {
      // Check both container and portaled dropdown element
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  // Keyboard accessibility
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const handleSelect = (val, e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (typeof onChange === 'function') {
      onChange(val);
    }
    setIsOpen(false);
  };

  const handleTriggerKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault();
      setIsOpen((prev) => !prev);
    }
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
        onClick={() => setIsOpen((prev) => !prev)}
        onKeyDown={handleTriggerKeyDown}
        tabIndex={0}
        role="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: size === 'sm' ? '6px 12px' : '10px 14px',
          background: 'rgba(255, 255, 255, 0.04)',
          border: isOpen ? '1px solid var(--accent-indigo, #6366f1)' : '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          cursor: 'pointer',
          fontSize: size === 'sm' ? '0.8125rem' : '0.875rem',
          color: 'var(--text-primary)',
          transition: 'all var(--transition-base)',
          height: size === 'sm' ? '32px' : '40px',
          boxSizing: 'border-box',
          boxShadow: isOpen ? '0 0 0 3px rgba(99, 102, 241, 0.15)' : 'none',
          outline: 'none',
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
            color: isOpen ? 'var(--accent-indigo, #6366f1)' : 'var(--text-muted)',
            transition: 'transform var(--transition-base), color var(--transition-base)',
            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            marginLeft: 8,
            flexShrink: 0,
          }}
        />
      </div>

      {/* Options Dropdown Menu (Rendered via React Portal directly into body) */}
      {isOpen && createPortal(
        <div
          ref={dropdownRef}
          className="custom-select-dropdown animate-fade-in"
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            top: `${coords.top}px`,
            left: `${coords.left}px`,
            minWidth: `${Math.max(coords.width, 210)}px`,
            width: 'max-content',
            maxWidth: '340px',
            transform: coords.openUpwards ? 'translateY(-100%)' : 'none',
            background: 'var(--bg-secondary, #111422)',
            backdropFilter: 'blur(20px)',
            border: '1px solid var(--border-hover, rgba(255, 255, 255, 0.15))',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 12px 32px rgba(0, 0, 0, 0.65), 0 0 1px rgba(255, 255, 255, 0.2)',
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
              const isSelected = opt.value === value ||
                (Boolean(value) && Boolean(opt.value) && typeof value === 'string' && typeof opt.value === 'string' &&
                  (opt.value.endsWith(`/${value}`) || value.endsWith(`/${opt.value}`)));
              return (
                <div
                  key={String(opt.value)}
                  onClick={(e) => handleSelect(opt.value, e)}
                  onMouseDown={(e) => handleSelect(opt.value, e)}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: size === 'sm' ? '0.8125rem' : '0.875rem',
                    color: isSelected ? 'var(--accent-indigo, #818cf8)' : 'var(--text-secondary)',
                    fontWeight: isSelected ? 600 : 400,
                    cursor: 'pointer',
                    transition: 'background var(--transition-fast), color var(--transition-fast)',
                    background: isSelected ? 'rgba(99, 102, 241, 0.12)' : 'transparent',
                    border: isSelected ? '1px solid rgba(99, 102, 241, 0.25)' : '1px solid transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    boxSizing: 'border-box',
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                      e.currentTarget.style.color = 'var(--text-primary)';
                    } else {
                      e.currentTarget.style.background = 'rgba(99, 102, 241, 0.18)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.background = 'transparent';
                      e.currentTarget.style.color = 'var(--text-secondary)';
                    } else {
                      e.currentTarget.style.background = 'rgba(99, 102, 241, 0.12)';
                    }
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {opt.label}
                  </span>
                  {isSelected && (
                    <Check
                      size={14}
                      style={{
                        color: 'var(--accent-indigo, #818cf8)',
                        flexShrink: 0,
                        marginLeft: 'auto'
                      }}
                    />
                  )}
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
