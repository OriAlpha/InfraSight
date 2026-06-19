import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  List,
  BarChart3,
  Settings,
  Zap,
  Sparkles,
  Play,
} from 'lucide-react';
import { useApi } from '../../hooks/useApi';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/logs', icon: List, label: 'Logs' },
  { to: '/analytics', icon: BarChart3, label: 'Analytics' },
  { to: '/prompts', icon: Sparkles, label: 'Prompts' },
  { to: '/playground', icon: Play, label: 'Playground' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

export default function Sidebar() {
  const { data: health } = useApi('/health');

  const isConnected = health && !health.error;

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="sidebar-brand-icon">
          <Zap size={20} color="white" />
        </div>
        <div className="sidebar-brand-text">
          <h1>LLM Tracker</h1>
          <span>InfraSight </span>
        </div>
      </div>

      <nav className="sidebar-nav">
        <span className="sidebar-nav-label">Navigation</span>
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `sidebar-nav-item ${isActive ? 'active' : ''}`
            }
          >
            <Icon size={20} className="nav-icon" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className={`status-dot ${isConnected ? '' : 'disconnected'}`} />
        <span>{isConnected ? 'Connected' : 'Disconnected'}</span>
      </div>
    </aside>
  );
}

