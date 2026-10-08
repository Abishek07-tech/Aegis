import { SIMILARITY_THRESHOLDS, type SimilarityLevel } from "../config/constants";

const NORMALIZE_PATTERN = /[@\s_\-.]/g;

export const normalizeText = (input: string): string =>
  input.toLowerCase().replace(NORMALIZE_PATTERN, "");

export const tokenizeText = (input: string): string[] => {
  const words = input.toLowerCase().split(/\s+/);
  const tokens: string[] = [];

  for (const word of words) {
    const token = word.replace(/[^\p{L}\p{N}]+/gu, "");
    if (token !== "") {
      tokens.push(token);
    }
  }

  return tokens;
};

export const levenshteinDistance = (a: string, b: string): number => {
  if (a === b) {
    return 0;
  }
  if (a.length === 0) {
    return b.length;
  }
  if (b.length === 0) {
    return a.length;
  }

  let previous: number[] = new Array<number>(b.length + 1);
  let current: number[] = new Array<number>(b.length + 1);

  for (let j = 0; j <= b.length; j++) {
    previous[j] = j;
  }

  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost,
      );
    }
    const swap = previous;
    previous = current;
    current = swap;
  }

  return previous[b.length];
};

export const similarityScore = (left: string, right: string): number => {
  const a = normalizeText(left);
  const b = normalizeText(right);

  if (a === b) {
    return 1;
  }

  const maxLength = Math.max(a.length, b.length);
  if (maxLength === 0) {
    return 1;
  }

  const score = 1 - levenshteinDistance(a, b) / maxLength;
  return Math.max(0, Math.min(1, Math.round(score * 100) / 100));
};

export const getSimilarityLevel = (score: number): SimilarityLevel => {
  if (score >= SIMILARITY_THRESHOLDS.HIGH) {
    return "HIGH";
  }
  if (score >= SIMILARITY_THRESHOLDS.MEDIUM) {
    return "MEDIUM";
  }
  return "LOW";
};
