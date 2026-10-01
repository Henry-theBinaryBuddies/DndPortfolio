const logBookButton = document.getElementById("log-book");
const logBookOverlay = document.getElementById("logbook-overlay");
const logBookCloseButton = document.getElementById("logbook-close");

logBookButton.addEventListener("click", () => {
  openLogBook();
});

logBookCloseButton.addEventListener("click", () => {
  closeLogBook();
});

logBookOverlay.addEventListener("click", (event) => {
  if (event.target === logBookOverlay) {
    closeLogBook();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !logBookOverlay.hidden) {
    closeLogBook();
  }
});

function openLogBook() {
  logBookOverlay.hidden = false;
  logBookCloseButton.focus();
}

function closeLogBook() {
  logBookOverlay.hidden = true;
  logBookButton.focus();
}
