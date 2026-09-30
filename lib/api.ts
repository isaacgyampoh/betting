import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

export type ApiErrorBody = { error: { code: string; message: string; details?: unknown } };

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ data }, init);
}

export function fail(error: AppError) {
  const body: ApiErrorBody = {
    error: { code: error.code, message: error.message, details: error.details },
  };
  return NextResponse.json(body, { status: error.status });
}

type Handler<C> = (req: NextRequest, ctx: C) => Promise<Response>;

/** Wraps a route handler: AppErrors become clean JSON, anything else is logged and hidden. */
export function route<C>(handler: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      if (err instanceof AppError) {
        if (err.status >= 500) logger.error("api.app_error", { path: req.nextUrl.pathname, err });
        return fail(err);
      }
      logger.error("api.unhandled", { path: req.nextUrl.pathname, method: req.method, err });
      return fail(new AppError("INTERNAL", "Something went wrong. Please try again."));
    }
  };
}

/** Parses a JSON body with a Zod schema, throwing a 400 AppError on failure. */
export async function parseBody<S extends z.ZodType>(req: NextRequest, schema: S): Promise<z.infer<S>> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw new AppError("BAD_REQUEST", "Request body must be valid JSON.");
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    throw new AppError("BAD_REQUEST", "Invalid request.", { details: z.flattenError(result.error) });
  }
  return result.data;
}
