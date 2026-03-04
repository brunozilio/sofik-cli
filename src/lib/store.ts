import { create } from "zustand";
import type { Message, AgentStatus, TurnEvent } from "./types.ts";
import type { PermissionMode } from "./permissions.ts";
import type { UsageStats } from "./providers/anthropic.ts";
import type { Session } from "./session.ts";
import type { AskUserRequest } from "../tools/askUser.ts";
import type { PlanApprovalRequest } from "../tools/planMode.ts";
import { getCurrentModel } from "./anthropic.ts";

interface PendingPermission {
  toolName: string;
  input: Record<string, unknown>;
  resolve: (allowed: boolean) => void;
}

interface AppState {
  // Messages
  messages: Message[];
  turnEvents: TurnEvent[];
  // Status
  status: AgentStatus;
  statusLabel: string;
  // Permissions
  permMode: PermissionMode;
  // Model
  currentModel: string;
  // Cost / usage
  sessionUsage: UsageStats;
  // UI Modals
  pendingPermission: PendingPermission | null;
  pendingQuestion: AskUserRequest | null;
  pendingPlanApproval: PlanApprovalRequest | null;
  showModelSelector: boolean;
  showSessionSelector: boolean;
  showIntegrationSelector: boolean;
  // System messages
  systemMessage: string | null;
  // Thinking
  thinkingBudget: number | undefined;

  // Actions
  setMessages: (msgs: Message[]) => void;
  appendMessage: (msg: Message) => void;
  setTurnEvents: (events: TurnEvent[]) => void;
  appendTurnEvent: (event: TurnEvent) => void;
  setStatus: (s: AgentStatus) => void;
  setStatusLabel: (l: string) => void;
  setPermMode: (mode: PermissionMode) => void;
  setCurrentModel: (m: string) => void;
  setSessionUsage: (u: UsageStats) => void;
  setPendingPermission: (p: PendingPermission | null) => void;
  setPendingQuestion: (q: AskUserRequest | null) => void;
  setPendingPlanApproval: (p: PlanApprovalRequest | null) => void;
  setShowModelSelector: (v: boolean) => void;
  setShowSessionSelector: (v: boolean) => void;
  setShowIntegrationSelector: (v: boolean) => void;
  setSystemMessage: (msg: string | null) => void;
  setThinkingBudget: (n: number | undefined) => void;
}

export const useAppStore = create<AppState>((set) => ({
  messages: [],
  turnEvents: [],
  status: "idle",
  statusLabel: "",
  permMode: "ask",
  currentModel: getCurrentModel(),
  sessionUsage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
  pendingPermission: null,
  pendingQuestion: null,
  pendingPlanApproval: null,
  showModelSelector: false,
  showSessionSelector: false,
  showIntegrationSelector: false,
  systemMessage: null,
  thinkingBudget: undefined,

  setMessages: (msgs) => set({ messages: msgs }),
  appendMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  setTurnEvents: (events) => set({ turnEvents: events }),
  appendTurnEvent: (event) => set((s) => ({ turnEvents: [...s.turnEvents, event] })),
  setStatus: (status) => set({ status }),
  setStatusLabel: (statusLabel) => set({ statusLabel }),
  setPermMode: (permMode) => set({ permMode }),
  setCurrentModel: (currentModel) => set({ currentModel }),
  setSessionUsage: (sessionUsage) => set({ sessionUsage }),
  setPendingPermission: (pendingPermission) => set({ pendingPermission }),
  setPendingQuestion: (pendingQuestion) => set({ pendingQuestion }),
  setPendingPlanApproval: (pendingPlanApproval) => set({ pendingPlanApproval }),
  setShowModelSelector: (showModelSelector) => set({ showModelSelector }),
  setShowSessionSelector: (showSessionSelector) => set({ showSessionSelector }),
  setShowIntegrationSelector: (showIntegrationSelector) => set({ showIntegrationSelector }),
  setSystemMessage: (systemMessage) => set({ systemMessage }),
  setThinkingBudget: (thinkingBudget) => set({ thinkingBudget }),
}));
