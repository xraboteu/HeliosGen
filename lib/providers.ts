/**
 * Client-facing provider helpers. Cloud backends (Kie / Azure / Codex) were
 * removed — generation always goes through local ComfyUI / Ollama.
 */
export const LOCAL_PROVIDERS = [
  { id: "comfyui", label: "ComfyUI", capabilities: ["image", "video"] as const },
  { id: "ollama", label: "Ollama", capabilities: ["chat"] as const },
] as const;

export type LocalProviderId = (typeof LOCAL_PROVIDERS)[number]["id"];
