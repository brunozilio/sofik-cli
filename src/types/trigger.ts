// ── Trigger Types ──────────────────────────────────────────────────────────────

export type ConditionOperator =
  | "eq" | "neq"
  | "gt" | "gte" | "lt" | "lte"
  | "contains" | "startsWith" | "endsWith"
  | "in" | "notIn"
  | "exists" | "notExists"
  | "regex";

export interface Condition {
  field: string; // e.g. "payload.issue.labels[].name"
  operator: ConditionOperator;
  value?: unknown;
}

export type ConditionGroupOperator = "AND" | "OR";

export interface ConditionGroup {
  operator: ConditionGroupOperator;
  conditions: (Condition | ConditionGroup)[];
}
