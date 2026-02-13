import type { AgentType, Config } from "@/lib/types";

export type DiagnosticContext = "doctor" | "init" | "run";
export type DiagnosticSeverity = "ok" | "warning" | "error";
export type DiagnosticCategory = "environment" | "agents" | "config" | "git" | "tmux";
export type ModelCatalogSource = "dynamic" | "static" | "none";

export interface AgentModelInfo {
  model: string;
  provider?: string;
}

export interface AgentCapability {
  agent: AgentType;
  command: string;
  installed: boolean;
  modelCatalogSource: ModelCatalogSource;
  models: AgentModelInfo[];
  probeWarnings: string[];
}

export type AgentCapabilitiesMap = Record<AgentType, AgentCapability>;

export interface DiagnosticItem {
  id: string;
  category: DiagnosticCategory;
  title: string;
  severity: DiagnosticSeverity;
  summary: string;
  details?: string;
  remediation: string[];
  fixable?: boolean;
  context?: Record<string, string | boolean>;
}

export interface DiagnosticsReport {
  context: DiagnosticContext;
  items: DiagnosticItem[];
  hasErrors: boolean;
  hasWarnings: boolean;
  capabilitiesByAgent: AgentCapabilitiesMap;
  generatedAt: string;
  config: Config | null;
}
