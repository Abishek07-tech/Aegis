import { Router } from "express";
import { assetRouter } from "./asset.routes";
import { brandRouter } from "./brand.routes";
import { candidateRouter } from "./candidate.routes";
import { healthRouter } from "./health.routes";
import { scanRouter } from "./scan.routes";

export const router = Router();

router.use("/health", healthRouter);
router.use("/api/brands/:brandId/assets", assetRouter);
router.use("/api/brands", brandRouter);
router.use("/api/candidates", candidateRouter);
router.use("/api/scans", scanRouter);
