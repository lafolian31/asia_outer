import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
const fixtures = JSON.parse(readFileSync(".env.test-fixtures.json", "utf8"));
async function login(page: Page, who = "admin") {
  await page.goto("/");
  await page
    .getByLabel("이메일", { exact: true })
    .fill(fixtures.users[who].email);
  await page
    .getByLabel("비밀번호", { exact: true })
    .fill(fixtures.users[who].password);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "농장의 오늘을 살펴보세요" }),
  ).toBeVisible();
}
for (const width of [320, 390, 1440]) {
  test(`${width}px: 기본·아주 큰 글자에서 메뉴와 작성 화면 사용 및 설정 유지`, async ({
    browser,
  }) => {
    const ctx = await browser.newContext({ viewport: { width, height: 1000 } });
    try {
      const page = await ctx.newPage();
      await page.route("https://api.open-meteo.com/**", (route) =>
        route.abort(),
      );
      await login(page);
      expect(
        await page
          .locator("html")
          .evaluate((e) => getComputedStyle(e).fontSize),
      ).toBe("18px");
      for (const size of ["기본", "아주 크게"]) {
        const control = page.locator(".text-size-control");
        if (!(await control.getAttribute("open")))
          await control.locator("summary").click();
        await control.getByRole("button", { name: size, exact: true }).click();
        expect(
          await page
            .locator("html")
            .evaluate((e) => getComputedStyle(e).fontSize),
        ).toBe(size === "기본" ? "18px" : "24px");
        await control.locator("summary").click();
        for (const menu of [
          "홈",
          "농장계획",
          "농작업일지",
          "운영·교류",
          "자료함",
          "영농정보",
          "공동회계",
          "농장 관리",
          "사이트맵",
        ]) {
          await page
            .locator("nav")
            .getByRole("button", { name: new RegExp(`^${menu}`) })
            .click();
          await expect(
            page.getByRole("heading", {
              name: menu === "홈" ? "농장의 오늘을 살펴보세요" : menu,
              exact: true,
            }),
          ).toBeVisible();
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= window.innerWidth,
            ),
            `${menu} ${size}`,
          ).toBe(true);
        }
        await page
          .locator("nav")
          .getByRole("button", { name: /^농작업일지/ })
          .click();
        await page
          .getByRole("button", { name: "농작업 기록하기", exact: true })
          .click();
        const dialog = page.getByRole("dialog");
        await expect(dialog.getByLabel("제목", { exact: false })).toBeVisible();
        const input = dialog.getByLabel("제목", { exact: false });
        expect(
          await input.evaluate((e) => parseFloat(getComputedStyle(e).fontSize)),
        ).toBeGreaterThanOrEqual(18);
        expect(
          await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth),
        ).toBe(true);
        page.once("dialog", (d) => d.accept());
        await dialog.getByRole("button", { name: "닫기", exact: true }).click();
      }
      await page.reload();
      expect(
        await page
          .locator("html")
          .evaluate((e) => getComputedStyle(e).fontSize),
      ).toBe("24px");
      const control = page.locator(".text-size-control");
      await control.locator("summary").click();
      await expect(
        control.getByRole("button", { name: "아주 크게", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await control.getByRole("button", { name: "크게", exact: true }).click();
      expect(
        await page
          .locator("html")
          .evaluate((e) => getComputedStyle(e).fontSize),
      ).toBe("21px");
    } finally {
      await ctx.close();
    }
  });
}
test("로그인 전 확대 설정 유지, 키보드 조작 및 저장소 차단 시에도 변경", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("farm-text-size", "extra"),
  );
  await page.goto("/");
  expect(
    await page.locator("html").evaluate((e) => getComputedStyle(e).fontSize),
  ).toBe("24px");
  const summary = page.locator(".text-size-control summary");
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("group", { name: "글자 크기 선택" }),
  ).toBeVisible();
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw Error("storage blocked");
    };
  });
  await page.getByRole("button", { name: "기본", exact: true }).click();
  expect(
    await page.locator("html").evaluate((e) => getComputedStyle(e).fontSize),
  ).toBe("18px");
  await expect(page.getByLabel("이메일", { exact: true })).toBeVisible();
});

test("조금 작게 저장·재접속 및 공용 브라우저에서 A/B 계정별 마지막 크기 복원", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("https://api.open-meteo.com/**", (route) => route.abort());
  await login(page, "a");
  const choose = async (label: string) => {
    const control = page.locator(".text-size-control");
    if ((await control.getAttribute("open")) === null)
      await control.locator("summary").click();
    await control.getByRole("button", { name: label, exact: true }).click();
    await control.locator("summary").click();
  };
  const rootSize = () =>
    page.locator("html").evaluate((e) => getComputedStyle(e).fontSize);
  await choose("조금 작게");
  expect(await rootSize()).toBe("16px");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "농장의 오늘을 살펴보세요" }),
  ).toBeVisible();
  expect(await rootSize()).toBe("16px");
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "로그인", exact: true }),
  ).toBeVisible();
  await login(page, "b");
  await choose("아주 크게");
  expect(await rootSize()).toBe("24px");
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "로그인", exact: true }),
  ).toBeVisible();
  await login(page, "a");
  expect(await rootSize()).toBe("16px");
  await page.locator(".text-size-control summary").click();
  await expect(
    page.getByRole("button", { name: "조금 작게", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.locator(".text-size-control summary").click();
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "로그인", exact: true }),
  ).toBeVisible();
  await login(page, "b");
  expect(await rootSize()).toBe("24px");
});
