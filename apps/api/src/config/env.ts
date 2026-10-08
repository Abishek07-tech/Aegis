import dotenv from "dotenv";

dotenv.config();

const NODE_ENV = process.env.NODE_ENV ?? "development";

const PORT = Number(process.env.PORT ?? 4000);

const CORS_ORIGIN = (process.env.CORS_ORIGIN ?? "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const DATABASE_URL = process.env.DATABASE_URL;

export const env = {
  NODE_ENV,
  PORT,
  CORS_ORIGIN,
  DATABASE_URL,
  isProduction: NODE_ENV === "production",
} as const;
