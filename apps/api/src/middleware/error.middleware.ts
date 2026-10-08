import { NextFunction, Request, Response } from "express";
import { env } from "../config/env";

export class ApiError extends Error {
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(statusCode: number, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.details = details;
  }

  static badRequest(message: string, details?: unknown): ApiError {
    return new ApiError(400, message, details);
  }

  static notFound(message = "Resource not found"): ApiError {
    return new ApiError(404, message);
  }
}

export const notFoundHandler = (req: Request, res: Response): void => {
  res.status(404).json({
    success: false,
    error: "NotFound",
    message: `Route ${req.method} ${req.originalUrl} does not exist`,
  });
};

export const errorHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  if (err instanceof ApiError) {
    res.status(err.statusCode).json({
      success: false,
      error: err.name,
      message: err.message,
      ...(err.details !== undefined ? { details: err.details } : {}),
    });
    return;
  }

  const errorWithStatus = err as { statusCode?: unknown; status?: unknown };
  const clientStatus =
    typeof errorWithStatus.statusCode === "number"
      ? errorWithStatus.statusCode
      : typeof errorWithStatus.status === "number"
        ? errorWithStatus.status
        : undefined;

  if (clientStatus !== undefined && clientStatus >= 400 && clientStatus < 500) {
    res.status(clientStatus).json({
      success: false,
      error: "BadRequest",
      message: err instanceof Error ? err.message : "Bad Request",
    });
    return;
  }

  const message = err instanceof Error ? err.message : "Internal Server Error";

  if (!env.isProduction) {
    console.error("[aegis-api] unhandled error:", err);
  }

  res.status(500).json({
    success: false,
    error: "InternalServerError",
    message: env.isProduction ? "Internal Server Error" : message,
  });
};
