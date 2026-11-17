import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n";
import { useChat } from "@/stores/chatStore";

export function ChatPanel({ onBack }: { onBack: () => void }) {
  const t = useT().chat;
  const { messages, phase, send, cancel, reset } = useChat();
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const busy = phase === "thinking" || phase === "talking";
  const waitingForFirstWord = phase === "thinking" && messages[messages.length - 1]?.role === "user";

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, phase]);

  const submit = () => {
    if (busy || !draft.trim()) return;
    void send(draft);
    setDraft("");
  };

  return (
    <div className="flex h-full flex-col text-[13px]">
      <header className="flex items-center justify-between gap-2 border-b px-3 py-2" style={{ borderColor: "var(--border)" }}>
        <button className="btn px-2 py-1 text-[12px]" onClick={onBack}>
          ← {t.back}
        </button>
        <div className="font-bold">{t.title}</div>
        <button className="btn px-2 py-1 text-[12px]" onClick={reset} disabled={busy || messages.length === 0}>
          {t.newChat}
        </button>
      </header>

      <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-2.5">
        {messages.length === 0 && <p className="pt-6 text-center text-[12px] text-[color:var(--text-muted)]">{t.empty}</p>}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-1.5 leading-snug"
              style={
                m.role === "user"
                  ? { background: "var(--accent)", color: "#0d2a1f", borderBottomRightRadius: 6 }
                  : {
                      background: "var(--surface-2)",
                      border: "1px solid var(--border)",
                      color: m.error ? "var(--danger)" : "var(--text)",
                      borderBottomLeftRadius: 6,
                    }
              }
            >
              {m.text}
            </div>
          </div>
        ))}
        {waitingForFirstWord && <div className="text-[12px] text-[color:var(--text-muted)]">{t.thinking}</div>}
      </div>

      <form
        className="flex items-end gap-2 border-t p-2.5"
        style={{ borderColor: "var(--border)" }}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          ref={inputRef}
          rows={1}
          value={draft}
          placeholder={t.placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter is a new line; ignore Enter while composing Hangul.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          className="max-h-24 min-h-[34px] flex-1 resize-none rounded-[9px] px-2.5 py-1.5 outline-none"
          style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text)" }}
        />
        {busy ? (
          <button type="button" className="btn btn-danger" onClick={cancel}>
            {t.stop}
          </button>
        ) : (
          <button type="submit" className="btn btn-primary" disabled={!draft.trim()}>
            {t.send}
          </button>
        )}
      </form>
    </div>
  );
}
