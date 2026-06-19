import { User, Bot, Terminal, Wrench } from 'lucide-react';

const roleConfig = {
  user: {
    className: 'chat-bubble-user',
    label: 'User',
    icon: User,
  },
  assistant: {
    className: 'chat-bubble-assistant',
    label: 'Assistant',
    icon: Bot,
  },
  system: {
    className: 'chat-bubble-system',
    label: 'System',
    icon: Terminal,
  },
  tool: {
    className: 'chat-bubble-tool',
    label: 'Tool',
    icon: Wrench,
  },
};

export default function ChatBubble({ role, content, tokens, cost, timestamp, children, style }) {
  const config = roleConfig[role] || roleConfig.user;
  const Icon = config.icon;

  const displayContent = typeof content === 'string'
    ? content
    : typeof content === 'object' && content !== null
      ? JSON.stringify(content, null, 2)
      : String(content || '');

  return (
    <div className={`chat-bubble ${config.className}`} style={style}>
      <div className="chat-role">
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Icon size={12} />
          {config.label}
        </span>
      </div>
      <div>{displayContent}</div>
      {children}
      {(tokens || cost) && (
        <div className="chat-meta">
          {tokens !== undefined && tokens !== null && <span>{tokens} tokens</span>}
          {cost !== undefined && cost !== null && <span>${Number(cost).toFixed(6)}</span>}
          {timestamp && <span>{timestamp}</span>}
        </div>
      )}
    </div>
  );
}
