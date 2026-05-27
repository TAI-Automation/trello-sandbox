export const trelloLabelColors = [
  "green",
  "yellow",
  "orange",
  "red",
  "purple",
  "blue",
  "sky",
  "lime",
  "pink",
  "black",
  "green_light",
  "yellow_light",
  "orange_light",
  "red_light",
  "purple_light",
  "blue_light",
  "sky_light",
  "lime_light",
  "pink_light",
  "black_light",
  "green_dark",
  "yellow_dark",
  "orange_dark",
  "red_dark",
  "purple_dark",
  "blue_dark",
  "sky_dark",
  "lime_dark",
  "pink_dark",
  "black_dark",
] as const;

export type TrelloLabelColor = (typeof trelloLabelColors)[number];

export type ProjectConfiguratorRole = "admin" | "normal_user";

export const projectConfiguratorConfig = {
  iframe: {
    title: "Project Configurator",
    height: 760,
  },
};

export function isTrelloLabelColor(value: string): value is TrelloLabelColor {
  return trelloLabelColors.includes(value as TrelloLabelColor);
}
