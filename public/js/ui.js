(function () {
  const guide = document.querySelector("[data-onboarding]");
  if (!guide) return;
  let opener;

  document.querySelectorAll("[data-guide-open]").forEach((button) => {
    button.addEventListener("click", () => {
      opener = button;
      guide.showModal();
      guide.querySelector("button").focus();
    });
  });

  guide.querySelectorAll("[data-guide-dismiss]").forEach((button) => {
    button.addEventListener("click", () => guide.close());
  });

  guide.addEventListener("close", () => opener?.focus());

  guide.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const buttons = [...guide.querySelectorAll("button:not(:disabled)")];
    const index = buttons.indexOf(document.activeElement);
    const next =
      (index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
    event.preventDefault();
    buttons[next].focus();
  });

  guide.addEventListener("click", (event) => {
    if (event.target !== guide) return;
    const bounds = guide.getBoundingClientRect();
    if (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    ) {
      guide.close();
    }
  });
})();
