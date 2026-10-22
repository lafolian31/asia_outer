import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
const fixtures = JSON.parse(readFileSync(".env.test-fixtures.json", "utf8"));
for (const [who, width] of [
  ["admin", 1440],
  ["a", 390],
  ["viewer", 320],
] as const) {
  test(`사이트맵 ${who} ${width}px: 메뉴 순서·권한별 구조·모든 메뉴 이동`, async ({
    browser,
  }) => {
    const ctx = await browser.newContext({ viewport: { width, height: 1000 } });
    try {
      if (who === "viewer")
        await ctx.addInitScript(() =>
          localStorage.setItem("farm-text-size", "extra"),
        );
      const page = await ctx.newPage();
      await page.route("https://api.open-meteo.com/**", (r) => r.abort());
      await page.goto("/");
      await page
        .getByLabel("이메일", { exact: true })
        .fill(fixtures.users[who].email);
      await page
        .getByLabel("비밀번호", { exact: true })
        .fill(fixtures.users[who].password);
      await page.getByRole("button", { name: "로그인", exact: true }).click();
      const nav = page.locator("nav");
      await expect(
        nav.getByRole("button", { name: "사이트맵", exact: true }),
      ).toBeVisible();
      const labels = await nav.getByRole("button").allTextContents();
      expect(labels.slice(-2)).toEqual(
        who === "admin" ? ["농장 관리", "사이트맵"] : ["공동회계", "사이트맵"],
      );
      await nav.getByRole("button", { name: "사이트맵", exact: true }).click();
      const map = page.getByRole("region", { name: "앱 메뉴 구조" });
      await expect(map).toBeVisible();
      await expect(map.locator(".site-map-card")).toHaveCount(
        who === "admin" ? 8 : 7,
      );
      await expect(
        map.getByRole("button", { name: "농장 관리 메뉴로 이동", exact: true }),
      ).toHaveCount(who === "admin" ? 1 : 0);
      await expect(page.locator(".record-primary")).toHaveCount(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      const menus = [
        "홈",
        "농장계획",
        "농작업일지",
        "운영·교류",
        "자료함",
        "영농정보",
        "공동회계",
        ...(who === "admin" ? ["농장 관리"] : []),
      ];
      for (const menu of menus) {
        await map
          .getByRole("button", { name: `${menu} 메뉴로 이동`, exact: true })
          .click();
        await expect(
          page.getByRole("heading", {
            name: menu === "홈" ? "농장의 오늘을 살펴보세요" : menu,
            exact: true,
            level: 1,
          }),
        ).toBeVisible();
        if (who === "viewer")
          await expect(page.locator(".record-primary")).toHaveCount(0);
        await nav
          .getByRole("button", { name: "사이트맵", exact: true })
          .click();
      }
    } finally {
      await ctx.close();
    }
  });
}
