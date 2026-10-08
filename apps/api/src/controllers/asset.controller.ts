import { asyncHandler } from "../middleware/async.middleware";
import { ApiError } from "../middleware/error.middleware";
import {
  createOfficialAsset,
  deleteOfficialAsset,
  getOfficialAsset,
  isOfficialAssetType,
  listOfficialAssets,
  OFFICIAL_ASSET_TYPES,
} from "../services/asset.service";
import { getBrandById } from "../services/brand.service";

const requireBrand = async (brandId: string): Promise<void> => {
  const brand = await getBrandById(brandId);
  if (!brand) {
    throw ApiError.notFound(`Brand not found: ${brandId}`);
  }
};

const parseAssetBody = (body: Record<string, unknown>): {
  type: (typeof OFFICIAL_ASSET_TYPES)[number];
  value: string;
} => {
  const rawType = body.type;
  if (typeof rawType !== "string" || rawType.trim() === "") {
    throw ApiError.badRequest("type is required");
  }

  const type = rawType.trim().toUpperCase();
  if (!isOfficialAssetType(type)) {
    throw ApiError.badRequest(
      `type must be one of: ${OFFICIAL_ASSET_TYPES.join(", ")}`,
    );
  }

  const rawValue = body.value;
  if (typeof rawValue !== "string") {
    throw ApiError.badRequest("value must be a string");
  }

  const value = rawValue.trim();
  if (value === "") {
    throw ApiError.badRequest("value is required and cannot be empty");
  }

  return { type, value };
};

export const createAssetHandler = asyncHandler(async (req, res) => {
  const input = parseAssetBody((req.body ?? {}) as Record<string, unknown>);

  await requireBrand(req.params.brandId);

  const asset = await createOfficialAsset(req.params.brandId, input);

  res.status(201).json({ success: true, data: asset });
});

export const listAssetsHandler = asyncHandler(async (req, res) => {
  await requireBrand(req.params.brandId);

  const assets = await listOfficialAssets(req.params.brandId);

  res.status(200).json({ success: true, count: assets.length, data: assets });
});

export const getAssetHandler = asyncHandler(async (req, res) => {
  await requireBrand(req.params.brandId);

  const asset = await getOfficialAsset(req.params.brandId, req.params.assetId);
  if (!asset) {
    throw ApiError.notFound(`Official asset not found: ${req.params.assetId}`);
  }

  res.status(200).json({ success: true, data: asset });
});

export const deleteAssetHandler = asyncHandler(async (req, res) => {
  await requireBrand(req.params.brandId);

  const asset = await deleteOfficialAsset(req.params.brandId, req.params.assetId);
  if (!asset) {
    throw ApiError.notFound(`Official asset not found: ${req.params.assetId}`);
  }

  res.status(200).json({ success: true, data: { id: asset.id, deleted: true } });
});
