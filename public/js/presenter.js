(function () {
  const MESSAGE_TYPES = {
    AWAITING: "awaiting",
    FRAME: "frame",
  };

  const CAPTURE = {
    burstDurationMs: 2000,
    compareCanvasSize: 32,
    highFps: 10,
    imageQuality: 0.82,
    lowFps: 1,
    maxFrameDimension: 1800,
    mimeType: "image/jpeg",
    pixelChangeThreshold: 0.015,
  };

  const state = {
    burstTimeout: null,
    currentFps: CAPTURE.lowFps,
    firstFrameSent: false,
    lastCompareData: null,
    mediaStream: null,
    sendIntervalId: null,
    serverAlive: true,
    captureSupported: Boolean(
      navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia,
    ),
    sessionId: "",
    token: "",
    ws: null,
  };

  const statusEl = document.getElementById("status");
  const sessionCode = document.getElementById("sessionCode");
  const captureSupportMessage = document.getElementById(
    "captureSupportMessage",
  );
  const qrCodeImage = document.getElementById("qrCodeImage");
  const startSharingButton = document.getElementById("startSharingButton");
  const stopSharingButton = document.getElementById("stopSharingButton");
  const startNewSessionButton = document.getElementById(
    "startNewSessionButton",
  );
  const previewVideo = document.getElementById("previewVideo");
  const noPermissionMessage = document.getElementById("noPermissionMessage");
  const joinLinkInput = document.getElementById("joinLinkInput");
  const copyLinkButton = document.getElementById("copyLinkButton");
  const openAudienceButton = document.getElementById("openAudienceButton");

  const captureCanvas = document.createElement("canvas");
  const captureCtx = captureCanvas.getContext("2d", {
    willReadFrequently: true,
  });
  const compareCanvas = document.createElement("canvas");
  const compareCtx = compareCanvas.getContext("2d", {
    willReadFrequently: true,
  });
  compareCanvas.width = CAPTURE.compareCanvasSize;
  compareCanvas.height = CAPTURE.compareCanvasSize;

  function configureCaptureCanvas() {
    const sourceWidth = previewVideo.videoWidth;
    const sourceHeight = previewVideo.videoHeight;
    const scale = Math.min(
      1,
      CAPTURE.maxFrameDimension / Math.max(sourceWidth, sourceHeight),
    );

    captureCanvas.width = Math.max(1, Math.round(sourceWidth * scale));
    captureCanvas.height = Math.max(1, Math.round(sourceHeight * scale));
  }

  function connectWebSocket() {
    const wsProtocol = window.location.protocol === "https:" ? "wss" : "ws";
    const params = new URLSearchParams({
      id: state.sessionId,
      token: state.token,
    });

    state.ws = new WebSocket(
      `${wsProtocol}://${window.location.host}/ws/presenter?${params.toString()}`,
    );

    state.ws.onopen = function () {
      setStatus(
        state.captureSupported
          ? "Your audience can join now. Choose a screen whenever you’re ready."
          : "Your session is ready, but this browser can’t share a screen. Use a supported desktop browser to present.",
      );
      startSharingButton.disabled = !state.captureSupported;
      stopSharingButton.disabled = true;
      startNewSessionButton.hidden = true;
    };

    state.ws.onclose = function () {
      stopCapture();
      if (!state.serverAlive) return;
      setStatus(
        "Session not found or expired. Start a new session to continue.",
      );
      startSharingButton.disabled = true;
      stopSharingButton.disabled = true;
      startNewSessionButton.hidden = false;
    };

    state.ws.onerror = function () {
      stopCapture();
      setStatus(
        "Connection error. Check your network and start a new session if needed.",
      );
      startSharingButton.disabled = true;
      stopSharingButton.disabled = true;
      startNewSessionButton.hidden = false;
    };
  }

  function getFrameDifference(sourceCanvas) {
    compareCtx.drawImage(
      sourceCanvas,
      0,
      0,
      CAPTURE.compareCanvasSize,
      CAPTURE.compareCanvasSize,
    );

    const imageData = compareCtx.getImageData(
      0,
      0,
      CAPTURE.compareCanvasSize,
      CAPTURE.compareCanvasSize,
    ).data;

    if (!state.lastCompareData) {
      state.lastCompareData = new Uint8ClampedArray(imageData);
      return 1;
    }

    let diff = 0;

    for (let i = 0; i < imageData.length; i += 4) {
      diff += Math.abs(imageData[i] - state.lastCompareData[i]);
      diff += Math.abs(imageData[i + 1] - state.lastCompareData[i + 1]);
      diff += Math.abs(imageData[i + 2] - state.lastCompareData[i + 2]);
    }

    state.lastCompareData.set(imageData);

    return diff / (CAPTURE.compareCanvasSize * CAPTURE.compareCanvasSize * 765);
  }

  function initialize() {
    captureSupportMessage.hidden = state.captureSupported;
    const urlParams = new URLSearchParams(window.location.search);
    state.sessionId = urlParams.get("id") || "";
    state.token = urlParams.get("token") || "";

    if (!state.sessionId || !state.token) {
      setStatus("Presenter credentials are missing. Start from the main page.");
      startNewSessionButton.hidden = false;
      return;
    }

    const joinUrl = `${window.location.origin}/join/${state.sessionId}`;
    joinLinkInput.value = joinUrl;
    sessionCode.textContent = state.sessionId;
    qrCodeImage.src = `/api/qrcode?data=${encodeURIComponent(joinUrl)}`;
    qrCodeImage.hidden = false;

    setStatus("Connecting presenter session...");
    connectWebSocket();
    startServerPing();
  }

  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }

    joinLinkInput.select();
    const copied = document.execCommand("copy");
    window.getSelection().removeAllRanges();
    if (!copied) throw new Error("Copy unavailable");
  }

  async function startScreenSharing() {
    if (!state.captureSupported || state.ws?.readyState !== WebSocket.OPEN)
      return;
    noPermissionMessage.style.display = "none";
    startSharingButton.disabled = true;
    setStatus("Choose what to share in your browser’s screen picker.");

    try {
      state.mediaStream = await navigator.mediaDevices.getDisplayMedia({
        audio: false,
        video: { cursor: "always" },
      });

      if (state.ws.readyState !== WebSocket.OPEN) {
        throw new Error("Session disconnected while choosing a screen");
      }

      previewVideo.style.display = "block";

      await new Promise((resolve) => {
        previewVideo.onloadedmetadata = resolve;
        previewVideo.srcObject = state.mediaStream;
      });

      await previewVideo.play();
      configureCaptureCanvas();
      startSendingFramesLoop();
      document.body.dataset.sharing = "true";

      setStatus(
        "Sharing screen. Audience members will see updates automatically.",
      );
      startSharingButton.disabled = true;
      stopSharingButton.disabled = false;
      startNewSessionButton.hidden = true;

      state.mediaStream.getTracks().forEach((track) => {
        track.onended = stopPresenting;
      });
    } catch (error) {
      stopCapture();
      setStatus(
        "Screen sharing didn’t start. Try again and choose a tab, window, or screen.",
      );
      if (
        error.name === "NotAllowedError" ||
        error.name === "PermissionDeniedError"
      ) {
        noPermissionMessage.style.display = "block";
      }
      startSharingButton.disabled = state.ws?.readyState !== WebSocket.OPEN;
      stopSharingButton.disabled = true;
    }
  }

  function startSendingFramesLoop() {
    setSendFps(CAPTURE.lowFps);

    requestAnimationFrame(function () {
      requestAnimationFrame(sendFrame);
    });
  }

  function sendFrame() {
    if (
      !state.mediaStream ||
      !state.mediaStream.active ||
      !state.ws ||
      state.ws.readyState !== WebSocket.OPEN
    ) {
      stopSendingFrames();
      return;
    }

    captureCtx.drawImage(
      previewVideo,
      0,
      0,
      captureCanvas.width,
      captureCanvas.height,
    );

    const frameDifference = getFrameDifference(captureCanvas);
    const imageData = captureCanvas.toDataURL(
      CAPTURE.mimeType,
      CAPTURE.imageQuality,
    );
    const shouldSendBurst =
      frameDifference > CAPTURE.pixelChangeThreshold || !state.firstFrameSent;

    if (shouldSendBurst) {
      sendPresenterMessage({
        imageData,
        sentAt: Date.now(),
        type: MESSAGE_TYPES.FRAME,
      });

      state.firstFrameSent = true;

      if (state.currentFps !== CAPTURE.highFps) setSendFps(CAPTURE.highFps);
      if (state.burstTimeout) clearTimeout(state.burstTimeout);
      state.burstTimeout = setTimeout(function () {
        setSendFps(CAPTURE.lowFps);
      }, CAPTURE.burstDurationMs);
    } else if (state.currentFps === CAPTURE.lowFps) {
      sendPresenterMessage({
        imageData,
        sentAt: Date.now(),
        type: MESSAGE_TYPES.FRAME,
      });
    }
  }

  function sendPresenterMessage(message) {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify(message));
    }
  }

  function setSendFps(fps) {
    if (state.currentFps === fps && state.sendIntervalId) return;

    state.currentFps = fps;
    stopSendingFrames();
    state.sendIntervalId = setInterval(sendFrame, 1000 / state.currentFps);
  }

  function setStatus(message) {
    statusEl.textContent = message;
  }

  function startServerPing() {
    setInterval(async function () {
      try {
        const response = await fetch("/healthz", {
          cache: "no-store",
          method: "HEAD",
        });
        if (!response.ok) throw new Error("Health check failed");

        if (!state.serverAlive) window.location.reload();
      } catch {
        state.serverAlive = false;
        stopCapture();
        setStatus(
          "Server is unavailable. Start a new session when it is back online.",
        );
        startSharingButton.disabled = true;
        stopSharingButton.disabled = true;
        copyLinkButton.disabled = true;
        openAudienceButton.disabled = true;
        startNewSessionButton.hidden = false;
      }
    }, 5000);
  }

  function stopPresenting() {
    stopCapture();

    sendPresenterMessage({ type: MESSAGE_TYPES.AWAITING });

    setStatus("Screen sharing stopped. You can select a new screen to share.");
    startSharingButton.disabled =
      !state.captureSupported || state.ws?.readyState !== WebSocket.OPEN;
    stopSharingButton.disabled = true;
    startNewSessionButton.hidden = false;
  }

  function stopCapture() {
    if (state.mediaStream) {
      state.mediaStream.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });
      state.mediaStream = null;
    }

    stopSendingFrames();

    previewVideo.srcObject = null;
    previewVideo.style.display = "none";
    state.firstFrameSent = false;
    state.lastCompareData = null;
    document.body.dataset.sharing = "false";
  }

  function stopSendingFrames() {
    if (state.sendIntervalId) {
      clearInterval(state.sendIntervalId);
      state.sendIntervalId = null;
    }

    if (state.burstTimeout) {
      clearTimeout(state.burstTimeout);
      state.burstTimeout = null;
    }
  }

  copyLinkButton.addEventListener("click", async function () {
    try {
      await copyText(joinLinkInput.value);
      copyLinkButton.textContent = "Copied";
      setTimeout(function () {
        copyLinkButton.textContent = "Copy";
      }, 1200);
    } catch {
      setStatus("Could not copy the link. Select and copy it manually.");
    }
  });

  openAudienceButton.addEventListener("click", function () {
    window.open(joinLinkInput.value, "_blank", "noopener");
  });

  startSharingButton.addEventListener("click", startScreenSharing);
  stopSharingButton.addEventListener("click", stopPresenting);
  startNewSessionButton.addEventListener("click", function () {
    window.location.href = "/presenter";
  });

  initialize();
})();
