/* global TrelloPowerUp */

const POWER_UP_ORIGIN = window.location.origin;
const POWER_UP_PATH = "/power-ups/permission-admin-power-up";
const ICON = `${POWER_UP_ORIGIN}${POWER_UP_PATH}/icon.svg`;
const PERMISSIONS_URL = `${POWER_UP_ORIGIN}${POWER_UP_PATH}/permissions.html`;

TrelloPowerUp.initialize({
  "board-buttons": async function boardButtons(t) {
    const context = t.getContext();

    if (!context.board || !context.member) {
      return [];
    }

    const params = new URLSearchParams({
      boardId: context.board,
      memberId: context.member,
    });
    const response = await fetch(
      `${POWER_UP_ORIGIN}/api/power-up/permissions/access?${params.toString()}`,
      { headers: { Accept: "application/json" } }
    );
    const payload = await response.json().catch(function noJson() {
      return {};
    });

    if (!response.ok || !payload.canManage) {
      return [];
    }

    return [
      {
        icon: ICON,
        text: "Permissions",
        callback: function openPermissions(powerUp) {
          return powerUp.modal({
            title: "Permission Manager",
            url: powerUp.signUrl(PERMISSIONS_URL),
            height: 680,
            fullscreen: false,
          });
        },
      },
    ];
  },
});
