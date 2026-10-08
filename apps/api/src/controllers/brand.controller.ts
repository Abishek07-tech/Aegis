import { asyncHandler } from "../middleware/async.middleware";
import { ApiError } from "../middleware/error.middleware";
import {
  createBrand,
  deleteBrandById,
  getBrandById,
  listBrands,
} from "../services/brand.service";

const readOptionalString = (value: unknown, field: string): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw ApiError.badRequest(`${field} must be a string`);
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
};

export const createBrandHandler = asyncHandler(async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;

  const rawName = body.name;
  if (typeof rawName !== "string" || rawName.trim() === "") {
    throw ApiError.badRequest("name is required and cannot be empty");
  }

  const brand = await createBrand({
    name: rawName.trim(),
    logoUrl: readOptionalString(body.logoUrl, "logoUrl"),
    website: readOptionalString(body.website, "website"),
  });

  res.status(201).json({ success: true, data: brand });
});

export const listBrandsHandler = asyncHandler(async (_req, res) => {
  const brands = await listBrands();

  res.status(200).json({ success: true, count: brands.length, data: brands });
});

export const getBrandHandler = asyncHandler(async (req, res) => {
  const brand = await getBrandById(req.params.id);
  if (!brand) {
    throw ApiError.notFound(`Brand not found: ${req.params.id}`);
  }

  res.status(200).json({ success: true, data: brand });
});

export const deleteBrandHandler = asyncHandler(async (req, res) => {
  const brand = await deleteBrandById(req.params.id);
  if (!brand) {
    throw ApiError.notFound(`Brand not found: ${req.params.id}`);
  }

  res.status(200).json({ success: true, data: { id: brand.id, deleted: true } });
});
