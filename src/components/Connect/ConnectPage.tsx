import { useState } from "react";
import { ClaudeConnect } from "./ClaudeConnect";
import { CodexConnect } from "./CodexConnect";

type Agent = "claude" | "codex";

const AGENTS: { id: Agent; name: string }[] = [
  { id: "claude", name: "Claude Code" },
  { id: "codex", name: "Codex CLI" },
];

/** One "Connect" tab with a switch per supported agent. */
export function ConnectPage() {
  const [agent, setAgent] = useState<Agent>("claude");
  return (
    <div className="space-y-5">
      <div className="flex gap-2" role="tablist">
        {AGENTS.map((a) => (
          <button
            key={a.id}
            role="tab"
            aria-selected={agent === a.id}
            className={agent === a.id ? "btn btn-primary" : "btn"}
            onClick={() => setAgent(a.id)}
          >
            {a.name}
          </button>
        ))}
      </div>
      {agent === "claude" ? <ClaudeConnect /> : <CodexConnect />}
    </div>
  );
}
