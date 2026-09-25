"use client";

import { useEffect, useState } from "react";
import {
  imageModelsFromProfiles,
  videoModelsFromProfiles,
  type ImageModel,
  type VideoModel,
} from "@/lib/modelConfig";
import type { ComfyModelProfile } from "@/lib/providers/types";

export function useComfyProfiles() {
  const [imageModels, setImageModels] = useState<ImageModel[]>([]);
  const [videoModels, setVideoModels] = useState<VideoModel[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/settings/local-providers");
        const data = await res.json();
        if (!res.ok || cancelled) return;
        const profiles = (data.profiles ?? []) as Array<
          Pick<ComfyModelProfile, "id" | "name" | "type" | "mode" | "bindings" | "ratios" | "durations">
        >;
        setImageModels(imageModelsFromProfiles(profiles));
        setVideoModels(videoModelsFromProfiles(profiles));
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { imageModels, videoModels, loaded };
}
