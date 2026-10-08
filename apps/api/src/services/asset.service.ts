import { ASSET_TYPES, isAssetType, type AssetType } from "../config/constants";
import { prisma } from "../config/database";
import type { OfficialAsset } from "../generated/prisma/client";

export const OFFICIAL_ASSET_TYPES = ASSET_TYPES;

export type OfficialAssetType = AssetType;

export const isOfficialAssetType = isAssetType;

export interface CreateOfficialAssetInput {
  type: OfficialAssetType;
  value: string;
}

export const createOfficialAsset = (
  brandId: string,
  input: CreateOfficialAssetInput,
): Promise<OfficialAsset> =>
  prisma.officialAsset.create({
    data: {
      brandId,
      type: input.type,
      value: input.value,
    },
  });

export const listOfficialAssets = (brandId: string): Promise<OfficialAsset[]> =>
  prisma.officialAsset.findMany({
    where: { brandId },
    orderBy: { createdAt: "desc" },
  });

export const getOfficialAsset = (
  brandId: string,
  assetId: string,
): Promise<OfficialAsset | null> =>
  prisma.officialAsset.findFirst({
    where: { id: assetId, brandId },
  });

export const deleteOfficialAsset = async (
  brandId: string,
  assetId: string,
): Promise<OfficialAsset | null> => {
  const asset = await getOfficialAsset(brandId, assetId);
  if (!asset) {
    return null;
  }

  await prisma.officialAsset.delete({ where: { id: asset.id } });
  return asset;
};
