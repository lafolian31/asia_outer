import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
const fixtures = JSON.parse(readFileSync(".env.test-fixtures.json", "utf8"));
for (const mobile of [false, true]) {
  test(`영농정보 ${mobile ? "모바일 열람자" : "PC 참여자"}: 메뉴·공식 링크·작업별 찾기`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: mobile
        ? { width: 390, height: 844 }
        : { width: 1440, height: 1000 },
      isMobile: mobile,
      hasTouch: mobile,
    });
    try {
      const page = await context.newPage();
      const who = mobile ? "viewer" : "a";
      await page.goto("/");
      await page
        .getByLabel("이메일", { exact: true })
        .fill(fixtures.users[who].email);
      await page
        .getByLabel("비밀번호", { exact: true })
        .fill(fixtures.users[who].password);
      await page.getByRole("button", { name: "로그인", exact: true }).click();
      await page
        .locator("nav")
        .getByRole("button", { name: "영농정보", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "영농정보", exact: true }),
      ).toBeVisible();
      await expect(page.locator(".info-card")).toHaveCount(6);
      for (const [name, url] of [
        ["기상청 날씨누리", "https://www.weather.go.kr/w/index.do"],
        ["흙토람", "https://soil.rda.go.kr/"],
        ["농사로", "https://www.nongsaro.go.kr/"],
        ["농업기상재해 조기경보시스템", "https://agmet.kr/"],
        ["용인시 농업기술센터", "https://www.yongin.go.kr/atc/index.do"],
        [
          "농산물유통정보 KAMIS",
          "https://www.kamis.or.kr/customer/main/main.do",
        ],
      ]) {
        const link = page.getByRole("link", {
          name: `${name} 열기 (새 탭)`,
          exact: true,
        });
        await expect(link).toHaveAttribute("href", url);
        await expect(link).toHaveAttribute("target", "_blank");
        await expect(link).toHaveAttribute("rel", "noopener noreferrer");
      }
      await expect(page.locator(".record-primary")).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "CSV", exact: true }),
      ).toHaveCount(0);
      await page
        .getByRole("button", { name: "물·양분 관리", exact: true })
        .click();
      await expect(page.locator(".info-card")).toHaveCount(3);
      await page.getByRole("button", { name: "전체", exact: true }).click();
      await page
        .getByRole("button", { name: "가격·판매", exact: true })
        .click();
      await expect(page.locator(".info-card")).toHaveCount(1);
      await expect(
        page.getByRole("heading", {
          name: "농산물유통정보 KAMIS",
          exact: true,
        }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "지역·교육", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "용인시 농업기술센터", exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "전체", exact: true }).click();
      await page
        .getByRole("searchbox", { name: "영농정보 찾기" })
        .fill("농산물 가격");
      await expect(
        page.getByRole("heading", {
          name: "농산물유통정보 KAMIS",
          exact: true,
        }),
      ).toBeVisible();
      await page.getByRole("searchbox", { name: "영농정보 찾기" }).fill("토양");
      await expect(page.locator(".info-card")).toHaveCount(1);
      await expect(
        page.getByRole("heading", { name: "흙토람", exact: true }),
      ).toBeVisible();
      await page.getByText("활용 방법", { exact: true }).click();
      await expect(page.getByText(/해당 필지의 토양검정/)).toBeVisible();
      await page
        .getByRole("searchbox", { name: "영농정보 찾기" })
        .fill("없는정보123");
      await expect(page.getByRole("status")).toContainText(
        "조건에 맞는 정보가 없습니다",
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await page
        .locator("nav")
        .getByRole("button", { name: /^농작업일지/ })
        .click();
      await expect(
        page.getByRole("heading", { name: "농작업일지", exact: true }),
      ).toBeVisible();
    } finally {
      await context.close();
    }
  });
}
