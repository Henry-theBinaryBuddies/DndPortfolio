const moduleCards = document.querySelectorAll(".module-card");
const modules = document.getElementById("module-overlay");
const moduleCloseButton = document.getElementById("module-detail-close");

moduleCards.forEach((card) => {
  card.addEventListener("click", (event) => {
    event.preventDefault();

    openModuleOverlay();
  });
});

moduleCloseButton.addEventListener("click", () => {
  closeModuleOverlay();
});

modules.addEventListener("click", (event) => {
  if (event.target === modules) {
    closeModuleOverlay();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !modules.hidden) {
    closeModuleOverlay();
  }
});

function openModuleOverlay() {
  modules.hidden = false;
  moduleCloseButton.focus();
}

function closeModuleOverlay() {
  modules.hidden = true;
}
