import { prisma } from "../config/database";
import type { Brand } from "../generated/prisma/client";

export interface CreateBrandInput {
  name: string;
  logoUrl?: string;
  website?: string;
}

export const createBrand = (input: CreateBrandInput): Promise<Brand> =>
  prisma.brand.create({
    data: {
      name: input.name,
      logoUrl: input.logoUrl,
      website: input.website,
    },
  });

export const listBrands = (): Promise<Brand[]> =>
  prisma.brand.findMany({ orderBy: { createdAt: "desc" } });

export const getBrandById = (id: string): Promise<Brand | null> =>
  prisma.brand.findUnique({ where: { id } });

export const deleteBrandById = async (id: string): Promise<Brand | null> => {
  const existing = await prisma.brand.findUnique({ where: { id } });
  if (!existing) {
    return null;
  }

  await prisma.brand.delete({ where: { id } });
  return existing;
};
