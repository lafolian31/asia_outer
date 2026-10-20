import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
const fixtures = JSON.parse(readFileSync(".env.test-fixtures.json", "utf8"));
async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("이메일", { exact: true }).fill(fixtures.users.a.email);
  await page
    .getByLabel("비밀번호", { exact: true })
    .fill(fixtures.users.a.password);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "농장의 오늘을 살펴보세요" }),
  ).toBeVisible();
}
test("좌표 미확인 시 실제 수치·요청 없이 위치 안내", async ({ page }) => {
  let requests = 0;
  await page.route("https://api.open-meteo.com/**", async (route) => {
    requests++;
    await route.abort();
  });
  await login(page);
  const widget = page.getByRole("complementary", { name: "안녕동 농장 날씨" });
  await expect(widget).toContainText("정확한 농장 위치 확인");
  await expect(widget.locator("dd")).toHaveCount(4);
  expect(requests).toBe(0);
});
for (const mobile of [false, true]) {
  test(`날씨 카드 ${mobile ? "모바일" : "PC"}: 기온·습도·풍향·일조, 캐시와 실패 안내`, async ({
    browser,
  }) => {
    const ctx = await browser.newContext({
      viewport: mobile
        ? { width: 390, height: 844 }
        : { width: 1440, height: 1000 },
    });
    try {
      const page = await ctx.newPage();
      // Test-only coordinates: never write unverified parcel coordinates to production.
      await page.route("**/src/lib/weather.js", async (route) => {
        const response = await route.fetch();
        const source = (await response.text())
          .replace("latitude: null", "latitude: 37.2")
          .replace("longitude: null", "longitude: 127.0");
        await route.fulfill({ response, body: source });
      });
      let requests = 0;
      let fail = false;
      await page.route("https://api.open-meteo.com/**", async (route) => {
        requests++;
        if (fail) {
          await route.fulfill({ status: 503, body: "Unavailable" });
          return;
        }
        await route.fulfill({
          json: {
            current: {
              time: "2026-10-20T13:15",
              temperature_2m: 21.5,
              relative_humidity_2m: 65,
              wind_speed_10m: 2.3,
              wind_direction_10m: 90,
            },
            current_units: {
              temperature_2m: "°C",
              relative_humidity_2m: "%",
              wind_speed_10m: "m/s",
            },
            hourly: { time: ["2026-10-20T13:00"], sunshine_duration: [1800] },
            hourly_units: { sunshine_duration: "s" },
          },
        });
      });
      await login(page);
      const widget = page.getByRole("complementary", {
        name: "안녕동 농장 날씨",
      });
      await expect(widget).toContainText("21.5°C");
      await expect(widget).toContainText("65%");
      await expect(widget).toContainText("2.3m/s");
      await expect(widget).toContainText("동풍");
      await expect(widget).toContainText("30분");
      await expect(widget).toContainText("13:00 이전 1시간");
      if (!mobile) {
        const heading = await page
          .getByRole("heading", { name: "농장의 오늘을 살펴보세요" })
          .boundingBox();
        const card = await widget.boundingBox();
        expect(card!.x).toBeGreaterThan(heading!.x);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      const beforeReload = requests;
      await page.reload();
      await expect(widget).toContainText("21.5°C");
      expect(requests).toBe(beforeReload);
      fail = true;
      await widget.getByRole("button", { name: "날씨 새로고침" }).click();
      await expect(widget.getByRole("status")).toContainText(
        "불러오지 못했습니다",
      );
      await expect(widget).toContainText("이전 자료");
      await expect(widget).toContainText("21.5°C");
    } finally {
      await ctx.close();
    }
  });
}
