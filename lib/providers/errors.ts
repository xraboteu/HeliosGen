import type { JobStatus } from "./types";

export type ProviderErrorCode =
  | "unavailable"
  | "workflow_not_configured"
  | "upstream"
  | "timeout"
  | "invalid_request";

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly status: number;

  constructor(code: ProviderErrorCode, message: string, status = 400) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.status = status;
  }
}

export function isProviderError(e: unknown): e is ProviderError {
  return e instanceof ProviderError;
}

/** Map provider error to a client-safe JSON body (never includes secrets). */
export function providerErrorBody(e: ProviderError): {
  error: string;
  code: ProviderErrorCode;
} {
  return { error: e.message, code: e.code };
}

export function statusFromProvider(status: JobStatus): JobStatus {
  return status;
}
