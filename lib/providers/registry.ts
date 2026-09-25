import type { Provider } from "./types";
import { ProviderError } from "./errors";
import { createComfyProvider } from "./comfyui/provider";
import { createOllamaProvider } from "./ollama/provider";
import type { ProviderCapability } from "./types";

let _comfy: Provider | null = null;
let _ollama: Provider | null = null;

export function getComfyProvider(): Provider {
  if (!_comfy) _comfy = createComfyProvider();
  return _comfy;
}

export function getOllamaProvider(): Provider {
  if (!_ollama) _ollama = createOllamaProvider();
  return _ollama;
}

/** Resolve the local provider for a capability. */
export function getProviderForCapability(capability: ProviderCapability): Provider {
  if (capability === "image" || capability === "video") {
    return getComfyProvider();
  }
  if (capability === "chat") {
    return getOllamaProvider();
  }
  throw new ProviderError("invalid_request", `Unknown capability: ${String(capability)}`);
}

/** Test helper — clear cached instances. */
export function resetProviderCache(): void {
  _comfy = null;
  _ollama = null;
}
