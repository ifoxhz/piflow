interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled?: boolean;
  /** When true: LLM builds retrieval plan before vector search. */
  planningEnabled: boolean;
  onPlanningChange: (enabled: boolean) => void;
}

function PaperclipIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M14.5 6.5l-7 7a2.12 2.12 0 01-3-3l7.5-7.5a3.12 3.12 0 014.5 4.5l-8 8a4.62 4.62 0 01-6.5-6.5l8.5-8.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <path
        d="M3 9h12M11 5l4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ChatInput({
  value,
  onChange,
  onSend,
  disabled,
  planningEnabled,
  onPlanningChange,
}: ChatInputProps) {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim() && !disabled) {
      onSend();
    }
  };

  return (
    <form className="chat-input-bar" onSubmit={handleSubmit}>
      <input
        type="text"
        className="chat-input"
        placeholder="Message piFlow..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
      <button
        type="button"
        className={`btn-plan${planningEnabled ? ' is-on' : ''}`}
        aria-pressed={planningEnabled}
        aria-label={
          planningEnabled
            ? '规划已开启：先生成检索计划再搜索'
            : '规划已关闭：原句直接向量搜索'
        }
        title={
          planningEnabled
            ? '规划开：LLM 构建检索结构 → 向量搜索 → LLM'
            : '规划关：原句 → 向量搜索 → LLM'
        }
        disabled={disabled}
        onClick={() => onPlanningChange(!planningEnabled)}
      >
        规划
      </button>
      <button type="button" className="btn-icon" aria-label="Attach file" disabled={disabled}>
        <PaperclipIcon />
      </button>
      <button
        type="submit"
        className="btn-send"
        aria-label="Send message"
        disabled={disabled || !value.trim()}
      >
        <SendIcon />
      </button>
    </form>
  );
}
