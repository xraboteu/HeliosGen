/**
 * Pure ComfyUI HTTP helpers (injectable fetch) — safe for node:test without path aliases.
 */
import { ProviderError } from "../errors.ts";

export type FetchLike = typeof fetch;

export async function comfyIsAvailable(
  baseUrl: string,
  fetchFn: FetchLike = fetch,
): Promise<boolean> {
  try {
    const res = await fetchFn(`${baseUrl.replace(/\/$/, "")}/system_stats`, {
      method: "GET",
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function comfySubmitPrompt(
  baseUrl: string,
  workflow: Record<string, unknown>,
  clientId: string,
  fetchFn: FetchLike = fetch,
): Promise<string> {
  const res = await fetchFn(`${baseUrl.replace(/\/$/, "")}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow, client_id: clientId }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new ProviderError("upstream", `ComfyUI rejected the prompt (${res.status})`, 502);
  }
  let json: { prompt_id?: string; error?: unknown; node_errors?: unknown };
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    throw new ProviderError("upstream", "ComfyUI returned non-JSON from /prompt", 502);
  }
  if (json.error || (json.node_errors && Object.keys(json.node_errors as object).length > 0)) {
    throw new ProviderError("upstream", "ComfyUI reported node errors for this workflow", 502);
  }
  if (!json.prompt_id) {
    throw new ProviderError("upstream", "ComfyUI did not return a prompt_id", 502);
  }
  return json.prompt_id;
}
