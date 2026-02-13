import type { AgentCapabilitiesMap } from "@/lib/diagnostics/types";
import type { Config } from "@/lib/types";

export function createCapabilities(): AgentCapabilitiesMap {
  return {
    codex: {
      agent: "codex",
      command: "codex",
      installed: true,
      modelCatalogSource: "static",
      models: [{ model: "gpt-5.3-codex" }],
      probeWarnings: [],
    },
    claude: {
      agent: "claude",
      command: "claude",
      installed: true,
      modelCatalogSource: "static",
      models: [{ model: "claude-opus-4-6" }],
      probeWarnings: [],
    },
    droid: {
      agent: "droid",
      command: "droid",
      installed: true,
      modelCatalogSource: "static",
      models: [{ model: "gpt-5.2-codex" }],
      probeWarnings: [],
    },
    gemini: {
      agent: "gemini",
      command: "gemini",
      installed: true,
      modelCatalogSource: "static",
      models: [{ model: "gemini-3-pro-preview" }],
      probeWarnings: [],
    },
    opencode: {
      agent: "opencode",
      command: "opencode",
      installed: true,
      modelCatalogSource: "dynamic",
      models: [{ model: "gpt-5.2-codex" }],
      probeWarnings: [],
    },
    pi: {
      agent: "pi",
      command: "pi",
      installed: true,
      modelCatalogSource: "dynamic",
      models: [{ provider: "anthropic", model: "claude-opus-4-6" }],
      probeWarnings: [],
    },
  };
}

export function createConfig(): Config {
  return {
    $schema:
      "https://raw.githubusercontent.com/kenryu42/ralph-review/main/assets/ralph-review.schema.json",
    version: 1,
    reviewer: {
      agent: "codex",
      model: "gpt-5.3-codex",
    },
    fixer: {
      agent: "claude",
      model: "claude-opus-4-6",
    },
    "code-simplifier": {
      agent: "droid",
      model: "gpt-5.2-codex",
    },
    maxIterations: 5,
    iterationTimeout: 1800000,
    defaultReview: {
      type: "uncommitted",
    },
    notifications: {
      sound: {
        enabled: false,
      },
    },
  };
}
