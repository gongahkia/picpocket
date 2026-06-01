const { expect, test } = require("@playwright/test");

test("presenter can create a session and audience can open the waiting view", async ({
  context,
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Welcome to PicPocket" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Start Presenting" }).click();

  await expect(page).toHaveURL(/\/presenter\.html\?id=[a-z]+-[a-z]+$/);
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
