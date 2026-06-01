(function () {
  const MESSAGE_TYPES = {
    AWAITING: 'awaiting',
    DISCONNECTED: 'disconnected',
    FRAME: 'frame',
  };

  const state = {
    currentSlideImageDataUrl: '',
    dragging: false,
    lastScale: 1,
    lastTap: 0,
    originX: 0,
    originY: 0,
    scale: 1,
    sessionId: '',
    startX: 0,
    startY: 0,
    ws: null,
  };

  const slideDisplay = document.getElementById('slideDisplay');
  const notConnectedMsg = document.getElementById('notConnectedMsg');
  const saveButton = document.getElementById('saveButton');
  const copyLinkButton = document.getElementById('copyLinkButton');
  const sessionIdDisplay = document.getElementById('sessionIdDisplay');

  function connectWebSocket() {
    state.sessionId = getSessionId();

    if (!state.sessionId) {
      setMessage('Error: no session ID found in URL.');
      sessionIdDisplay.textContent = '';
      return;
    }

    const joinUrl = `${window.location.origin}/join/${state.sessionId}`;
    copyLinkButton.dataset.link = joinUrl;
    sessionIdDisplay.textContent = `Session ID: ${state.sessionId}`;

    const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    state.ws = new WebSocket(`${wsProtocol}://${window.location.host}/ws/audience?id=${state.sessionId}`);

    state.ws.onopen = function () {
      setMessage('Connected. Waiting for presenter...');
    };

    state.ws.onmessage = function (event) {
      const message = parseMessage(event.data);

      if (!message) return;

      if (message.type === MESSAGE_TYPES.FRAME) {
        showFrame(message.imageData);
        return;
      }

      if (message.type === MESSAGE_TYPES.AWAITING) {
        clearFrame('Awaiting presenter to share...');
        return;
      }

      if (message.type === MESSAGE_TYPES.DISCONNECTED) {
        clearFrame('Presentation ended.');
        state.ws.close();
      }
    };

    state.ws.onclose = function () {
      clearFrame('Disconnected. You may close this tab.');
      sessionIdDisplay.textContent = '';
      copyLinkButton.disabled = true;
      copyLinkButton.textContent = 'Share Link';
      copyLinkButton.removeAttribute('data-link');
    };

    state.ws.onerror = function () {
      clearFrame('Connection error. Please refresh.');
      sessionIdDisplay.textContent = '';
      copyLinkButton.disabled = true;
      copyLinkButton.textContent = 'Share Link';
      copyLinkButton.removeAttribute('data-link');
    };
  }

  function clearFrame(message) {
    state.currentSlideImageDataUrl = '';
    slideDisplay.removeAttribute('src');
    slideDisplay.style.display = 'none';
    saveButton.style.display = 'none';
    setMessage(message);
    resetZoom();
  }

  async function copyText(text) {
    if (!text) return;

    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const tempInput = document.createElement('input');
    tempInput.value = text;
    document.body.appendChild(tempInput);
    tempInput.select();
    document.execCommand('copy');
    tempInput.remove();
  }

  function downloadCurrentSlide(filenameSuffix) {
    const link = document.createElement('a');
    link.href = state.currentSlideImageDataUrl;
    link.download = `picpocket-${Date.now()}-${filenameSuffix}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function getSessionId() {
    const pathParts = window.location.pathname.split('/');
    return pathParts[2] || '';
  }

  function parseMessage(data) {
    const text = typeof data === 'string' ? data : String(data);

    try {
      const parsed = JSON.parse(text);

      if (
        parsed &&
        parsed.type === MESSAGE_TYPES.FRAME &&
        typeof parsed.imageData === 'string' &&
        parsed.imageData.startsWith('data:image/')
      ) {
        return parsed;
      }

      if (
        parsed &&
        (parsed.type === MESSAGE_TYPES.AWAITING || parsed.type === MESSAGE_TYPES.DISCONNECTED)
      ) {
        return parsed;
      }
    } catch (error) {
      if (text.startsWith('data:image/')) {
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
    slideDisplay.style.transform = '';
  }

  function setMessage(message) {
    notConnectedMsg.textContent = message;
    notConnectedMsg.style.display = 'block';
  }

  function showFrame(imageData) {
    state.currentSlideImageDataUrl = imageData;
    slideDisplay.src = imageData;
    slideDisplay.style.display = 'block';
    saveButton.style.display = 'flex';
    notConnectedMsg.style.display = 'none';
    resetZoom();
  }

  saveButton.addEventListener('click', async function () {
    if (!state.currentSlideImageDataUrl) {
      setMessage('No slide to save yet.');
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(function () {
      controller.abort();
    }, 2000);

    try {
      const response = await fetch('/api/save-image', {
        body: JSON.stringify({ imageData: state.currentSlideImageDataUrl }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) throw new Error('Save failed');

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `picpocket-${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      clearTimeout(timeout);
      downloadCurrentSlide('raw');
    }
  });

  copyLinkButton.addEventListener('click', async function () {
    try {
      await copyText(copyLinkButton.dataset.link);
      copyLinkButton.textContent = 'Copied';
      setTimeout(function () {
        copyLinkButton.textContent = 'Share Link';
      }, 1200);
    } catch (error) {
      setMessage('Could not copy the link.');
    }
  });

  slideDisplay.addEventListener('touchstart', function (event) {
    if (event.touches.length === 2) {
      state.lastScale = state.scale;
    } else if (event.touches.length === 1) {
      state.dragging = true;
      state.startX = event.touches[0].clientX - state.originX;
      state.startY = event.touches[0].clientY - state.originY;
    }
  });

  slideDisplay.addEventListener('touchmove', function (event) {
    if (event.touches.length === 2) {
      const dx = event.touches[0].clientX - event.touches[1].clientX;
      const dy = event.touches[0].clientY - event.touches[1].clientY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (!slideDisplay.lastTouchDistance) slideDisplay.lastTouchDistance = distance;
      state.scale = Math.max(1, Math.min(6, state.lastScale * (distance / slideDisplay.lastTouchDistance)));
      slideDisplay.style.transform = `scale(${state.scale})`;
    } else if (event.touches.length === 1 && state.dragging) {
      state.originX = event.touches[0].clientX - state.startX;
      state.originY = event.touches[0].clientY - state.startY;
      slideDisplay.style.transform = `scale(${state.scale}) translate(${state.originX / state.scale}px, ${
        state.originY / state.scale
      }px)`;
    }
  });

  slideDisplay.addEventListener('touchend', function (event) {
    if (event.touches.length < 2) {
      slideDisplay.lastTouchDistance = null;
      state.lastScale = state.scale;
    }

    if (event.touches.length === 0) {
      state.dragging = false;
    }
  });

  slideDisplay.addEventListener(
    'wheel',
    function (event) {
      event.preventDefault();
      const delta = event.deltaY < 0 ? 0.1 : -0.1;
      state.scale = Math.max(1, Math.min(6, state.scale + delta));
      slideDisplay.style.transform = `scale(${state.scale})`;
    },
    { passive: false },
  );

  slideDisplay.addEventListener('click', function () {
    const now = Date.now();
    if (now - state.lastTap < 350) resetZoom();
    state.lastTap = now;
  });

  connectWebSocket();
})();
