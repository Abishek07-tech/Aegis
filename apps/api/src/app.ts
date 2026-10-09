import cors from "cors";
import express, { Express } from "express";
import { env } from "./config/env";
import { errorHandler, notFoundHandler } from "./middleware/error.middleware";
import { router } from "./routes";

export const createApp = (): Express => {
  const app: Express = express();

  app.use(cors({ origin: env.CORS_ORIGIN }));
  app.use(express.json({ limit: "256kb" }));
  app.use(express.urlencoded({ extended: true }));

  app.use(router);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
