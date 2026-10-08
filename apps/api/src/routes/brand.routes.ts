import { Router } from "express";
import {
  createBrandHandler,
  deleteBrandHandler,
  getBrandHandler,
  listBrandsHandler,
} from "../controllers/brand.controller";

export const brandRouter = Router();

brandRouter.post("/", createBrandHandler);
brandRouter.get("/", listBrandsHandler);
brandRouter.get("/:id", getBrandHandler);
brandRouter.delete("/:id", deleteBrandHandler);
