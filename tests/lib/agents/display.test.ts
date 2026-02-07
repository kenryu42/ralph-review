import { describe, expect, test } from "bun:test";
import { getAgentDisplayInfo } from "@/lib/agents/display";

describe("getAgentDisplayInfo", () => {
  test("returns display labels and thinking for non-pi agent with model", () => {
    const info = getAgentDisplayInfo({
      agent: "codex",
      model: "gpt-5.2-codex",
      thinking: "high",
    });

    expect(info).toEqual({
      agentName: "Codex",
      modelName: "GPT-5.2 Codex",
      thinking: "high",
    });
  });

  test("returns default model and thinking for non-pi agent without model", () => {
    const info = getAgentDisplayInfo({
      agent: "claude",
    });

    expect(info).toEqual({
      agentName: "Claude",
      modelName: "Default",
      thinking: "Default",
    });
  });

  test("formats provider and model for pi settings", () => {
    const info = getAgentDisplayInfo({
      agent: "pi",
      provider: "openai",
      model: "gpt-5.2",
      thinking: "medium",
    });

    expect(info).toEqual({
      agentName: "Pi",
      modelName: "openai/gpt-5.2",
      thinking: "medium",
    });
  });
});
