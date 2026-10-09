import { NextFunction, Request, Response } from "express";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, RateLimitEntry>();

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 10;

export const aiAnalysisRateLimit = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const key = req.ip ?? "unknown";
  const now = Date.now();
  const entry = buckets.get(key);

  if (!entry || entry.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    next();
    return;
  }

  if (entry.count >= MAX_REQUESTS) {
    res.status(429).json({
      success: false,
      error: "RateLimitExceeded",
      message: "AI analysis rate limit exceeded; retry shortly",
    });
    return;
  }

  entry.count++;
  next();
};

export const resetRateLimitBuckets = (): void => {
  buckets.clear();
};
