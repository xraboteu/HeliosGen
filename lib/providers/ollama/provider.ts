import type {
  JobSnapshot,
  Provider,
  ProviderModel,
  SubmitRequest,
  SubmitResult,
} from "../types";
import { ProviderError } from "../errors";
import { createOllamaClient, type OllamaClient } from "./client";

/**
 * Ollama is chat-only. submit/getJob/getResult are not used for generation jobs;
 * the assistant route calls the client stream helpers directly.
 */
export function createOllamaProvider(client?: OllamaClient): Provider {
  const c = client ?? createOllamaClient();

  return {
    id: "ollama",
    capabilities: ["chat"] as const,

    async isAvailable() {
      return c.isAvailable();
    },

    async listModels(): Promise<ProviderModel[]> {
      return c.listModels();
    },

    async submit(_request: SubmitRequest): Promise<SubmitResult> {
      void _request;
      throw new ProviderError(
        "invalid_request",
        "Ollama does not support image/video job submission",
      );
    },

    async getJob(_externalId: string): Promise<JobSnapshot> {
      void _externalId;
      throw new ProviderError("invalid_request", "Ollama does not track generation jobs");
    },

    async getResult(_externalId: string): Promise<JobSnapshot> {
      void _externalId;
      throw new ProviderError("invalid_request", "Ollama does not track generation jobs");
    },
  };
}

export { createOllamaClient, ollamaNdjsonToOpenAiSse } from "./client";
