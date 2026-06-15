import {
  createTrelloBoardTextCustomField,
  listTrelloBoardCustomFields,
  type TrelloCredentials,
  type TrelloCustomField,
} from "../../trello/api.js";

export const PROJECT_MANAGER_CUSTOM_FIELD_NAME = "Project Manager(s)";

export async function ensureProjectManagerCustomField(
  boardId: string,
  credentials: TrelloCredentials
): Promise<TrelloCustomField> {
  const customFields = await listTrelloBoardCustomFields(boardId, credentials);
  const existingField = customFields.find(
    (customField) =>
      customField.name.toLowerCase() ===
      PROJECT_MANAGER_CUSTOM_FIELD_NAME.toLowerCase()
  );

  if (!existingField) {
    return createTrelloBoardTextCustomField(
      {
        boardId,
        name: PROJECT_MANAGER_CUSTOM_FIELD_NAME,
      },
      credentials
    );
  }

  if (existingField.type !== "text") {
    throw new BadRequestError(
      `The board already has a "${PROJECT_MANAGER_CUSTOM_FIELD_NAME}" custom field, but it is not a text field.`
    );
  }

  return existingField;
}

export async function findProjectManagerCustomField(
  boardId: string,
  credentials: TrelloCredentials
): Promise<TrelloCustomField | null> {
  const customFields = await listTrelloBoardCustomFields(boardId, credentials);

  return (
    customFields.find(
      (customField) =>
        customField.name.toLowerCase() ===
        PROJECT_MANAGER_CUSTOM_FIELD_NAME.toLowerCase()
    ) ?? null
  );
}

class BadRequestError extends Error {
  status = 400;
}
