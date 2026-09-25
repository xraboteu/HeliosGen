"use client";

import { useEffect, useState } from "react";
import { ollamaModelGroups, type Model, type ModelGroup } from "@/lib/models";
import { useChatSessionStore } from "@/lib/chatSessionStore";
import { useWorkflowStore } from "@/lib/store";

export interface OllamaChatModelsState {
  groups: ModelGroup[];
  models: Model[];
  loaded: boolean;
  available: boolean | null;
  empty: boolean;
  statusMessage: string | null;
}

/** Load Ollama chat models for pickers; rewrite preferredModel when stale. */
export function useOllamaChatModels(): OllamaChatModelsState {
  const [groups, setGroups] = useState<ModelGroup[]>([{ label: "Ollama", models: [] }]);
  const [loaded, setLoaded] = useState(false);
  const setOllamaAvailable = useWorkflowStore((s) => s.setOllamaAvailable);
  const ollamaAvailable = useWorkflowStore((s) => s.ollamaAvailable);
  const preferredModel = useChatSessionStore((s) => s.preferredModel);
  const setPreferredModel = useChatSessionStore((s) => s.setPreferredModel);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/settings/local-providers");
        const data = await res.json();
        if (cancelled) return;
        const ok = !!data.status?.ollama;
        setOllamaAvailable(ok);
        const listed = (data.ollamaModels ?? []) as Array<{ id: string; name: string }>;
        const nextGroups = ollamaModelGroups(listed);
        setGroups(nextGroups);
        const ids = listed.map((m) => m.id);
        const storedDefault =
          typeof data.ollamaModel === "string" ? data.ollamaModel : null;
        const resolved =
          (preferredModel && ids.includes(preferredModel) && preferredModel) ||
          (storedDefault && ids.includes(storedDefault) && storedDefault) ||
          ids[0] ||
          "";
        if (resolved && resolved !== preferredModel) {
          setPreferredModel(resolved);
        }
        setLoaded(true);
      } catch {
        if (!cancelled) {
          setOllamaAvailable(false);
          setLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on mount
  }, []);

  const models = groups.flatMap((g) => g.models);
  const empty = loaded && models.length === 0;
  const available = ollamaAvailable;

  let statusMessage: string | null = null;
  if (loaded && available === false) {
    statusMessage = "Ollama is unreachable — check Settings → Local providers.";
  } else if (empty) {
    statusMessage = "No models installed — run ollama pull <model>, then refresh.";
  }

  return { groups, models, loaded, available, empty, statusMessage };
}
