import { RequestHandler } from "express";

export const getHealth: RequestHandler = (_req, res) => {
  res.status(200).json({
    success: true,
    service: "Aegis API",
    status: "running",
    environment: process.env.NODE_ENV ?? "development",
    databaseConfigured: Boolean(process.env.DATABASE_URL),
    aiConfigured: Boolean(process.env.AEGIS_AI_API_KEY),
  });
};
