import { RequestHandler } from "express";

export const getHealth: RequestHandler = (_req, res) => {
  res.status(200).json({
    success: true,
    service: "Aegis API",
    status: "running",
  });
};
