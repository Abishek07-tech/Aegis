import { Router } from "express";
import {
  analyzeCandidateAppRiskHandler,
  analyzeCandidateCampaignHandler,
  analyzeCandidateCorrelationHandler,
  analyzeCandidateEvidenceHandler,
  analyzeCandidateExplanationHandler,
  analyzeCandidateInvestigationHandler,
  analyzeCandidateLogoHandler,
  analyzeCandidateNameHandler,
  analyzeCandidatePlaybookHandler,
  analyzeCandidateReportHandler,
  analyzeCandidateRiskHandler,
  analyzeCandidateSocialRiskHandler,
  analyzeCandidateTextHandler,
  analyzeCandidateAIHandler,
  getCandidateAIAnalysisHandler,
  createCandidateHandler,
  deleteCandidateHandler,
  getCandidateHandler,
  listCandidatesHandler,
  updateCandidateStatusHandler,
} from "../controllers/candidate.controller";
import { aiAnalysisRateLimit } from "../middleware/rate-limit.middleware";

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
candidateRouter.post(
  "/:candidateId/analyze/investigation",
  analyzeCandidateInvestigationHandler,
);
candidateRouter.post(
  "/:candidateId/analyze/playbook",
  analyzeCandidatePlaybookHandler,
);
candidateRouter.post(
  "/:candidateId/analyze/report",
  analyzeCandidateReportHandler,
);
candidateRouter.post(
  "/:candidateId/analyze/ai",
  aiAnalysisRateLimit,
  analyzeCandidateAIHandler,
);
candidateRouter.get(
  "/:candidateId/ai-analysis",
  getCandidateAIAnalysisHandler,
);
candidateRouter.get("/", listCandidatesHandler);
candidateRouter.get("/:id", getCandidateHandler);
candidateRouter.patch("/:id/status", updateCandidateStatusHandler);
candidateRouter.delete("/:id", deleteCandidateHandler);
