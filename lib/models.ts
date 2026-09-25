export interface Model {
  id: string;
  label: string;
  desc: string;
}

export interface ModelGroup {
  label: string;
  models: Model[];
}

/**
 * Chat models come from Ollama (GET /api/settings/local-providers → ollamaModels).
 * This module only keeps the type surface; catalogs are empty by design.
 */
export const MODEL_GROUPS: ModelGroup[] = [
  {
    label: "Ollama",
    models: [],
  },
];

export const MODELS: Model[] = [];
export type ModelId = string;

export function ollamaModelGroups(
  models: Array<{ id: string; name: string }>,
): ModelGroup[] {
  return [
    {
      label: "Ollama",
      models: models.map((m) => ({
        id: m.id,
        label: m.name,
        desc: "Local",
      })),
    },
  ];
}
