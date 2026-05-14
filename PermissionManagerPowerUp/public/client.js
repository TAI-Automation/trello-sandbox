/* global TrelloPowerUp */

const POWER_UP_ORIGIN = window.location.origin;
const ICON = `${POWER_UP_ORIGIN}/power-up/icon.svg`;
const PERMISSIONS_URL = `${POWER_UP_ORIGIN}/power-up/permissions.html`;

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
