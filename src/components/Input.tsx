import React, { useState, useMemo, useEffect, useRef } from "react";
import { Box, Text, useInput } from "ink";
import fs from "fs";
import os from "os";
import path from "path";
import type { SlashCommand, CommandArgs, CommandArg } from "../lib/commands.ts";

function resolveArgs(args: CommandArgs | undefined): CommandArg[] {
  if (!args) return [];
  return typeof args === "function" ? args() : args;
}

const MAX_SUGGESTIONS = 8;

const HISTORY_PATH = path.join(os.homedir(), ".sofik", "input_history.json");
const MAX_HISTORY = 200;

function loadHistory(): string[] {
  try {
    return JSON.parse(fs.readFileSync(HISTORY_PATH, "utf-8")) as string[];
  } catch {
    return [];
  }
}

function saveHistory(history: string[]): void {
  try {
    fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
    fs.writeFileSync(HISTORY_PATH, JSON.stringify(history.slice(-MAX_HISTORY)), "utf-8");
  } catch { /* ignore */ }
}

/** Find the start index of the word before the cursor. */
function wordStartBefore(str: string, pos: number): number {
  let i = pos - 1;
  while (i > 0 && str[i - 1] !== " " && str[i - 1] !== "\n") i--;
  return i;
}

/** Find the end index of the word after the cursor (exclusive). */
function wordEndAfter(str: string, pos: number): number {
  let i = pos;
  while (i < str.length && str[i] !== " " && str[i] !== "\n") i++;
  return i;
}

interface InputProps {
  onSubmit: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  commands?: SlashCommand[];
}

export function Input({ onSubmit, disabled, placeholder, commands = [] }: InputProps) {
  const [value, setValue] = useState("");
  const [cursorPos, setCursorPos] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [windowStart, setWindowStart] = useState(0);
  const suppressResetRef = useRef(false); // prevent useEffect from resetting during Tab cycle
  const [history, setHistory] = useState<string[]>(() => loadHistory());
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [savedInput, setSavedInput] = useState("");
  // Kill ring (single item for Ctrl+K/W yank)
  const killRingRef = useRef<string>("");

  const suggestions = useMemo(() => {
    if (!value.startsWith("/")) return [];
    const query = value.slice(1).toLowerCase();

    const spaceIdx = query.indexOf(" ");
    if (spaceIdx !== -1) {
      // Subcommand mode: e.g. "/tasks c" → find "tasks" and filter its subcommands
      const cmdName = query.slice(0, spaceIdx);
      const rest = query.slice(spaceIdx + 1);
      const parentCmd = commands.find((c) => c.name === cmdName);
      if (parentCmd?.subcommands?.length) {
        const secondSpaceIdx = rest.indexOf(" ");
        if (secondSpaceIdx !== -1) {
          // Arg mode: e.g. "/integration connect gi" or "/tasks cancel ab12"
          const subName = rest.slice(0, secondSpaceIdx);
          const argQuery = rest.slice(secondSpaceIdx + 1);
          const subCmd = parentCmd.subcommands.find((sc) => sc.name === subName);
          const args = resolveArgs(subCmd?.args);
          if (args.length) {
            return args
              .filter((a) => a.name.startsWith(argQuery))
              .map((a) => ({ name: `${cmdName} ${subName} ${a.name}`, description: a.description ?? "" }));
          }
          return [];
        }
        return parentCmd.subcommands
          .filter((sc) => sc.name.startsWith(rest))
          .map((sc) => ({ name: `${cmdName} ${sc.name}`, description: sc.description }));
      }

      // Top-level command with direct args: e.g. "/model claude-s"
      if (parentCmd?.args) {
        return resolveArgs(parentCmd.args)
          .filter((a) => a.name.startsWith(rest))
          .map((a) => ({ name: `${cmdName} ${a.name}`, description: a.description ?? "" }));
      }

      return [];
    }

    return commands.filter((cmd) => cmd.name.startsWith(query));
  }, [value, commands]);

  // Reset window + selection on every keystroke (suppressed during Tab cycling)
  useEffect(() => {
    if (suppressResetRef.current) {
      suppressResetRef.current = false;
      return;
    }
    setSelectedIndex(suggestions.length > 0 ? 0 : -1);
    setWindowStart(0);
  }, [value]);

  const visible = suggestions.slice(windowStart, windowStart + MAX_SUGGESTIONS);
  const aboveCount = windowStart;
  const belowCount = Math.max(0, suggestions.length - windowStart - MAX_SUGGESTIONS);

  // Auto-submit queued value when transitioning from disabled → enabled
  const prevDisabledRef = useRef(disabled);
  useEffect(() => {
    if (prevDisabledRef.current && !disabled && value.trim()) {
      const trimmed = value.trim();
      setValue("");
      setCursorPos(0);
      setHistoryIdx(-1);
      onSubmit(trimmed);
    }
    prevDisabledRef.current = disabled;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);

  useInput(
    (input, key) => {
      // ── Suggestion navigation ──────────────────────────────────────────────
      if (suggestions.length > 0) {
        if (key.upArrow) {
          setSelectedIndex((i) => {
            const next = Math.max(0, i - 1);
            setWindowStart((w) => Math.min(w, next));
            return next;
          });
          return;
        }
        if (key.downArrow) {
          setSelectedIndex((i) => {
            const next = Math.min(suggestions.length - 1, i + 1);
            setWindowStart((w) => {
              const maxStart = Math.max(0, suggestions.length - MAX_SUGGESTIONS);
              return Math.min(maxStart, Math.max(w, next - MAX_SUGGESTIONS + 1));
            });
            return next;
          });
          return;
        }
        if (key.tab) {
          if (suggestions.length === 0) return;
          // Tab → next, Shift+Tab → previous (wraps around)
          const delta = key.shift ? -1 : 1;
          const next = (selectedIndex + delta + suggestions.length) % suggestions.length;
          const newWindowStart = (() => {
            if (next < windowStart) return next;
            if (next >= windowStart + MAX_SUGGESTIONS) return next - MAX_SUGGESTIONS + 1;
            return windowStart;
          })();
          // Fill in the command without triggering the reset effect
          suppressResetRef.current = true;
          const newVal = `/${suggestions[next]!.name} `;
          setValue(newVal);
          setCursorPos(newVal.length);
          setSelectedIndex(next);
          setWindowStart(newWindowStart);
          return;
        }
        if (key.escape) {
          // Dismiss suggestions without submitting
          setValue("");
          setCursorPos(0);
          return;
        }
        if (key.return) {
          // Enter: run the highlighted command immediately
          if (selectedIndex >= 0) {
            const cmd = suggestions[selectedIndex]!.name;
            setValue("");
            setCursorPos(0);
            onSubmit(`/${cmd}`);
            return;
          }
          // No selection → fall through to normal submit
        }
      }

      // ── History navigation (when no suggestions) ───────────────────────────
      if (suggestions.length === 0) {
        if (key.upArrow && history.length > 0) {
          if (historyIdx === -1) {
            setSavedInput(value);
            const newIdx = history.length - 1;
            setHistoryIdx(newIdx);
            const newVal = history[newIdx] ?? "";
            setValue(newVal);
            setCursorPos(newVal.length);
          } else if (historyIdx > 0) {
            const newIdx = historyIdx - 1;
            setHistoryIdx(newIdx);
            const newVal = history[newIdx] ?? "";
            setValue(newVal);
            setCursorPos(newVal.length);
          }
          return;
        }
        if (key.downArrow) {
          if (historyIdx === -1) return;
          if (historyIdx < history.length - 1) {
            const newIdx = historyIdx + 1;
            setHistoryIdx(newIdx);
            const newVal = history[newIdx] ?? "";
            setValue(newVal);
            setCursorPos(newVal.length);
          } else {
            setHistoryIdx(-1);
            setValue(savedInput);
            setCursorPos(savedInput.length);
          }
          return;
        }
      }

      // ── Normal input ───────────────────────────────────────────────────────
      // Shift+Enter: insert newline at cursor position
      if (key.return && key.shift) {
        if (historyIdx !== -1) setHistoryIdx(-1);
        setValue((v) => v.slice(0, cursorPos) + "\n" + v.slice(cursorPos));
        setCursorPos((p) => p + 1);
        return;
      }

      if (key.return) {
        if (disabled) return; // keep value queued; auto-submits when agent finishes
        const trimmed = value.trim();
        if (trimmed) {
          // Save to history (dedup and cap at MAX_HISTORY)
          const newHistory = [...history.filter((h) => h !== trimmed), trimmed].slice(-MAX_HISTORY);
          setHistory(newHistory);
          saveHistory(newHistory);
          setHistoryIdx(-1);
          setSavedInput("");
          setValue("");
          setCursorPos(0);
          onSubmit(trimmed);
        }
        return;
      }

      if (key.backspace || key.delete) {
        if (cursorPos > 0) {
          setValue((v) => v.slice(0, cursorPos - 1) + v.slice(cursorPos));
          setCursorPos((p) => p - 1);
        }
        return;
      }

      if (key.leftArrow)  { setCursorPos((p) => Math.max(0, p - 1)); return; }
      if (key.rightArrow) { setCursorPos((p) => Math.min(value.length, p + 1)); return; }

      if (key.ctrl && input === "c") { process.exit(0); }
      if (key.ctrl && input === "a") { setCursorPos(0); return; }
      if (key.ctrl && input === "e") { setCursorPos(value.length); return; }
      if (key.ctrl && input === "u") { setValue(""); setCursorPos(0); return; }

      // Ctrl+B / Ctrl+F: move one char (like left/right arrows)
      if (key.ctrl && input === "b") { setCursorPos((p) => Math.max(0, p - 1)); return; }
      if (key.ctrl && input === "f") { setCursorPos((p) => Math.min(value.length, p + 1)); return; }

      // Ctrl+D: delete char forward
      if (key.ctrl && input === "d") {
        if (cursorPos < value.length) {
          setValue((v) => v.slice(0, cursorPos) + v.slice(cursorPos + 1));
        }
        return;
      }

      // Ctrl+K: kill to end of line (save to kill ring)
      if (key.ctrl && input === "k") {
        killRingRef.current = value.slice(cursorPos);
        setValue((v) => v.slice(0, cursorPos));
        return;
      }

      // Ctrl+W: delete word before cursor (save to kill ring)
      if (key.ctrl && input === "w") {
        const wordStart = wordStartBefore(value, cursorPos);
        killRingRef.current = value.slice(wordStart, cursorPos);
        setValue((v) => v.slice(0, wordStart) + v.slice(cursorPos));
        setCursorPos(wordStart);
        return;
      }

      // Ctrl+Y: yank (paste kill ring)
      if (key.ctrl && input === "y") {
        const yanked = killRingRef.current;
        if (yanked) {
          setValue((v) => v.slice(0, cursorPos) + yanked + v.slice(cursorPos));
          setCursorPos((p) => p + yanked.length);
        }
        return;
      }

      // Alt+B: move to start of previous word
      if (key.meta && input === "b") {
        const ws = wordStartBefore(value, cursorPos);
        setCursorPos(ws);
        return;
      }

      // Alt+F: move to end of next word
      if (key.meta && input === "f") {
        const we = wordEndAfter(value, cursorPos);
        setCursorPos(we);
        return;
      }

      if (!key.ctrl && !key.meta && input) {
        if (historyIdx !== -1) setHistoryIdx(-1);

        // Paste detection: multiple chars arriving in one event = paste
        if (input.length > 3) {
          // Insert all at once without char-by-char processing
          setValue((v) => v.slice(0, cursorPos) + input + v.slice(cursorPos));
          setCursorPos((p) => p + input.length);
          return;
        }

        setValue((v) => v.slice(0, cursorPos) + input + v.slice(cursorPos));
        setCursorPos((p) => p + input.length);
      }
    },
    { isActive: true }
  );

  // Multiline cursor: find which line/col the cursor is on
  const allLines = value.split("\n");
  let remaining = cursorPos;
  let cursorLine = 0;
  let cursorCol = 0;
  for (let i = 0; i < allLines.length; i++) {
    if (remaining <= allLines[i]!.length) {
      cursorLine = i;
      cursorCol = remaining;
      break;
    }
    remaining -= allLines[i]!.length + 1; // +1 for the \n
  }

  return (
    <Box flexDirection="column">
      {/* Suggestion list — appears above the input box */}
      {suggestions.length > 0 && (
        <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} marginBottom={0}>
          {aboveCount > 0 && (
            <Text dimColor>{`  ↑ ${aboveCount} acima`}</Text>
          )}
          {visible.map((cmd, i) => {
            const isSelected = windowStart + i === selectedIndex;
            return (
              <Box key={cmd.name}>
                <Text bold={isSelected} inverse={isSelected}>
                  {`/${cmd.name}`}
                </Text>
                <Text dimColor>{`  ${cmd.description}`}</Text>
              </Box>
            );
          })}
          {belowCount > 0 && (
            <Text dimColor>{`  ↓ ${belowCount} abaixo`}</Text>
          )}
        </Box>
      )}

      {/* Input field */}
      {disabled && !value ? (
        <Box borderStyle="round" borderColor="gray" paddingX={1}>
          <Text dimColor>{placeholder ?? "Aguardando…"}</Text>
        </Box>
      ) : (
        <Box borderStyle="round" borderColor={disabled ? "yellow" : "green"} paddingX={1} flexDirection="column">
          {allLines.map((line, i) => {
            const prefix = i === 0
              ? <Text color={disabled ? "yellow" : "green"}>{disabled ? "⏳ " : "❯ "}</Text>
              : <Text>{"  "}</Text>;
            if (!disabled && i === cursorLine) {
              const lineBefore = line.slice(0, cursorCol);
              const lineCursor = line[cursorCol] ?? " ";
              const lineAfter  = line.slice(cursorCol + 1);
              return (
                <Box key={i}>
                  {prefix}
                  <Text>{lineBefore}</Text>
                  <Text backgroundColor="white" color="black">{lineCursor}</Text>
                  <Text>{lineAfter}</Text>
                </Box>
              );
            }
            return (
              <Box key={i}>
                {prefix}
                <Text dimColor={disabled}>{line}</Text>
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
