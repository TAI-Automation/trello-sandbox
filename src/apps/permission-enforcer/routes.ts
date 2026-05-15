import { Router } from "express";
import type { AppConfig } from "../../config/env.js";
import { config } from "../../config/env.js";
import { moveCardToList } from "../../trello/api.js";
import { isValidTrelloWebhook } from "../../trello/webhooks.js";
import type { TrelloWebhookRequest } from "../../types/express.js";
import { rememberReversal, shouldIgnoreRecentReversal } from "./reversals.js";
import { PermissionRestrictionService } from "./restrictions.js";

type TrelloWebhookAction = {
  type?: string;
  date?: string;
  idMemberCreator?: string;
  memberCreator?: {
    fullName?: string;
    username?: string;
  };
  data?: {
    old?: {
      idList?: string;
    };
    card?: {
      id?: string;
      idList?: string;
      name?: string;
    };
    listBefore?: {
      name?: string;
    };
    listAfter?: {
      name?: string;
    };
  };
};

type TrelloWebhookBody = {
  action?: TrelloWebhookAction;
};

export function createPermissionEnforcerRouter(
  appConfig: AppConfig = config
): Router {
  const router = Router();
  const restrictionService = new PermissionRestrictionService(appConfig);

  router.head("/trello/webhook", (_req, res) => {
    res.sendStatus(200);
  });

  router.post("/trello/webhook", async (req, res) => {
    const webhookReq = req as TrelloWebhookRequest;

    if (!isValidTrelloWebhook(webhookReq, appConfig)) {
      console.warn("Rejected webhook with invalid Trello signature.");
      return res.sendStatus(401);
    }

    const action = (req.body as TrelloWebhookBody).action;

    if (!action) {
      return res.sendStatus(200);
    }

    const oldListId = action.data?.old?.idList;
    const card = action.data?.card;
    const currentListId = card?.idList;
    const cardId = card?.id;

    if (
      action.type === "updateCard" &&
      oldListId &&
      currentListId &&
      oldListId !== currentListId &&
      cardId &&
      card
    ) {
      const memberId = action.idMemberCreator;
      const memberLabel =
        action.memberCreator?.fullName ||
        action.memberCreator?.username ||
        memberId ||
        "unknown member";
      const fromList = action.data?.listBefore?.name || oldListId;
      const toList = action.data?.listAfter?.name || currentListId;

      console.log("Card moved:");
      console.log(`  Card: ${card.name || cardId} (${cardId})`);
      console.log(`  Member label: ${memberLabel}`);
      console.log(`  Member ID: ${memberId || "missing member ID"}`);
      console.log(`  From list: ${fromList}`);
      console.log(`  From list ID: ${oldListId}`);
      console.log(`  To list: ${toList}`);
      console.log(`  To list ID: ${currentListId}`);
      console.log(`  At: ${action.date}`);

      const moveRestriction = memberId
        ? await restrictionService.getMoveRestriction(memberId, {
            sourceListId: oldListId,
            sourceListName: fromList,
            destinationListId: currentListId,
            destinationListName: toList,
          })
        : null;

      if (shouldIgnoreRecentReversal(cardId, currentListId)) {
        console.log("  Reversal webhook ignored.");
      } else if (!memberId) {
        console.warn("  Allowed: missing action.idMemberCreator; no restriction can match.");
      } else if (!moveRestriction) {
        console.log("  Allowed: no matching restriction.");
      } else {
        try {
          await moveCardToList(cardId, oldListId, appConfig);
          rememberReversal(cardId, oldListId);
          console.log(
            `  Denied: ${moveRestriction.memberLabel || memberId} cannot move cards ${moveRestriction.direction} denied list ${moveRestriction.listName} (${moveRestriction.listId}).`
          );
          console.log(`  Reversed: moved card back to ${fromList}`);
        } catch (error) {
          console.error("  Failed to reverse card move:");
          console.error(error);
        }
      }
    }

    return res.sendStatus(200);
  });

  return router;
}
