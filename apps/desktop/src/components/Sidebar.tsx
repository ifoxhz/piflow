import type { AppView } from '@bluelamp/core';

export interface RecentChat {
  id: string;
  title: string;
  time: string;
}

interface SidebarProps {
  view: AppView;
  recentChats: RecentChat[];
  activeChatId: string | null;
  onNewChat: () => void;
  onSelectChat: (id: string) => void;
  onNavigate: (view: AppView) => void;
}

function LogoIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden>
      <circle cx="14" cy="14" r="14" fill="#007AFF" />
      <circle cx="14" cy="11" r="4" fill="white" />
      <path
        d="M8 20c1.5-3 4-4.5 6-4.5s4.5 1.5 6 4.5"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <path
        d="M2 5.5A1.5 1.5 0 013.5 4H7l1.5 2h6A1.5 1.5 0 0116 7.5v7a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 012 14.5v-9z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <circle cx="9" cy="9" r="2.2" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M9 1.5v2M9 14.5v2M1.5 9h2M14.5 9h2M3.4 3.4l1.4 1.4M13.2 13.2l1.4 1.4M3.4 14.6l1.4-1.4M13.2 4.8l1.4-1.4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Sidebar({
  view,
  recentChats,
  activeChatId,
  onNewChat,
  onSelectChat,
  onNavigate,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <LogoIcon />
        <span className="sidebar-brand">RAG Assistant</span>
      </div>

      <button type="button" className="btn-new-chat" onClick={onNewChat}>
        <PlusIcon />
        New Chat
      </button>

      <div className="sidebar-section">
        <div className="sidebar-section-label">Recent Chats</div>
        <ul className="chat-list">
          {recentChats.length === 0 && (
            <li className="chat-list-empty">No chats yet</li>
          )}
          {recentChats.map((chat) => (
            <li key={chat.id}>
              <button
                type="button"
                className={`chat-list-item ${activeChatId === chat.id ? 'active' : ''}`}
                onClick={() => onSelectChat(chat.id)}
              >
                <span className="chat-list-title">{chat.title}</span>
                <span className="chat-list-time">{chat.time}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <nav className="sidebar-footer">
        <button
          type="button"
          className={`nav-item ${view === 'knowledge' ? 'active' : ''}`}
          onClick={() => onNavigate('knowledge')}
        >
          <FolderIcon />
          Knowledge Base
        </button>
        <button
          type="button"
          className={`nav-item ${view === 'settings' ? 'active' : ''}`}
          onClick={() => onNavigate('settings')}
        >
          <GearIcon />
          Settings
        </button>
      </nav>
    </aside>
  );
}
