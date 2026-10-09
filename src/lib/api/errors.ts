export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export interface ErrorEnvelope {
  error: { code: string; message: string; details?: unknown; correlationId?: string };
}

export function notFound(what: string): ApiError {
  return new ApiError(404, "NOT_FOUND", `${what} not found`);
}
