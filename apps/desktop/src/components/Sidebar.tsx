import { useEffect, useId, useRef, useState } from 'react';
import type { AppView } from '@bluelamp/core';
import type { ChatTimeGroup } from '../hooks/useChatSessions';

interface SidebarProps {
  view: AppView;
  chatGroups: ChatTimeGroup[];
  activeChatId: string | null;
  onNewChat: () => void;
  onSelectChat: (id: string) => void;
  onNavigate: (view: AppView) => void;
  onDeleteChat: (id: string) => void;
  onRenameChat: (id: string, title: string) => void;
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

function FlowIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <path
        d="M3 5h5l2 3h5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="4" cy="5" r="1.5" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="14" cy="8" r="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M3 13h12"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <circle cx="9" cy="13" r="1.5" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="3.5" cy="8" r="1.25" fill="currentColor" />
      <circle cx="8" cy="8" r="1.25" fill="currentColor" />
      <circle cx="12.5" cy="8" r="1.25" fill="currentColor" />
    </svg>
  );
}

interface ChatRowProps {
  title: string;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
}

function ChatRow({ title, active, onSelect, onDelete, onRename }: ChatRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(title);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (renaming) {
      setDraft(title);
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }, [renaming, title]);

  const commitRename = () => {
    const next = draft.replace(/\s+/g, ' ').trim();
    setRenaming(false);
    if (next && next !== title) onRename(next);
  };

  if (renaming) {
    return (
      <li className="chat-list-row is-renaming">
        <input
          ref={inputRef}
          className="chat-rename-input"
          value={draft}
          aria-label="重命名对话"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitRename();
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              setRenaming(false);
              setDraft(title);
            }
          }}
        />
      </li>
    );
  }

  return (
    <li className={`chat-list-row${active ? ' is-active' : ''}${menuOpen ? ' is-menu-open' : ''}`}>
      <button type="button" className="chat-list-item" onClick={onSelect}>
        <span className="chat-list-title">{title}</span>
      </button>
      <div className="chat-item-actions" ref={menuRef}>
        <button
          type="button"
          className="chat-item-more"
          aria-label="对话操作"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls={menuId}
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
        >
          <MoreIcon />
        </button>
        {menuOpen && (
          <div className="chat-item-menu" id={menuId} role="menu">
            <button
              type="button"
              role="menuitem"
              className="chat-item-menu-item"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                setRenaming(true);
              }}
            >
              重命名
            </button>
            <button
              type="button"
              role="menuitem"
              className="chat-item-menu-item is-danger"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                onDelete();
              }}
            >
              删除
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

export function Sidebar({
  view,
  chatGroups,
  activeChatId,
  onNewChat,
  onSelectChat,
  onNavigate,
  onDeleteChat,
  onRenameChat,
}: SidebarProps) {
  const hasChats = chatGroups.some((g) => g.chats.length > 0);

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
        {!hasChats && <div className="chat-list-empty">暂无对话</div>}
        <div className="chat-groups">
          {chatGroups.map((group) => (
            <div key={group.id} className="chat-group">
              <div className="chat-group-label">{group.label}</div>
              <ul className="chat-list">
                {group.chats.map((chat) => (
                  <ChatRow
                    key={chat.id}
                    title={chat.title}
                    active={activeChatId === chat.id}
                    onSelect={() => onSelectChat(chat.id)}
                    onDelete={() => onDeleteChat(chat.id)}
                    onRename={(nextTitle) => onRenameChat(chat.id, nextTitle)}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
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
          className={`nav-item ${view === 'piFlow' ? 'active' : ''}`}
          onClick={() => onNavigate('piFlow')}
        >
          <FlowIcon />
          piFlow
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
