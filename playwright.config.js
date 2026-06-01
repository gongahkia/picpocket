module.exports = {
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
      },
    },
  ],
  testDir: "./test/e2e",
  timeout: 15000,
  use: {
    baseURL: "http://127.0.0.1:3100",
  },
  webServer: {
    command: "PORT=3100 npm start",
    reuseExistingServer: !process.env.CI,
    timeout: 10000,
    url: "http://127.0.0.1:3100/healthz",
  },
};
