(function () {
  const guide = document.querySelector("[data-onboarding]");
  if (!guide) return;

  const key = `picpocket-guide-${guide.dataset.onboarding}`;
  if (
    window.matchMedia("(max-height: 520px) and (orientation: landscape)")
      .matches
  ) {
    guide.open = false;
  }
  try {
    guide.hidden = localStorage.getItem(key) === "dismissed";
  } catch {
    // the guide remains usable when browser storage is unavailable.
  }

  document.querySelectorAll("[data-guide-open]").forEach((button) => {
    button.addEventListener("click", () => {
      guide.hidden = false;
      guide.open = true;
      guide.querySelector("summary").focus();
      guide.scrollIntoView({ block: "nearest" });
    });
  });

  guide.querySelector("[data-guide-dismiss]").addEventListener("click", () => {
    guide.hidden = true;
    try {
      localStorage.setItem(key, "dismissed");
    } catch {
      // dismissal still works for this visit without browser storage.
    }
    const returnTarget = document.querySelector("[data-guide-open]");
    if (returnTarget && returnTarget.getClientRects().length) {
      returnTarget.focus();
    }
  });
})();
