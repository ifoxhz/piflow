import { QUICK_ACTIONS } from '@bluelamp/core';

interface WelcomeViewProps {
  onQuickAction: (prompt: string) => void;
}

export function WelcomeView({ onQuickAction }: WelcomeViewProps) {
  return (
    <div className="welcome">
      <div className="welcome-content">
        <h1 className="welcome-title">How can I help you today?</h1>
        <p className="welcome-subtitle">
          Ask anything about your documents and knowledge base.
        </p>

        <div className="quick-actions">
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.id}
              type="button"
              className="quick-action-card"
              onClick={() => onQuickAction(action.prompt)}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
