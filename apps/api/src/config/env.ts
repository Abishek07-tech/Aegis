import dotenv from "dotenv";

dotenv.config();

const NODE_ENV = process.env.NODE_ENV ?? "development";

const PORT = Number(process.env.PORT ?? 4000);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

const CORS_ORIGIN = (process.env.CORS_ORIGIN ?? "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const DATABASE_URL = process.env.DATABASE_URL;

const AEGIS_AI_API_KEY = process.env.AEGIS_AI_API_KEY;
const AEGIS_AI_BASE_URL = process.env.AEGIS_AI_BASE_URL;
const AEGIS_AI_MODEL = process.env.AEGIS_AI_MODEL;
const AEGIS_AI_TIMEOUT_MS = process.env.AEGIS_AI_TIMEOUT_MS;
const AEGIS_SEARCH_URL = process.env.AEGIS_SEARCH_URL;
const AEGIS_SEARCH_TIMEOUT_MS = process.env.AEGIS_SEARCH_TIMEOUT_MS;
const AEGIS_SEARCH_MIN_INTERVAL_MS = process.env.AEGIS_SEARCH_MIN_INTERVAL_MS;

export const env = {
  NODE_ENV,
  PORT,
  CORS_ORIGIN,
  DATABASE_URL,
  AEGIS_AI_API_KEY,
  AEGIS_AI_BASE_URL,
  AEGIS_AI_MODEL,
  AEGIS_AI_TIMEOUT_MS,
  AEGIS_SEARCH_URL,
  AEGIS_SEARCH_TIMEOUT_MS,
  AEGIS_SEARCH_MIN_INTERVAL_MS,
  isProduction: NODE_ENV === "production",
} as const;
