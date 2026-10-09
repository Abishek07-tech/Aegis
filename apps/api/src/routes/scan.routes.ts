import { Router } from "express";
import { getScanHandler, startScanHandler } from "../controllers/scan.controller";
export const scanRouter = Router();
scanRouter.post("/", startScanHandler);
scanRouter.get("/:id", getScanHandler);
