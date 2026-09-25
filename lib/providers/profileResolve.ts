import type {
  ComfyModelProfile,
  ComfyProfileMode,
  ComfyProfileType,
} from "./types.ts";

export interface ResolveComfyProfileOpts {
  type: ComfyProfileType;
  requestedId?: string | null;
  mode?: ComfyProfileMode;
}

/**
 * Resolve a profile:
 * 1. id match of same type (and mode if provided)
 * 2. first compatible (type, then mode if provided)
 * 3. null
 */
export function resolveComfyProfile(
  profiles: ComfyModelProfile[],
  opts: ResolveComfyProfileOpts,
): ComfyModelProfile | null {
  const { type, requestedId, mode } = opts;
  if (requestedId) {
    const byId = profiles.find(
      (p) =>
        p.id === requestedId &&
        p.type === type &&
        (mode == null || p.mode === mode),
    );
    if (byId) return byId;
  }
  const compatible = profiles.filter(
    (p) => p.type === type && (mode == null || p.mode === mode),
  );
  return compatible[0] ?? null;
}

/**
 * Resolve Ollama chat model name:
 * 1. requested if in available list
 * 2. stored default if in list
 * 3. first available
 * 4. null
 */
export function resolveOllamaChatModel(
  requested: string | null | undefined,
  availableIds: string[],
  storedDefault: string | null | undefined,
): string | null {
  const list = availableIds.filter((id) => typeof id === "string" && id.trim());
  if (requested?.trim() && list.includes(requested.trim())) {
    return requested.trim();
  }
  if (storedDefault?.trim() && list.includes(storedDefault.trim())) {
    return storedDefault.trim();
  }
  return list[0] ?? null;
}
