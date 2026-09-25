import type { StoredWorkflowConfig, TaskKind } from "./types";
import { TASK_KINDS } from "./types";
import * as guestDb from "../guest/db";
import {
  getComfyProfiles,
  profilesPublicSummary,
} from "./profiles";

export const DEFAULT_COMFYUI_URL = "http://host.docker.internal:8188";
export const DEFAULT_OLLAMA_URL = "http://host.docker.internal:11434";

const KEY_COMFYUI_URL = "comfyui_url";
const KEY_OLLAMA_URL = "ollama_url";
const KEY_OLLAMA_MODEL = "ollama_model";
const workflowKey = (kind: TaskKind) => `comfyui_workflow:${kind}`;

export {
  getComfyProfiles,
  setComfyProfiles,
  getComfyProfileById,
} from "./profiles";

export function getComfyUiUrl(): string {
  const stored = guestDb.getAppSetting(KEY_COMFYUI_URL);
  if (stored?.trim()) return stored.trim().replace(/\/$/, "");
  const env = process.env.COMFYUI_URL?.trim();
  return (env || DEFAULT_COMFYUI_URL).replace(/\/$/, "");
}

export function setComfyUiUrl(url: string): void {
  guestDb.setAppSetting(KEY_COMFYUI_URL, url.trim().replace(/\/$/, ""));
}

export function getOllamaUrl(): string {
  const stored = guestDb.getAppSetting(KEY_OLLAMA_URL);
  if (stored?.trim()) return stored.trim().replace(/\/$/, "");
  const env = process.env.OLLAMA_URL?.trim();
  return (env || DEFAULT_OLLAMA_URL).replace(/\/$/, "");
}

export function setOllamaUrl(url: string): void {
  guestDb.setAppSetting(KEY_OLLAMA_URL, url.trim().replace(/\/$/, ""));
}

export function getOllamaModel(): string | null {
  const v = guestDb.getAppSetting(KEY_OLLAMA_MODEL);
  return v?.trim() || null;
}

export function setOllamaModel(model: string): void {
  guestDb.setAppSetting(KEY_OLLAMA_MODEL, model.trim());
}

export function getWorkflowConfig(kind: TaskKind): StoredWorkflowConfig | null {
  const raw = guestDb.getAppSetting(workflowKey(kind));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredWorkflowConfig;
  } catch {
    return null;
  }
}

export function setWorkflowConfig(kind: TaskKind, config: StoredWorkflowConfig): void {
  guestDb.setAppSetting(workflowKey(kind), JSON.stringify(config));
}

export function deleteWorkflowConfig(kind: TaskKind): void {
  guestDb.deleteAppSetting(workflowKey(kind));
}

export function listWorkflowConfigs(): Partial<Record<TaskKind, StoredWorkflowConfig>> {
  const out: Partial<Record<TaskKind, StoredWorkflowConfig>> = {};
  for (const kind of TASK_KINDS) {
    const cfg = getWorkflowConfig(kind);
    if (cfg) out[kind] = cfg;
  }
  return out;
}

/** Public settings payload for the Settings UI (no secrets). */
export function getLocalProviderSettingsPublic(): {
  comfyuiUrl: string;
  ollamaUrl: string;
  ollamaModel: string | null;
  /** Migrated / user-defined ComfyUI profiles (ordered). */
  profiles: ReturnType<typeof profilesPublicSummary>;
  /** @deprecated Prefer profiles; kept for migration / tooling. */
  workflows: Partial<
    Record<
      TaskKind,
      { name: string; updatedAt: string; hasWorkflow: boolean; bindings: StoredWorkflowConfig["bindings"] }
    >
  >;
} {
  const workflows: ReturnType<typeof getLocalProviderSettingsPublic>["workflows"] = {};
  for (const kind of TASK_KINDS) {
    const cfg = getWorkflowConfig(kind);
    if (cfg) {
      workflows[kind] = {
        name: cfg.name,
        updatedAt: cfg.updatedAt,
        hasWorkflow: true,
        bindings: cfg.bindings,
      };
    }
  }
  const profiles = getComfyProfiles();
  return {
    comfyuiUrl: getComfyUiUrl(),
    ollamaUrl: getOllamaUrl(),
    ollamaModel: getOllamaModel(),
    profiles: profilesPublicSummary(profiles),
    workflows,
  };
}
