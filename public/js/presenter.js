(function () {
  const MESSAGE_TYPES = {
    AWAITING: 'awaiting',
    FRAME: 'frame',
  };

  const CAPTURE = {
    burstDurationMs: 2000,
    compareCanvasSize: 16,
    highFps: 10,
    imageQuality: 0.72,
    lowFps: 1,
    maxFrameDimension: 1600,
    mimeType: 'image/jpeg',
    pixelChangeThresholdPercent: 0.01,
  };

  const state = {
    burstTimeout: null,
    currentFps: CAPTURE.lowFps,
    firstFrameSent: false,
    lastAvgPixelIntensity: 0,
    mediaStream: null,
    sendIntervalId: null,
    serverAlive: true,
    sessionId: '',
    ws: null,
  };

  const statusEl = document.getElementById('status');
  const sessionBadge = document.getElementById('sessionBadge');
  const qrCodeImage = document.getElementById('qrCodeImage');
  const startSharingButton = document.getElementById('startSharingButton');
  const stopSharingButton = document.getElementById('stopSharingButton');
  const startNewSessionButton = document.getElementById('startNewSessionButton');
  const previewVideo = document.getElementById('previewVideo');
  const noPermissionMessage = document.getElementById('noPermissionMessage');
  const joinLinkInput = document.getElementById('joinLinkInput');
  const copyLinkButton = document.getElementById('copyLinkButton');
  const openAudienceButton = document.getElementById('openAudienceButton');

  const captureCanvas = document.createElement('canvas');
  const captureCtx = captureCanvas.getContext('2d', { willReadFrequently: true });
  const compareCanvas = document.createElement('canvas');
  const compareCtx = compareCanvas.getContext('2d', { willReadFrequently: true });
  compareCanvas.width = CAPTURE.compareCanvasSize;
  compareCanvas.height = CAPTURE.compareCanvasSize;

  function configureCaptureCanvas() {
    const sourceWidth = previewVideo.videoWidth;
    const sourceHeight = previewVideo.videoHeight;
    const scale = Math.min(1, CAPTURE.maxFrameDimension / Math.max(sourceWidth, sourceHeight));

    captureCanvas.width = Math.max(1, Math.round(sourceWidth * scale));
    captureCanvas.height = Math.max(1, Math.round(sourceHeight * scale));
  }

  function connectWebSocket() {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    state.ws = new WebSocket(`${wsProtocol}://${window.location.host}/ws/presenter?id=${state.sessionId}`);

    state.ws.onopen = function () {
      setStatus("Ready to share. Click 'Start Sharing Screen'.");
      sessionBadge.textContent = `Session: ${state.sessionId}`;
      startSharingButton.disabled = false;
      stopSharingButton.disabled = true;
      startNewSessionButton.style.display = 'none';
    };

    state.ws.onclose = function () {
      if (!state.serverAlive) return;
      setStatus('Session not found or expired. Start a new session to continue.');
      sessionBadge.textContent = 'Expired';
      startSharingButton.disabled = true;
      stopSharingButton.disabled = true;
      startNewSessionButton.style.display = 'inline-flex';
    };

    state.ws.onerror = function () {
      setStatus('Connection error. Check your network and start a new session if needed.');
      sessionBadge.textContent = 'Connection error';
      startSharingButton.disabled = true;
      stopSharingButton.disabled = true;
      startNewSessionButton.style.display = 'inline-flex';
    };
  }

  function getAveragePixelIntensity(sourceCanvas) {
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
    let sum = 0;

    for (let i = 0; i < imageData.length; i += 4) {
      sum += imageData[i] * 0.299 + imageData[i + 1] * 0.587 + imageData[i + 2] * 0.114;
    }

    return sum / (CAPTURE.compareCanvasSize * CAPTURE.compareCanvasSize);
  }

  function initialize() {
    const urlParams = new URLSearchParams(window.location.search);
    state.sessionId = urlParams.get('id') || '';

    if (!state.sessionId) {
      setStatus('No session ID found. Start from the main page.');
      sessionBadge.textContent = 'Missing session';
      startNewSessionButton.style.display = 'inline-flex';
      return;
    }

    const joinUrl = `${window.location.origin}/join/${state.sessionId}`;
    joinLinkInput.value = joinUrl;
    qrCodeImage.src = `/api/qrcode?data=${encodeURIComponent(joinUrl)}`;
    qrCodeImage.hidden = false;

    setStatus('Connecting presenter session...');
    sessionBadge.textContent = 'Connecting';
    connectWebSocket();
    startServerPing();

    if (!('mediaDevices' in navigator && 'getDisplayMedia' in navigator.mediaDevices)) {
      setStatus('Screen sharing is only supported in desktop browsers.');
      startSharingButton.disabled = true;
    }
  }

  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }

    joinLinkInput.select();
    document.execCommand('copy');
    window.getSelection().removeAllRanges();
  }

  async function startScreenSharing() {
    noPermissionMessage.style.display = 'none';

    try {
      state.mediaStream = await navigator.mediaDevices.getDisplayMedia({
        audio: false,
        video: { cursor: 'always' },
      });

      previewVideo.srcObject = state.mediaStream;
      previewVideo.style.display = 'block';

      await new Promise((resolve) => {
        previewVideo.onloadedmetadata = resolve;
      });

      await previewVideo.play();
      configureCaptureCanvas();
      startSendingFramesLoop();

      setStatus('Sharing screen. Audience members will see updates automatically.');
      sessionBadge.textContent = `Live: ${state.sessionId}`;
      startSharingButton.disabled = true;
      stopSharingButton.disabled = false;
      startNewSessionButton.style.display = 'none';

      state.mediaStream.getTracks().forEach((track) => {
        track.onended = stopPresenting;
      });
    } catch (error) {
      setStatus('Unable to start screen sharing.');
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        noPermissionMessage.style.display = 'block';
      }
      startSharingButton.disabled = false;
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

    captureCtx.drawImage(previewVideo, 0, 0, captureCanvas.width, captureCanvas.height);

    const currentAvgPixelIntensity = getAveragePixelIntensity(captureCanvas);
    const intensityDiff = Math.abs(currentAvgPixelIntensity - state.lastAvgPixelIntensity) / 255;
    const imageData = captureCanvas.toDataURL(CAPTURE.mimeType, CAPTURE.imageQuality);
    const shouldSendBurst =
      intensityDiff > CAPTURE.pixelChangeThresholdPercent || !state.firstFrameSent;

    if (shouldSendBurst) {
      sendPresenterMessage({
        imageData,
        sentAt: Date.now(),
        type: MESSAGE_TYPES.FRAME,
      });

      state.lastAvgPixelIntensity = currentAvgPixelIntensity;
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
        const response = await fetch('/healthz', {
          cache: 'no-store',
          method: 'HEAD',
        });
        if (!response.ok) throw new Error('Health check failed');

        if (!state.serverAlive) window.location.reload();
      } catch (error) {
        state.serverAlive = false;
        setStatus('Server is unavailable. Start a new session when it is back online.');
        sessionBadge.textContent = 'Server offline';
        startSharingButton.disabled = true;
        stopSharingButton.disabled = true;
        copyLinkButton.disabled = true;
        openAudienceButton.disabled = true;
        startNewSessionButton.style.display = 'inline-flex';
      }
    }, 5000);
  }

  function stopPresenting() {
    if (state.mediaStream) {
      state.mediaStream.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });
      state.mediaStream = null;
    }

    stopSendingFrames();

    previewVideo.srcObject = null;
    previewVideo.style.display = 'none';
    state.firstFrameSent = false;
    state.lastAvgPixelIntensity = 0;

    sendPresenterMessage({ type: MESSAGE_TYPES.AWAITING });

    setStatus('Screen sharing stopped. You can select a new screen to share.');
    sessionBadge.textContent = `Session: ${state.sessionId}`;
    startSharingButton.disabled = false;
    stopSharingButton.disabled = true;
    startNewSessionButton.style.display = 'inline-flex';
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

  copyLinkButton.addEventListener('click', async function () {
    try {
      await copyText(joinLinkInput.value);
      copyLinkButton.textContent = 'Copied';
      setTimeout(function () {
        copyLinkButton.textContent = 'Copy';
      }, 1200);
    } catch (error) {
      setStatus('Could not copy the link. Select and copy it manually.');
    }
  });

  openAudienceButton.addEventListener('click', function () {
    window.open(joinLinkInput.value, '_blank', 'noopener');
  });

  startSharingButton.addEventListener('click', startScreenSharing);
  stopSharingButton.addEventListener('click', stopPresenting);
  startNewSessionButton.addEventListener('click', function () {
    window.location.href = '/presenter';
  });

  initialize();
})();
