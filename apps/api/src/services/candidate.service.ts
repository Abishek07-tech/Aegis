import type { AssetType, CandidateStatus } from "../config/constants";
import { prisma } from "../config/database";
import type { CandidateAsset, Prisma } from "../generated/prisma/client";

export interface CreateCandidateInput {
  type: AssetType;
  value: string;
  name?: string;
  description?: string;
  brandId?: string;
}

export interface CandidateFilters {
  status?: CandidateStatus;
  type?: AssetType;
  brandId?: string;
}

export const createCandidate = (
  input: CreateCandidateInput,
): Promise<CandidateAsset> =>
  prisma.candidateAsset.create({
    data: {
      type: input.type,
      value: input.value,
      name: input.name,
      description: input.description,
      brandId: input.brandId,
      status: "PENDING",
    },
  });

export const listCandidates = (
  filters: CandidateFilters,
): Promise<CandidateAsset[]> => {
  const where: Prisma.CandidateAssetWhereInput = {
    ...(filters.status !== undefined ? { status: filters.status } : {}),
    ...(filters.type !== undefined ? { type: filters.type } : {}),
    ...(filters.brandId !== undefined ? { brandId: filters.brandId } : {}),
  };

  return prisma.candidateAsset.findMany({
    where,
    orderBy: { createdAt: "desc" },
  });
};

export const getCandidateById = (id: string): Promise<CandidateAsset | null> =>
  prisma.candidateAsset.findUnique({ where: { id } });

export const updateCandidateStatus = (
  id: string,
  status: CandidateStatus,
): Promise<CandidateAsset> =>
  prisma.candidateAsset.update({ where: { id }, data: { status } });

export const deleteCandidateById = async (
  id: string,
): Promise<CandidateAsset | null> => {
  const existing = await prisma.candidateAsset.findUnique({ where: { id } });
  if (!existing) {
    return null;
  }

  await prisma.candidateAsset.delete({ where: { id } });
  return existing;
};
