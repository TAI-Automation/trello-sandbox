import express from "express";

import { resolveProjectFolderRoute } from "./repository.js";

export const projectFolderRouter = express.Router();

projectFolderRouter.post("/api/project-folder/resolve", async (req, res, next) => {
  try {
    const labels = readStringArray(req.body, "labels");
    const match = await resolveProjectFolderRoute(labels);

    if (!match) {
      res.json({ matched: false });
      return;
    }

    res.json({
      matched: true,
      projectName: match.projectName,
      folderPath: match.folderPath,
      labelName: match.labelName,
    });
  } catch (error) {
    next(error);
  }
});

function readStringArray(body: unknown, key: string): string[] {
  if (!body || typeof body !== "object" || !(key in body)) {
    throw new BadRequestError(`${key} is required.`);
  }

  const value = (body as Record<string, unknown>)[key];

  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string")
  ) {
    throw new BadRequestError(`${key} must be an array of strings.`);
  }

  return value.map((item) => item.trim()).filter(Boolean);
}

class BadRequestError extends Error {
  status = 400;
}
