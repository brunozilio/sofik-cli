import React, { useState } from "react";
import { Box, Text } from "ink";
import type { Message, TurnEvent } from "../lib/types.ts";
import { Markdown } from "./Markdown.tsx";

interface ChatProps {
  messages: Message[];
  turnEvents: TurnEvent[];
  status: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatToolArgs(name: string, input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const obj = input as Record<string, unknown>;

  const primaryKeys: Record<string, string> = {
    Read: "file_path",
    Write: "file_path",
    Edit: "file_path",
    MultiEdit: "file_path",
    Glob: "pattern",
    Grep: "pattern",
    Bash: "command",
    WebFetch: "url",
    WebSearch: "query",
    Agent: "prompt",
  };

  const key = primaryKeys[name];
  if (key && obj[key] != null) {
    const val = String(obj[key]);
    return `("${val}")`;
  }

  const keys = Object.keys(obj).slice(0, 1);
  if (keys.length === 0) return "";
  const k = keys[0]!;
  const raw = obj[k];
  const v = raw !== null && typeof raw === "object" ? JSON.stringify(raw) : String(raw);
  return `(${v})`;
}

function resultSummary(result: string): string {
  return result.replace(/\n/g, " ↩ ");
}

// ── Tool category colors ────────────────────────────────────────────────────

const TOOL_COLORS: Record<string, string> = {
  Read: "blue", Write: "blue", Edit: "blue", MultiEdit: "blue",
  Glob: "blue", Grep: "blue", NotebookEdit: "blue", NotebookRead: "blue",
  WebFetch: "cyan", WebSearch: "cyan",
  Bash: "yellow", Git: "yellow",
  Agent: "magenta",
  IntegrationAction: "magenta", IntegrationList: "magenta",
};

function toolColor(name: string): string {
  return TOOL_COLORS[name] ?? "green";
}

// ── Thinking block ──────────────────────────────────────────────────────────

function ThinkingBlock({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const lines = text.split("\n");
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text
        dimColor
        color="cyan"
        onPress={() => setExpanded((v) => !v)}
      >
        ◈ thinking  [{lines.length} linha{lines.length !== 1 ? "s" : ""}{expanded ? ", clique para recolher" : ", clique para expandir"}]
      </Text>
      {expanded && (
        <Box flexDirection="column" marginLeft={2}>
          {lines.map((line, i) => (
            <Text key={i} color="gray" dimColor>{line}</Text>
          ))}
        </Box>
      )}
    </Box>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function UserMessage({ content }: { content: string }) {
  const lines = content.split("\n");
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box flexDirection="row" gap={1}>
        <Text bold color="green">❯</Text>
        <Text>{lines[0]}</Text>
      </Box>
      {lines.slice(1).map((line, i) => (
        <Box key={i} marginLeft={2}>
          <Text dimColor>{line}</Text>
        </Box>
      ))}
    </Box>
  );
}

function AssistantMessage({ content, costUSD, durationMs }: { content: string; costUSD?: number; durationMs?: number }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Markdown content={content} />
      {(costUSD != null && costUSD > 0) && (
        <Box marginTop={0}>
          <Text dimColor>
            {`  ~$${costUSD.toFixed(4)}`}
            {durationMs ? ` · ${(durationMs / 1000).toFixed(1)}s` : ""}
          </Text>
        </Box>
      )}
    </Box>
  );
}

function ToolUseBlock({ name, input, isRunning }: { name: string; input: unknown; isRunning?: boolean }) {
  const args = formatToolArgs(name, input);
  const color = toolColor(name);
  return (
    <Box flexDirection="row" marginBottom={0}>
      <Text color={color} bold>⏺ </Text>
      <Text bold color={color}>{name}</Text>
      <Text dimColor>{args}</Text>
      {isRunning && <Text dimColor> …</Text>}
    </Box>
  );
}

function ToolResultBlock({
  result,
  is_error,
}: {
  result: string;
  is_error: boolean;
}) {
  // Diff format
  const diffMatch = result.match(/^([\s\S]*?)\n__DIFF__\n([\s\S]*?)\n__END_DIFF__$/);
  if (diffMatch && !is_error) {
    const header = diffMatch[1]!.trim();
    const diffContent = diffMatch[2]!;
    const diffLines = diffContent.split("\n");
    const added = diffLines.filter((l) => l.startsWith("+")).length;
    const removed = diffLines.filter((l) => l.startsWith("-")).length;
    
    return (
      <Box flexDirection="column" marginLeft={2} marginBottom={1}>
        <Text dimColor>
          ⎿ {header}
          {added > 0 || removed > 0 ? (
            <Text>
              {"  "}
              <Text color="green">+{added}</Text>
              {" "}
              <Text color="red">-{removed}</Text>
            </Text>
          ) : null}
        </Text>
        <Box flexDirection="column" marginLeft={2}>
          {diffLines.map((line, i) => (
            <Text
              key={i}
              color={line.startsWith("+") ? "green" : line.startsWith("-") ? "red" : undefined}
              dimColor={!line.startsWith("+") && !line.startsWith("-")}
            >
              {line}
            </Text>
          ))}
        </Box>
      </Box>
    );
  }

  if (is_error) {
    return (
      <Box marginLeft={2} marginBottom={1}>
        <Text color="red">⎿ Error: {result.replace(/\n/g, " ")}</Text>
      </Box>
    );
  }

  const summary = resultSummary(result);
  return (
    <Box marginLeft={2} marginBottom={1}>
      <Text dimColor>⎿ {summary}</Text>
    </Box>
  );
}

// ── Render turn events (shared between live stream and history) ─────────────

function renderEvents(events: TurnEvent[], keyPrefix: string, opts?: { costUSD?: number; durationMs?: number }): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let i = 0;
  while (i < events.length) {
    const event = events[i]!;

    if (event.type === "thinking" && event.text) {
      nodes.push(<ThinkingBlock key={`${keyPrefix}-${i}`} text={event.text} />);
      i++;
      continue;
    }

    if (event.type === "text" && event.text) {
      const isLast = i === events.length - 1;
      nodes.push(
        <Box key={`${keyPrefix}-${i}`} flexDirection="column" marginBottom={1}>
          <Markdown content={event.text} />
          {isLast && opts?.costUSD != null && opts.costUSD > 0 && (
            <Text dimColor>
              {`  ~$${opts.costUSD.toFixed(4)}`}
              {opts.durationMs ? ` · ${(opts.durationMs / 1000).toFixed(1)}s` : ""}
            </Text>
          )}
        </Box>
      );
      i++;
      continue;
    }

    if (event.type === "tool_use") {
      const nextEvent = events[i + 1];
      const isRunning = !nextEvent || nextEvent.type !== "tool_result";
      nodes.push(
        <ToolUseBlock key={`${keyPrefix}-${i}`} name={event.name!} input={event.input} isRunning={isRunning} />
      );
      i++;
      continue;
    }

    if (event.type === "tool_result") {
      nodes.push(
        <ToolResultBlock key={`${keyPrefix}-${i}`} result={event.result ?? ""} is_error={event.is_error ?? false} />
      );
      i++;
      continue;
    }

    i++;
  }
  return nodes;
}

// ── Main component ─────────────────────────────────────────────────────────

export function Chat({ messages, turnEvents, status }: ChatProps) {
  return (
    <Box flexDirection="column">
      {/* Message history */}
      {messages.map((msg, i) => {
        if (msg.role === "user" && typeof msg.content === "string") {
          return <UserMessage key={`msg-${i}`} content={msg.content} />;
        }
        if (msg.role === "assistant") {
          // If we have saved turn events, render them (preserves tool calls in history)
          if (msg.events && msg.events.length > 0) {
            const nodes = renderEvents(msg.events, `msg-${i}`, { costUSD: msg.costUSD, durationMs: msg.durationMs });
            if (nodes.length === 0) return null;
            return <Box key={`msg-${i}`} flexDirection="column">{nodes}</Box>;
          }
          // Fallback: text-only (old sessions or no events)
          const text = typeof msg.content === "string" ? msg.content : "";
          if (!text.trim()) return null;
          return (
            <AssistantMessage
              key={`msg-${i}`}
              content={text}
              costUSD={msg.costUSD}
              durationMs={msg.durationMs}
            />
          );
        }
        return null;
      })}

      {/* Current turn: interleaved text + tool calls + results */}
      {turnEvents.length > 0 && (
        <Box flexDirection="column">
          {renderEvents(turnEvents, "te")}
        </Box>
      )}

      {/* Status label (e.g. while streaming) */}
      {status ? (
        <Box marginTop={0}>
          <Text dimColor>{status}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
