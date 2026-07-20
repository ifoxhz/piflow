import type { Message } from '@bluelamp/core';
import { formatCitationLocation } from '@bluelamp/core';
import { MarkdownContent } from './MarkdownContent';

interface ChatViewProps {
  messages: Message[];
}

function PlainTextContent({ content }: { content: string }) {
  return (
    <>
      {content.split('\n').map((line, i) => (
        <span key={i}>
          {line}
          <br />
        </span>
      ))}
    </>
  );
}

export function ChatView({ messages }: ChatViewProps) {
  if (messages.length === 0) {
    return null;
  }

  return (
    <div className="chat-messages">
      {messages.map((msg) => (
        <div key={msg.id} className={`message message-${msg.role}`}>
          <div className="message-bubble">
            {msg.role === 'assistant' ? (
              <MarkdownContent content={msg.content} />
            ) : (
              <PlainTextContent content={msg.content} />
            )}
            {msg.citations && msg.citations.length > 0 && (
              <div className="message-citations">
                <div className="message-citations-title">Sources</div>
                {msg.citations.map((c) => {
                  const location = formatCitationLocation(c.page, c.heading);
                  return (
                  <div key={c.chunkId} className="message-citation">
                    <div className="message-citation-header">
                      <span className="message-citation-id">{c.sourceId}</span>
                      <span
                        className="message-citation-doc"
                        title={c.sourcePath ?? c.documentTitle}
                      >
                        {c.documentTitle}
                      </span>
                      {location && (
                        <span className="message-citation-location">{location}</span>
                      )}
                    </div>
                    <div className="message-citation-quote">
                      <MarkdownContent content={c.quote} className="markdown-content--compact" />
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
