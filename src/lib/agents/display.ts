import type { AgentSettings } from "@/lib/types";
import { getAgentDisplayName, getModelDisplayName } from "./models";

export interface AgentDisplayInfo {
  agentName: string;
  modelName: string;
  thinking: string;
}

export function getAgentDisplayInfo(settings: AgentSettings): AgentDisplayInfo {
  const agentName = getAgentDisplayName(settings.agent);
  const thinking = settings.thinking ?? "Default";

  if (settings.agent === "pi") {
    return {
      agentName,
      modelName: `${settings.provider}/${settings.model}`,
      thinking,
    };
  }

  return {
    agentName,
    modelName: settings.model ? getModelDisplayName(settings.agent, settings.model) : "Default",
    thinking,
  };
}
