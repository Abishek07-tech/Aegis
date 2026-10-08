import { PNG } from "pngjs";
import * as jpeg from "jpeg-js";
import { type SimilarityLevel } from "../config/constants";
import type { Brand, CandidateAsset } from "../generated/prisma/client";
import { getSimilarityLevel } from "./similarity.service";
import { getBrandById } from "./brand.service";
import { getCandidateById } from "./candidate.service";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 5000;
const HASH_WIDTH = 8;
const HASH_HEIGHT = 8;

export interface DecodedImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export type LogoAnalysisFailureCode =
  | "CANDIDATE_NOT_FOUND"
  | "NO_TARGET_BRAND"
  | "BRAND_NOT_FOUND"
  | "NO_OFFICIAL_LOGO"
  | "NO_CANDIDATE_LOGO"
  | "LOGO_UNAVAILABLE";

export type LogoAnalysisComputeCode = Exclude<
  LogoAnalysisFailureCode,
  "CANDIDATE_NOT_FOUND" | "NO_TARGET_BRAND" | "BRAND_NOT_FOUND"
>;

export interface LogoAnalysisResult {
  candidateId: string;
  score: number;
  level: SimilarityLevel;
  isSimilar: boolean;
  reason: string;
}

export type LogoAnalysisOutcome =
  | { ok: true; data: LogoAnalysisResult }
  | { ok: false; code: LogoAnalysisFailureCode };

export type LogoAnalysisComputeOutcome =
  | { ok: true; data: LogoAnalysisResult }
  | { ok: false; code: LogoAnalysisComputeCode };

const REASONS: Record<SimilarityLevel, string> = {
  HIGH: "Candidate logo is highly similar to the official brand logo.",
  MEDIUM: "Candidate logo shows moderate visual similarity to the official brand logo.",
  LOW: "Candidate logo has low visual similarity to the official brand logo.",
};

export const decodeImage = (buffer: Buffer): DecodedImage | null => {
  if (!buffer || buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) {
    return null;
  }

  try {
    const png = PNG.sync.read(buffer);
    if (png.width > 0 && png.height > 0 && png.data.length > 0) {
      return { width: png.width, height: png.height, data: png.data };
    }
  } catch {
    // not a valid PNG — try JPEG
  }

  try {
    const decoded = jpeg.decode(buffer, { useTArray: true, formatAsRGBA: true });
    if (decoded.width > 0 && decoded.height > 0 && decoded.data.length > 0) {
      return { width: decoded.width, height: decoded.height, data: decoded.data };
    }
  } catch {
    // not a valid JPEG either
  }

  return null;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const grayAt = (image: DecodedImage, x: number, y: number): number => {
  const x0 = clamp(Math.floor(x), 0, image.width - 1);
  const y0 = clamp(Math.floor(y), 0, image.height - 1);
  const x1 = clamp(x0 + 1, 0, image.width - 1);
  const y1 = clamp(y0 + 1, 0, image.height - 1);
  const dx = clamp(x - x0, 0, 1);
  const dy = clamp(y - y0, 0, 1);

  const gray = (px: number, py: number): number => {
    const i = (py * image.width + px) * 4;
    return 0.299 * image.data[i] + 0.587 * image.data[i + 1] + 0.114 * image.data[i + 2];
  };

  const top = gray(x0, y0) * (1 - dx) + gray(x1, y0) * dx;
  const bottom = gray(x0, y1) * (1 - dx) + gray(x1, y1) * dx;
  return top * (1 - dy) + bottom * dy;
};

const toGrayGrid = (image: DecodedImage, gridWidth: number, gridHeight: number): number[] => {
  const grid: number[] = new Array<number>(gridWidth * gridHeight);

  for (let row = 0; row < gridHeight; row++) {
    const y = ((row + 0.5) * image.height) / gridHeight - 0.5;
    for (let col = 0; col < gridWidth; col++) {
      const x = ((col + 0.5) * image.width) / gridWidth - 0.5;
      grid[row * gridWidth + col] = grayAt(image, clamp(x, 0, image.width - 1), clamp(y, 0, image.height - 1));
    }
  }

  return grid;
};

export const computeDHash = (image: DecodedImage): number[] => {
  const grid = toGrayGrid(image, HASH_WIDTH + 1, HASH_HEIGHT);
  const gridWidth = HASH_WIDTH + 1;
  const bits: number[] = [];

  for (let row = 0; row < HASH_HEIGHT; row++) {
    for (let col = 0; col < HASH_WIDTH; col++) {
      const left = grid[row * gridWidth + col];
      const right = grid[row * gridWidth + col + 1];
      bits.push(right > left ? 1 : 0);
    }
  }

  return bits;
};

export const computeVerticalHash = (image: DecodedImage): number[] => {
  const grid = toGrayGrid(image, HASH_WIDTH + 1, HASH_HEIGHT);
  const gridWidth = HASH_WIDTH + 1;
  const bits: number[] = [];

  for (let row = 0; row < HASH_HEIGHT - 1; row++) {
    for (let col = 0; col < gridWidth; col++) {
      const top = grid[row * gridWidth + col];
      const bottom = grid[(row + 1) * gridWidth + col];
      bits.push(bottom > top ? 1 : 0);
    }
  }

  return bits;
};

export const hammingSimilarity = (a: number[], b: number[]): number => {
  if (a.length === 0 || a.length !== b.length) {
    return 0;
  }

  let differences = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      differences++;
    }
  }

  return 1 - differences / a.length;
};

export const pixelSimilarity = (imageA: DecodedImage, imageB: DecodedImage): number => {
  const gridA = toGrayGrid(imageA, 8, 8);
  const gridB = toGrayGrid(imageB, 8, 8);
  let difference = 0;

  for (let i = 0; i < gridA.length; i++) {
    difference += Math.abs(gridA[i] - gridB[i]);
  }

  return Math.max(0, 1 - difference / gridA.length / 255);
};

export const compareImageBuffers = (a: Buffer, b: Buffer): number | null => {
  const imageA = decodeImage(a);
  const imageB = decodeImage(b);
  if (!imageA || !imageB) {
    return null;
  }

  const hashA = [...computeDHash(imageA), ...computeVerticalHash(imageA)];
  const hashB = [...computeDHash(imageB), ...computeVerticalHash(imageB)];
  const hashScore = hammingSimilarity(hashA, hashB);
  const pixelScore = pixelSimilarity(imageA, imageB);
  const score = hashScore * pixelScore;

  return Math.round(Math.max(0, Math.min(1, score)) * 100) / 100;
};

export const loadImageReference = async (reference: string): Promise<Buffer | null> => {
  try {
    const response = await fetch(reference, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) {
      return null;
    }
    return buffer;
  } catch {
    return null;
  }
};

export const getOfficialLogoReference = (brand: Pick<Brand, "logoUrl">): string | undefined => {
  if (typeof brand.logoUrl === "string" && brand.logoUrl.trim() !== "") {
    return brand.logoUrl.trim();
  }
  return undefined;
};

export const getCandidateLogoReference = (
  _candidate: Pick<CandidateAsset, "name" | "description" | "value" | "type">,
): string | undefined => {
  // The current CandidateAsset model has no logo/image field.
  // candidate.value holds a handle/URL/app-id and name/description are text —
  // none of them is a logo reference, and treating one as such would fabricate
  // an image. A dedicated candidate logo field is required for real comparison.
  return undefined;
};

export const buildLogoAnalysisResult = (
  candidateId: string,
  score: number,
): LogoAnalysisResult => {
  const level = getSimilarityLevel(score);
  return {
    candidateId,
    score,
    level,
    isSimilar: level === "HIGH",
    reason: REASONS[level],
  };
};

export const computeCandidateLogoAnalysis = async (
  brand: Pick<Brand, "logoUrl">,
  candidate: Pick<CandidateAsset, "name" | "description" | "value" | "type">,
  candidateId: string,
): Promise<LogoAnalysisComputeOutcome> => {
  const officialReference = getOfficialLogoReference(brand);
  if (!officialReference) {
    return { ok: false, code: "NO_OFFICIAL_LOGO" };
  }

  const candidateReference = getCandidateLogoReference(candidate);
  if (!candidateReference) {
    return { ok: false, code: "NO_CANDIDATE_LOGO" };
  }

  const [officialImage, candidateImage] = await Promise.all([
    loadImageReference(officialReference),
    loadImageReference(candidateReference),
  ]);
  if (!officialImage || !candidateImage) {
    return { ok: false, code: "LOGO_UNAVAILABLE" };
  }

  const score = compareImageBuffers(officialImage, candidateImage);
  if (score === null) {
    return { ok: false, code: "LOGO_UNAVAILABLE" };
  }

  return { ok: true, data: buildLogoAnalysisResult(candidateId, score) };
};

export const analyzeCandidateLogo = async (
  candidateId: string,
): Promise<LogoAnalysisOutcome> => {
  const candidate = await getCandidateById(candidateId);
  if (!candidate) {
    return { ok: false, code: "CANDIDATE_NOT_FOUND" };
  }

  if (!candidate.brandId) {
    return { ok: false, code: "NO_TARGET_BRAND" };
  }

  const brand = await getBrandById(candidate.brandId);
  if (!brand) {
    return { ok: false, code: "BRAND_NOT_FOUND" };
  }

  return computeCandidateLogoAnalysis(brand, candidate, candidate.id);
};
