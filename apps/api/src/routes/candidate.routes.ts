import { Router } from "express";
import {
  analyzeCandidateAppRiskHandler,
  analyzeCandidateCampaignHandler,
  analyzeCandidateCorrelationHandler,
  analyzeCandidateEvidenceHandler,
  analyzeCandidateExplanationHandler,
  analyzeCandidateLogoHandler,
  analyzeCandidateNameHandler,
  analyzeCandidateRiskHandler,
  analyzeCandidateSocialRiskHandler,
  analyzeCandidateTextHandler,
  createCandidateHandler,
  deleteCandidateHandler,
  getCandidateHandler,
  listCandidatesHandler,
  updateCandidateStatusHandler,
} from "../controllers/candidate.controller";

export const candidateRouter = Router();

candidateRouter.post("/", createCandidateHandler);
candidateRouter.post("/:candidateId/analyze/name", analyzeCandidateNameHandler);
candidateRouter.post("/:candidateId/analyze/text", analyzeCandidateTextHandler);
candidateRouter.post("/:candidateId/analyze/logo", analyzeCandidateLogoHandler);
candidateRouter.post(
  "/:candidateId/analyze/social-risk",
  analyzeCandidateSocialRiskHandler,
);
candidateRouter.post(
  "/:candidateId/analyze/app-risk",
  analyzeCandidateAppRiskHandler,
);
candidateRouter.post(
  "/:candidateId/analyze/evidence",
  analyzeCandidateEvidenceHandler,
);
candidateRouter.post(
  "/:candidateId/analyze/risk",
  analyzeCandidateRiskHandler,
);
candidateRouter.post(
  "/:candidateId/analyze/explanation",
  analyzeCandidateExplanationHandler,
);
candidateRouter.post(
  "/:candidateId/analyze/correlation",
  analyzeCandidateCorrelationHandler,
);
candidateRouter.post(
  "/:candidateId/analyze/campaign",
  analyzeCandidateCampaignHandler,
);
candidateRouter.get("/", listCandidatesHandler);
candidateRouter.get("/:id", getCandidateHandler);
candidateRouter.patch("/:id/status", updateCandidateStatusHandler);
candidateRouter.delete("/:id", deleteCandidateHandler);
