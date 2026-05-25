import express from "express";

import {
  getPermissionManagerWebhookCallbackUrl,
  getTrelloSecret,
} from "./config.js";
import { enforceTrelloWebhook } from "./service.js";
import { isValidTrelloWebhook } from "../trello/webhooks.js";

export const permissionManagerEnforcerRouter = express.Router();

permissionManagerEnforcerRouter.head(
  "/api/permission-manager-enforcer/webhook",
  (_req, res) => {
    res.status(200).send();
  }
);

permissionManagerEnforcerRouter.post(
  "/api/permission-manager-enforcer/webhook",
  async (req, res, next) => {
    try {
      const rawBody = (req as express.Request & { rawBody?: Buffer }).rawBody;
      const valid = isValidTrelloWebhook({
        callbackUrl: getPermissionManagerWebhookCallbackUrl(),
        header: req.header("x-trello-webhook"),
        rawBody,
        secret: getTrelloSecret(),
      });

      if (!valid) {
        throw new UnauthorizedError("Invalid Trello webhook signature.");
      }

      await enforceTrelloWebhook(req.body);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

class UnauthorizedError extends Error {
  status = 401;
}
