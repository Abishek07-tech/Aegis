import { asyncHandler } from "../middleware/async.middleware";
import { ApiError } from "../middleware/error.middleware";
import { prisma } from "../config/database";
import { getBrandById } from "../services/brand.service";
import { runCollection } from "../services/collection.service";

let scanCreationInProgress = false;
let lastScanStartedAt = 0;
const SCAN_START_COOLDOWN_MS = 10_000;

export const startScanHandler = asyncHandler(async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const scope = typeof body.scope === "string" ? body.scope.trim() : "authorized-inventory";
  if (scope.length < 1 || scope.length > 100) throw ApiError.badRequest("scope must be between 1 and 100 characters");
  const brandId = typeof body.brandId === "string" && body.brandId.trim() ? body.brandId.trim() : undefined;
  if (brandId && !(await getBrandById(brandId))) throw ApiError.notFound(`Brand not found: ${brandId}`);
  if (scanCreationInProgress) throw new ApiError(409, "A scan is already being started");
  if (Date.now() - lastScanStartedAt < SCAN_START_COOLDOWN_MS) {
    throw new ApiError(429, "Scan start rate limit exceeded; retry shortly");
  }
  scanCreationInProgress = true;
  let job;
  try {
    const active = await prisma.scanJob.findFirst({ where: { status: "RUNNING" } });
    if (active) throw new ApiError(409, "A scan is already running", { scanId: active.id });
    job = await prisma.scanJob.create({ data: { scope, brandId, provider: "searxng-compatible" } });
    lastScanStartedAt = Date.now();
  } finally {
    scanCreationInProgress = false;
  }
  void runCollection(job.id, brandId).catch(async (error: unknown) => {
    await prisma.scanJob.update({ where: { id: job.id }, data: { status: "FAILED", progress: 100, completedAt: new Date(), errorMessage: error instanceof Error ? error.message : "Collection failed" } }).catch(() => undefined);
  });
  res.status(202).json({ success: true, data: job });
});

export const getScanHandler = asyncHandler(async (req, res) => {
  const job = await prisma.scanJob.findUnique({ where: { id: req.params.id } });
  if (!job) throw ApiError.notFound(`Scan job not found: ${req.params.id}`);
  res.json({ success: true, data: job });
});
