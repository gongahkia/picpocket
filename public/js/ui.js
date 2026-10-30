(function () {
  const guide = document.querySelector("[data-onboarding]");
  if (!guide) return;

  document.querySelectorAll("[data-guide-open]").forEach((button) => {
    button.addEventListener("click", () => guide.showModal());
  });

  guide.querySelectorAll("[data-guide-dismiss]").forEach((button) => {
    button.addEventListener("click", () => guide.close());
  });

  guide.addEventListener("click", (event) => {
    if (event.target !== guide) return;
    const bounds = guide.getBoundingClientRect();
    if (
      event.clientX < bounds.left || event.clientX > bounds.right ||
      event.clientY < bounds.top || event.clientY > bounds.bottom
    ) {
      guide.close();
    }
  });
})();
