/* global TrelloPowerUp */

const POWER_UP_ORIGIN = window.location.origin;
const POWER_UP_PATH = "/power-ups/permission-admin-power-up";
const ICON = `${POWER_UP_ORIGIN}${POWER_UP_PATH}/icon.svg`;
const PERMISSIONS_URL = `${POWER_UP_ORIGIN}${POWER_UP_PATH}/permissions.html`;

TrelloPowerUp.initialize({
  "board-buttons": function boardButtons(t) {
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
