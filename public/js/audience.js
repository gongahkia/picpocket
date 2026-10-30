(function () {
  const MESSAGE_TYPES = {
    AWAITING: "awaiting",
    DISCONNECTED: "disconnected",
    FRAME: "frame",
  };

  const state = {
    currentSlideImageDataUrl: "",
    dragging: false,
    lastScale: 1,
    lastTap: 0,
    originX: 0,
    originY: 0,
    scale: 1,
    sessionId: "",
    startX: 0,
    startY: 0,
    ws: null,
    ended: false,
  };

  const slideDisplay = document.getElementById("slideDisplay");
  const notConnectedMsg = document.getElementById("notConnectedMsg");
  const saveButton = document.getElementById("saveButton");
  const copyLinkButton = document.getElementById("copyLinkButton");
  const sessionIdDisplay = document.getElementById("sessionIdDisplay");
  const emptyState = document.getElementById("emptyState");
  const emptyTitle = document.getElementById("emptyTitle");
  const connectionStatus = document.getElementById("connectionStatus");
  const viewerFeedback = document.getElementById("viewerFeedback");
  const zoomInButton = document.getElementById("zoomInButton");
  const zoomOutButton = document.getElementById("zoomOutButton");
  const resetZoomButton = document.getElementById("resetZoomButton");
  const zoomValue = document.getElementById("zoomValue");
  let feedbackTimeout;

  function connectWebSocket() {
    state.sessionId = getSessionId();

    if (!state.sessionId) {
      setMessage("Error: no session ID found in URL.");
      sessionIdDisplay.textContent = "";
      connectionStatus.textContent = "Missing session";
      copyLinkButton.disabled = true;
      return;
    }

    const joinUrl = `${window.location.origin}/join/${state.sessionId}`;
    copyLinkButton.dataset.link = joinUrl;
    sessionIdDisplay.textContent = state.sessionId;

    const wsProtocol = window.location.protocol === "https:" ? "wss" : "ws";
    state.ws = new WebSocket(
      `${wsProtocol}://${window.location.host}/ws/audience?id=${state.sessionId}`,
    );

    state.ws.onopen = function () {
      connectionStatus.textContent = "Waiting for presenter";
      setMessage("Connected. Waiting for presenter...");
    };

    state.ws.onmessage = function (event) {
      const message = parseMessage(event.data);

      if (!message) return;

      if (message.type === MESSAGE_TYPES.FRAME) {
        showFrame(message.imageData);
        return;
      }

      if (message.type === MESSAGE_TYPES.AWAITING) {
        connectionStatus.textContent = "Sharing paused";
        emptyTitle.textContent = "A little intermission.";
        clearFrame("Awaiting presenter to share...");
        return;
      }

      if (message.type === MESSAGE_TYPES.DISCONNECTED) {
        state.ended = true;
        emptyTitle.textContent = "That’s a wrap.";
        clearFrame("Presentation ended.");
        state.ws.close();
      }
    };

    state.ws.onclose = function () {
      emptyState.querySelector(".empty-note").hidden = true;
      clearFrame(
        state.ended
          ? "Presentation ended. You may close this tab."
          : "Disconnected. Refresh to try reconnecting, or ask your presenter for a new link.",
      );
      emptyTitle.textContent = state.ended
        ? "That’s a wrap."
        : "The connection closed.";
      connectionStatus.textContent = state.ended
        ? "Presentation ended"
        : "Disconnected";
      copyLinkButton.disabled = true;
      copyLinkButton.querySelector("span").textContent = "Share Link";
      copyLinkButton.removeAttribute("data-link");
    };

    state.ws.onerror = function () {
      emptyState.querySelector(".empty-note").hidden = true;
      clearFrame("Connection error. Please refresh.");
      connectionStatus.textContent = "Connection error";
      copyLinkButton.disabled = true;
      copyLinkButton.querySelector("span").textContent = "Share Link";
      copyLinkButton.removeAttribute("data-link");
    };
  }

  function clearFrame(message) {
    state.currentSlideImageDataUrl = "";
    slideDisplay.removeAttribute("src");
    slideDisplay.style.display = "none";
    saveButton.style.display = "none";
    setMessage(message);
    resetZoom();
  }

  async function copyText(text) {
    if (!text) return;

    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const tempInput = document.createElement("input");
    tempInput.value = text;
    document.body.appendChild(tempInput);
    tempInput.select();
    const copied = document.execCommand("copy");
    tempInput.remove();
    if (!copied) throw new Error("Copy unavailable");
  }

  function downloadCurrentSlide(imageData, filenameSuffix) {
    const link = document.createElement("a");
    link.href = imageData;
    link.download = `picpocket-${Date.now()}-${filenameSuffix}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function getSessionId() {
    const pathParts = window.location.pathname.split("/");
    return pathParts[2] || "";
  }

  function parseMessage(data) {
    const text = typeof data === "string" ? data : String(data);

    try {
      const parsed = JSON.parse(text);

      if (
        parsed &&
        parsed.type === MESSAGE_TYPES.FRAME &&
        typeof parsed.imageData === "string" &&
        parsed.imageData.startsWith("data:image/")
      ) {
        return parsed;
      }

      if (
        parsed &&
        (parsed.type === MESSAGE_TYPES.AWAITING ||
          parsed.type === MESSAGE_TYPES.DISCONNECTED)
      ) {
        return parsed;
      }
    } catch {
      if (text.startsWith("data:image/")) {
        return {
          imageData: text,
          type: MESSAGE_TYPES.FRAME,
        };
      }
    }

    return null;
  }

  function resetZoom() {
    state.scale = 1;
    state.lastScale = 1;
    state.originX = 0;
    state.originY = 0;
    state.dragging = false;
    slideDisplay.lastTouchDistance = null;
    applyTransform();
  }

  function applyTransform() {
    const maxX = (slideDisplay.clientWidth * (state.scale - 1)) / 2;
    const maxY = (slideDisplay.clientHeight * (state.scale - 1)) / 2;
    state.originX = Math.max(-maxX, Math.min(maxX, state.originX));
    state.originY = Math.max(-maxY, Math.min(maxY, state.originY));
    slideDisplay.style.transform = `translate(${state.originX}px, ${state.originY}px) scale(${state.scale})`;
    zoomValue.textContent = `${Math.round(state.scale * 100)}%`;
    const hasFrame = Boolean(state.currentSlideImageDataUrl);
    zoomInButton.disabled = !hasFrame || state.scale >= 6;
    zoomOutButton.disabled = !hasFrame || state.scale <= 1;
    resetZoomButton.disabled = !hasFrame;
  }

  function zoomTo(scale) {
    if (!state.currentSlideImageDataUrl) return;
    state.scale = Math.max(1, Math.min(6, scale));
    state.lastScale = state.scale;
    applyTransform();
  }

  function showFeedback(message) {
    clearTimeout(feedbackTimeout);
    viewerFeedback.textContent = message;
    viewerFeedback.hidden = false;
    feedbackTimeout = setTimeout(() => {
      viewerFeedback.hidden = true;
    }, 3500);
  }

  function setMessage(message) {
    emptyState.hidden = false;
    notConnectedMsg.textContent = message;
    notConnectedMsg.style.display = "block";
  }

  function showFrame(imageData) {
    state.currentSlideImageDataUrl = imageData;
    slideDisplay.src = imageData;
    slideDisplay.style.display = "block";
    saveButton.style.display = "flex";
    notConnectedMsg.style.display = "none";
    emptyState.hidden = true;
    if (connectionStatus.textContent !== "Live presentation") {
      connectionStatus.textContent = "Live presentation";
    }
    applyTransform();
  }

  saveButton.addEventListener("click", async function () {
    if (!state.currentSlideImageDataUrl) {
      setMessage("No slide to save yet.");
      return;
    }

    const controller = new AbortController();
    const imageData = state.currentSlideImageDataUrl;
    saveButton.disabled = true;
    saveButton.setAttribute("aria-busy", "true");
    const timeout = setTimeout(function () {
      controller.abort();
    }, 2000);

    try {
      const response = await fetch("/api/save-image", {
        body: JSON.stringify({ imageData }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) throw new Error("Save failed");

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `picpocket-${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      clearTimeout(timeout);
      downloadCurrentSlide(imageData, "raw");
      showFeedback("Saved the original image; PNG conversion was unavailable.");
    } finally {
      saveButton.disabled = false;
      saveButton.removeAttribute("aria-busy");
    }
  });

  copyLinkButton.addEventListener("click", async function () {
    try {
      await copyText(copyLinkButton.dataset.link);
      copyLinkButton.querySelector("span").textContent = "Copied";
      showFeedback("Audience link copied.");
      setTimeout(function () {
        copyLinkButton.querySelector("span").textContent = "Share Link";
      }, 1200);
    } catch {
      showFeedback(
        "Could not copy the link. Copy this page’s address to share it.",
      );
    }
  });

  slideDisplay.addEventListener("touchstart", function (event) {
    if (event.touches.length === 2) {
      state.lastScale = state.scale;
      state.dragging = false;
      slideDisplay.lastTouchDistance = Math.hypot(
        event.touches[0].clientX - event.touches[1].clientX,
        event.touches[0].clientY - event.touches[1].clientY,
      );
    } else if (event.touches.length === 1) {
      state.dragging = true;
      state.startX = event.touches[0].clientX - state.originX;
      state.startY = event.touches[0].clientY - state.originY;
    }
  });

  slideDisplay.addEventListener("touchmove", function (event) {
    if (event.touches.length === 2) {
      const dx = event.touches[0].clientX - event.touches[1].clientX;
      const dy = event.touches[0].clientY - event.touches[1].clientY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (!slideDisplay.lastTouchDistance)
        slideDisplay.lastTouchDistance = distance;
      state.scale = Math.max(
        1,
        Math.min(
          6,
          state.lastScale * (distance / slideDisplay.lastTouchDistance),
        ),
      );
      applyTransform();
    } else if (event.touches.length === 1 && state.dragging) {
      state.originX = event.touches[0].clientX - state.startX;
      state.originY = event.touches[0].clientY - state.startY;
      applyTransform();
    }
  });

  slideDisplay.addEventListener("touchend", function (event) {
    if (event.touches.length < 2) {
      slideDisplay.lastTouchDistance = null;
      state.lastScale = state.scale;
    }

    if (event.touches.length === 0) {
      state.dragging = false;
    }
  });

  slideDisplay.addEventListener(
    "wheel",
    function (event) {
      event.preventDefault();
      const delta = event.deltaY < 0 ? 0.1 : -0.1;
      zoomTo(state.scale + delta);
    },
    { passive: false },
  );

  slideDisplay.addEventListener("click", function () {
    const now = Date.now();
    if (now - state.lastTap < 350) resetZoom();
    state.lastTap = now;
  });

  zoomInButton.addEventListener("click", () => zoomTo(state.scale + 0.25));
  zoomOutButton.addEventListener("click", () => zoomTo(state.scale - 0.25));
  resetZoomButton.addEventListener("click", resetZoom);

  slideDisplay.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "mouse" || event.button !== 0 || state.scale <= 1)
      return;
    state.dragging = true;
    state.startX = event.clientX - state.originX;
    state.startY = event.clientY - state.originY;
    slideDisplay.setPointerCapture(event.pointerId);
  });

  slideDisplay.addEventListener("pointermove", (event) => {
    if (event.pointerType !== "mouse" || !state.dragging) return;
    state.originX = event.clientX - state.startX;
    state.originY = event.clientY - state.startY;
    applyTransform();
  });

  slideDisplay.addEventListener("pointerup", () => {
    state.dragging = false;
  });
  slideDisplay.addEventListener("pointercancel", () => {
    state.dragging = false;
  });

  slideDisplay.addEventListener("keydown", (event) => {
    if (event.key === "+" || event.key === "=") zoomTo(state.scale + 0.25);
    else if (event.key === "-") zoomTo(state.scale - 0.25);
    else if (event.key === "0" || event.key === "Home") resetZoom();
    else if (
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    ) {
      state.originX +=
        event.key === "ArrowLeft" ? 30 : event.key === "ArrowRight" ? -30 : 0;
      state.originY +=
        event.key === "ArrowUp" ? 30 : event.key === "ArrowDown" ? -30 : 0;
      applyTransform();
    } else return;
    event.preventDefault();
  });

  connectWebSocket();
})();
