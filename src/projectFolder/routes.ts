import express from "express";

import { resolveProjectFolderRoutes } from "./repository.js";

export const projectFolderRouter = express.Router();

projectFolderRouter.post("/api/project-folder/resolve", async (req, res, next) => {
  try {
    const labels = readStringArray(req.body, "labels");
    const routes = await resolveProjectFolderRoutes(labels);

    if (routes.length === 0) {
      res.json({ matched: false, routes: [] });
      return;
    }

    res.json({
      matched: true,
      routes: routes.map((route) => ({
        labelName: route.labelName,
        projectName: route.projectName,
        folderPath: route.folderPath,
      })),
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
