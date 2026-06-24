const { expect, test } = require("@playwright/test");

const SAMPLE_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

test("presenter can create a session and audience can open the waiting view", async ({
  context,
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Welcome to PicPocket" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Start Presenting" }).click();

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

  await mobile.close();
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
