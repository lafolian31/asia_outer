import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
const fixtures = JSON.parse(readFileSync(".env.test-fixtures.json", "utf8"));
for (const width of [320, 390, 1440]) {
  test(`함께그린 이름 ${width}px: 모든 화면 상단 표시와 홈 이동`, async ({
    browser,
  }) => {
    const ctx = await browser.newContext({ viewport: { width, height: 1000 } });
    try {
      if (width === 320)
        await ctx.addInitScript(() =>
          localStorage.setItem("farm-text-size", "extra"),
        );
      const page = await ctx.newPage();
      await page.route("https://api.open-meteo.com/**", (r) => r.abort());
      await page.goto("/");
      await page
        .getByLabel("이메일", { exact: true })
        .fill(fixtures.users.admin.email);
      await page
        .getByLabel("비밀번호", { exact: true })
        .fill(fixtures.users.admin.password);
      await page.getByRole("button", { name: "로그인", exact: true }).click();
      const brand = page
        .locator("header")
        .getByRole("link", { name: "함께그린 홈으로", exact: true });
      await expect(brand).toBeVisible();
      await expect(brand).toHaveText("함께그린");
      for (const menu of [
        "홈",
        "농장계획",
        "농작업일지",
        "운영·교류",
        "자료함",
        "영농정보",
        "농장 관리",
        "사이트맵",
      ]) {
        await page
          .locator("nav")
          .getByRole("button", { name: new RegExp(`^${menu}`) })
          .click();
        await expect(brand).toBeVisible();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
      }
      await brand.click();
      await expect(
        page.getByRole("heading", {
          name: "농장의 오늘을 살펴보세요",
          exact: true,
        }),
      ).toBeVisible();
    } finally {
      await ctx.close();
    }
  });
}
