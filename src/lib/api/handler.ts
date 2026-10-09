import { uuidv7 } from "uuidv7";
import { ZodError, type ZodType } from "zod";
import { getAppContext, type AppContext } from "@/lib/app-context";
import { getSession } from "@/lib/auth/session";
import type { Logger } from "@/lib/log";
import type { Session } from "@/types";
import { ApiError, type ErrorEnvelope } from "./errors";

export interface HandlerCtx {
  app: AppContext;
  session: Session | null;
  params: Record<string, string>;
  correlationId: string;
  log: Logger;
  url: URL;
}

export type RouteHandler = (req: Request, ctx: HandlerCtx) => Promise<Response>;
export type NextRouteContext = { params: Promise<Record<string, string>> };

export function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { ...init, headers });
}

export function errorResponse(status: number, code: string, message: string, details?: unknown, correlationId?: string): Response {
  const body: ErrorEnvelope = { error: { code, message, ...(details !== undefined ? { details } : {}), ...(correlationId ? { correlationId } : {}) } };
  return json(body, { status });
}

/** Parses URLSearchParams through a zod schema; throws a 400 ApiError on failure. */
export function parseQuery<T>(url: URL, schema: ZodType<T>): T {
  const obj: Record<string, string> = {};
  url.searchParams.forEach((v, k) => {
    obj[k] = v;
  });
  const r = schema.safeParse(obj);
  if (!r.success) throw new ApiError(400, "VALIDATION_ERROR", "invalid query parameters", r.error.issues);
  return r.data;
}

export async function parseJsonBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown = {};
  const text = await req.text();
  if (text.trim() !== "") {
    try {
      raw = JSON.parse(text);
    } catch {
      throw new ApiError(400, "INVALID_JSON", "request body is not valid JSON");
    }
  }
  const r = schema.safeParse(raw);
  if (!r.success) throw new ApiError(400, "VALIDATION_ERROR", "invalid request body", r.error.issues);
  return r.data;
}

/**
 * Wraps a route handler with correlation id, session resolution, consistent error envelope and
 * structured request logging (architecture section 11 / 14).
 */
export function withApi(handler: RouteHandler) {
  return async (req: Request, routeCtx: NextRouteContext): Promise<Response> => {
    const started = Date.now();
    const correlationId = req.headers.get("x-correlation-id")?.slice(0, 64) || uuidv7();
    const url = new URL(req.url);
    let log: Logger | null = null;
    let status = 500;
    try {
      const app = await getAppContext();
      log = app.logger.child({ correlationId, method: req.method, path: url.pathname });
      const params = routeCtx ? ((await routeCtx.params) ?? {}) : {};
      const session = await getSession(req);
      const res = await handler(req, { app, session, params, correlationId, log, url });
      status = res.status;
      res.headers.set("x-correlation-id", correlationId);
      return res;
    } catch (err) {
      let res: Response;
      if (err instanceof ApiError) {
        res = errorResponse(err.status, err.code, err.message, err.details, correlationId);
      } else if (err instanceof ZodError) {
        res = errorResponse(400, "VALIDATION_ERROR", "validation failed", err.issues, correlationId);
      } else {
        if (log) log.error({ err, correlationId }, "unhandled API error");
        else console.error("unhandled API error", correlationId, err);
        res = errorResponse(500, "INTERNAL_ERROR", "internal error", undefined, correlationId);
      }
      status = res.status;
      res.headers.set("x-correlation-id", correlationId);
      return res;
    } finally {
      log?.info({ status, durationMs: Date.now() - started }, "request");
    }
  };
}
