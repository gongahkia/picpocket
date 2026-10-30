const { expect, test } = require("@playwright/test");

const SAMPLE_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

test("presenter can create a session and audience can open the waiting view", async ({
  context,
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Every seat. A front-row seat." }),
  ).toBeVisible();
  await page
    .getByRole("main")
    .getByRole("link", { name: "Start presenting" })
    .click();

  await expect(page).toHaveURL(
    /\/presenter\.html\?id=[a-z]+-[a-z]+&token=[A-Za-z0-9_-]{43}$/,
  );
  await expect(
    page.getByRole("heading", { name: "Presenter Dashboard" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start Sharing Screen" }),
  ).toBeVisible();

  const joinLink = await page.locator("#joinLinkInput").inputValue();
  const audience = await context.newPage();
  await audience.goto(joinLink);

  await expect(
    audience.getByText("Connected. Waiting for presenter..."),
  ).toBeVisible();
  await expect(
    audience.getByRole("button", { name: "Share Link" }),
  ).toBeVisible();
});

test("audience receives and saves a relayed frame", async ({
  context,
  page,
}) => {
  const session = await createSession(page);
  const audience = await context.newPage();
  await audience.goto(`/join/${session.sessionId}`);
  await sendPresenterFrame(page, session);

  await expect(audience.locator("#slideDisplay")).toBeVisible();

  await audience.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(audience.locator("#zoomValue")).toHaveText("125%");
  const nextFrame = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 2;
    canvas.height = 2;
    canvas.getContext("2d").fillRect(0, 0, 2, 2);
    const imageData = canvas.toDataURL("image/png");
    window.__picpocketPresenterWs.send(
      JSON.stringify({ imageData, type: "frame" }),
    );
    return imageData;
  });
  await expect(audience.locator("#slideDisplay")).toHaveAttribute(
    "src",
    nextFrame,
  );
  await expect(audience.locator("#slideDisplay")).toHaveCSS(
    "transform",
    /1\.25/,
  );
  await audience.locator("#slideDisplay").focus();
  await audience.keyboard.press("ArrowRight");
  await expect(audience.locator("#slideDisplay")).toHaveCSS("transform", /-30/);
  await audience.getByRole("button", { name: "Fit slide" }).click();
  await expect(audience.locator("#zoomValue")).toHaveText("100%");
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 844, height: 390 },
  ]) {
    await audience.setViewportSize(viewport);
    expect(
      await audience.locator("#slideDisplay").evaluate((img) => {
        const image = img.getBoundingClientRect();
        const viewer = img.parentElement.getBoundingClientRect();
        return (
          image.top >= viewer.top &&
          image.bottom <= viewer.bottom &&
          image.left >= viewer.left &&
          image.right <= viewer.right
        );
      }),
    ).toBe(true);
  }

  const downloadPromise = audience.waitForEvent("download");
  await audience.getByRole("button", { name: "Save" }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/^picpocket-\d+\.png$/);
});

test("audience view fits mobile viewport", async ({ browser, page }) => {
  const session = await createSession(page);
  const mobile = await browser.newContext({
    isMobile: true,
    viewport: { height: 844, width: 390 },
  });
  const audience = await mobile.newPage();

  await audience.goto(`/join/${session.sessionId}`);

  await expect(
    audience.getByText("Connected. Waiting for presenter..."),
  ).toBeVisible();
  await expect(
    audience.getByRole("button", { name: "Share Link" }),
  ).toBeVisible();
  await expect(audience.locator(".footer")).toBeVisible();
  await expect
    .poll(() =>
      audience.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    )
    .toBe(true);

  await sendPresenterFrame(page, session);
  await expect(audience.locator("#slideDisplay")).toBeVisible();
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await audience.setViewportSize(viewport);
    expect(
      await audience.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    for (const name of [
      "Zoom in",
      "Fit slide",
      "Share Link",
      "Save",
      "Quick guide",
    ]) {
      await expect(
        audience.getByRole("button", { name, exact: true }),
      ).toBeInViewport({ ratio: 1 });
    }
  }
  await expect(audience.locator("#viewerGuide")).toBeHidden();
  await audience.getByRole("button", { name: "Quick guide" }).click();
  await expect(audience.locator("#viewerGuide")).toBeVisible();
  expect(
    await audience
      .locator("#viewerGuide")
      .evaluate((dialog) => dialog.matches(":modal")),
  ).toBe(true);
  await audience.getByRole("button", { name: "Got it", exact: true }).click();
  await expect(audience.locator("#viewerGuide")).toBeHidden();
  await expect(
    audience.getByRole("button", { name: "Quick guide" }),
  ).toBeFocused();

  await mobile.close();
});

test("presenter onboarding can be dismissed and reopened", async ({ page }) => {
  await page.goto("/presenter");
  const guide = page.locator("[data-onboarding=presenter]");
  await expect(guide).toBeHidden();
  await page.getByRole("button", { name: "Quick guide" }).click();
  await expect(guide).toBeVisible();
  expect(await guide.evaluate((dialog) => dialog.matches(":modal"))).toBe(true);
  expect(
    await guide.evaluate(
      (dialog) => getComputedStyle(dialog, "::backdrop").backdropFilter,
    ),
  ).toBe("blur(7px)");
  const close = page.getByRole("button", { name: "Close quick guide" });
  await expect(close).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Got it, let’s go" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(guide).toBeHidden();
  await expect(page.getByRole("button", { name: "Quick guide" })).toBeFocused();
  await page.getByRole("button", { name: "Quick guide" }).click();
  await close.click();
  await expect(guide).toBeHidden();
  await page.getByRole("button", { name: "Quick guide" }).click();
  await page.mouse.click(4, 4);
  await expect(guide).toBeHidden();
});

test("unsupported presenter browsers stay disabled after the session connects", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
      value: undefined,
    });
  });
  await page.goto("/presenter");
  await expect(page.locator("#status")).toContainText(
    "this browser can’t share a screen",
  );
  await expect(page.locator("#captureSupportMessage")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start Sharing Screen" }),
  ).toBeDisabled();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});

test("screen capture handles permission denial, live frames, pause, and restart", async ({
  context,
  page,
}) => {
  await page.addInitScript(() => {
    let calls = 0;
    // retain the mocked wrapper when WebKit opens another tab.
    const mediaDevices = navigator.mediaDevices;
    Object.defineProperty(navigator, "mediaDevices", { value: mediaDevices });
    Object.defineProperty(mediaDevices, "getDisplayMedia", {
      value: async () => {
        calls += 1;
        if (calls === 1) throw new DOMException("Denied", "NotAllowedError");
        const canvas = document.createElement("canvas");
        canvas.width = 960;
        canvas.height = 540;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#6350d6";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        return canvas.captureStream(5);
      },
    });
  });
  await page.goto("/presenter");
  const start = page.getByRole("button", { name: "Start Sharing Screen" });
  await expect(start).toBeEnabled();
  const audience = await context.newPage();
  await audience.goto(await page.locator("#joinLinkInput").inputValue());
  await start.click();
  await expect(page.locator("#noPermissionMessage")).toBeVisible();
  await expect(start).toBeEnabled();
  await start.click();
  await expect(page.locator("body")).toHaveAttribute("data-sharing", "true");
  await expect(audience.locator("#slideDisplay")).toBeVisible();
  await expect
    .poll(() =>
      audience.locator("#slideDisplay").evaluate((img) => img.naturalWidth),
    )
    .toBe(960);
  const lateAudience = await context.newPage();
  await lateAudience.goto(await page.locator("#joinLinkInput").inputValue());
  await expect(lateAudience.locator("#slideDisplay")).toBeVisible();
  await page.getByRole("button", { name: "Stop Sharing", exact: true }).click();
  await expect(
    audience.getByText("Awaiting presenter to share..."),
  ).toBeVisible();
  await expect(page.locator("#previewVideo")).toBeHidden();
  await start.click();
  await expect(audience.locator("#slideDisplay")).toBeVisible();
  await page.close();
  await expect(audience.locator("#connectionStatus")).toHaveText(
    "Presentation ended",
  );
  await expect(audience.locator("#saveButton")).toBeHidden();
});

test("audience keeps the original download when PNG conversion fails", async ({
  context,
  page,
}) => {
  const session = await createSession(page);
  const audience = await context.newPage();
  await audience.route("**/api/save-image", (route) =>
    route.fulfill({ status: 400, body: "Invalid image data" }),
  );
  await audience.goto(`/join/${session.sessionId}`);
  await sendPresenterFrame(page, session);
  await expect(audience.locator("#slideDisplay")).toBeVisible();
  const downloadPromise = audience.waitForEvent("download");
  await audience.getByRole("button", { name: "Save", exact: true }).click();
  expect((await downloadPromise).suggestedFilename()).toMatch(/-raw/);
  await expect(audience.locator("#viewerFeedback")).toContainText(
    "Saved the original image",
  );
});

test("landing page fits small phones and desktop", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "How it works" })).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Start presenting" }),
  ).toHaveCount(1);
  for (const text of [
    "For everyone in the room",
    "No accounts. No installs.",
    "Big ideas. Tiny text.",
    "Made for the people at the back.",
    "Watching a talk?",
  ]) {
    await expect(page.getByText(text, { exact: false })).toHaveCount(0);
  }
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});

test("audience links copy without presenter credentials", async ({
  context,
  page,
}) => {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (text) => {
          window.__copiedText = text;
        },
      },
    });
  });
  await page.goto("/presenter");
  const joinLink = await page.locator("#joinLinkInput").inputValue();
  await page.getByRole("button", { name: "Copy", exact: true }).click();
  expect(await page.evaluate(() => window.__copiedText)).toBe(joinLink);
  expect(joinLink).not.toContain("token=");
  const audience = await context.newPage();
  await audience.goto(joinLink);
  await audience.getByRole("button", { name: "Share Link" }).click();
  expect(await audience.evaluate(() => window.__copiedText)).toBe(joinLink);
});

test("onboarding works when browser storage is blocked", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("Storage blocked");
      },
    });
  });
  await page.goto("/presenter");
  await page.getByRole("button", { name: "Quick guide" }).click();
  await page.getByRole("button", { name: "Got it, let’s go" }).click();
  await expect(page.locator("[data-onboarding]")).toBeHidden();
  await page.getByRole("button", { name: "Quick guide" }).click();
  await expect(page.locator("[data-onboarding]")).toBeVisible();
  await expect(page.locator("#startSharingButton")).toBeEnabled();
});

async function createSession(page) {
  const response = await page.request.get("/presenter");
  const url = new URL(response.url());

  return {
    presenterToken: url.searchParams.get("token"),
    sessionId: url.searchParams.get("id"),
  };
}

async function sendPresenterFrame(page, { presenterToken, sessionId }) {
  await page.goto("/");
  await page.evaluate(
    ({ imageData, presenterToken, sessionId }) =>
      new Promise((resolve, reject) => {
        const wsProtocol = location.protocol === "https:" ? "wss" : "ws";
        const ws = new WebSocket(
          `${wsProtocol}://${location.host}/ws/presenter?id=${sessionId}&token=${presenterToken}`,
        );
        window.__picpocketPresenterWs = ws;

        ws.onopen = () => {
          ws.send(
            JSON.stringify({ imageData, sentAt: Date.now(), type: "frame" }),
          );
          resolve();
        };
        ws.onerror = reject;
      }),
    { imageData: SAMPLE_PNG, presenterToken, sessionId },
  );
}
