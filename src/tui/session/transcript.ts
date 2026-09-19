// The v2.0.8 session-transcript exports, ported from the vendored reference
// (routes/session/index.tsx formatSessionTranscript + @opencode/util
// session-title-fallback). The markdown grammar is the port; the data comes
// from our turn store (partsToTurns), which flattens tool parts out of the
// assistant message — so tool blocks re-join the CURRENT Assistant section
// here, where upstream carries them inside the message content array. The
// rendered text is the same.
//
// Adaptations (wiring, not grammar): tool output text is our store's
// toolOut/toolError (upstream runs toolDisplayContent over the live part —
// same fields, and our live tail truncates output at 220 chars); the
// **Created:** header line prints only when the session payload carried a
// creation time (the zcode session/list rows may not); the shell branch is
// upstream stock — no shell turns exist in our store today.

export interface TranscriptSessionInfo {
  id: string;
  title?: string;
  parentID?: string;
  createdAt?: number;
  updatedAt: number;
}

export interface TranscriptTurn {
  role: string; // "user" | "assistant" | "tool" | "shell" (shell: stock, unused today)
  text: string;
  thinking?: string;
  command?: string;
  shellOut?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOut?: string;
  toolStatus?: string;
  toolError?: string;
}

// @opencode/util session-title-fallback: the timestamped title required by
// the compatibility surfaces when a session carries no title of its own.
export function withTimestampedFallback(info: TranscriptSessionInfo): string {
  if (info.title) return info.title;
  return `${info.parentID ? "Child" : "New"} session - ${new Date(info.createdAt ?? Date.now()).toISOString()}`;
}

export function formatSessionTranscript(
  session: TranscriptSessionInfo,
  messages: TranscriptTurn[],
  thinking: boolean,
  tools = true,
): string {
  const body: string[] = [];
  let assistant: string[] | null = null;
  const flushAssistant = () => {
    if (assistant !== null && assistant.length > 0) body.push(`## Assistant\n\n${assistant.join("\n\n")}`);
    assistant = null;
  };
  for (const message of messages) {
    if (message.role === "user") {
      flushAssistant();
      body.push(`## User\n\n${message.text}`);
    } else if (message.role === "shell") {
      flushAssistant();
      body.push(`## Shell\n\n\`\`\`\n$ ${message.command ?? message.text}\n${message.shellOut ?? ""}\n\`\`\``);
    } else if (message.role === "assistant" || message.role === "tool") {
      if (assistant === null) assistant = [];
      if (message.role === "assistant") {
        if (thinking && message.thinking) assistant.push(`_Thinking:_\n\n${message.thinking}`);
        if (message.text) assistant.push(message.text);
      } else if (tools) {
        const input =
          typeof message.toolInput === "string"
            ? message.toolInput
            : JSON.stringify(message.toolInput ?? {}, null, 2);
        const output =
          message.toolStatus === "error"
            ? (message.toolError ?? "")
            : message.toolStatus === "streaming"
              ? ""
              : (message.toolOut ?? "");
        assistant.push(`**Tool: ${message.toolName ?? "tool"}**\n\n**Input:**\n\`\`\`json\n${input}\n\`\`\`\n\n${output}`);
      }
    }
  }
  flushAssistant();
  const created = session.createdAt === undefined ? "" : `**Created:** ${new Date(session.createdAt).toLocaleString()}\n`;
  return `# ${withTimestampedFallback(session)}\n\n**Session ID:** ${session.id}\n${created}**Updated:** ${new Date(session.updatedAt).toLocaleString()}\n\n---\n\n${body.join("\n\n---\n\n")}\n`;
}
