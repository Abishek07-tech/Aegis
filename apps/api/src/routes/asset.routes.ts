import { Router } from "express";
import {
  createAssetHandler,
  deleteAssetHandler,
  getAssetHandler,
  listAssetsHandler,
} from "../controllers/asset.controller";

export const assetRouter = Router({ mergeParams: true });

assetRouter.post("/", createAssetHandler);
assetRouter.get("/", listAssetsHandler);
assetRouter.get("/:assetId", getAssetHandler);
assetRouter.delete("/:assetId", deleteAssetHandler);
