import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { today } from "../../src/lib/utils.js";

const fixtures = JSON.parse(readFileSync(".env.test-fixtures.json", "utf8"));
const env = Object.fromEntries(
  readFileSync(".env.test", "utf8")
    .trim()
    .split("\n")
    .map((line) => {
      const at = line.indexOf("=");
      return [line.slice(0, at), line.slice(at + 1)];
    }),
);
if (env.SUPABASE_URL !== "http://127.0.0.1:54321")
  throw Error("Dashboard tests must use the isolated local stack.");

async function nav(page: Page, name: string) {
  await page.locator("nav").getByRole("button", { name, exact: false }).click();
}

for (const mobile of [false, true]) {
  test(`농장 요약 숫자에서 올해·상태별 목록 이동 (${mobile ? "휴대전화" : "PC"})`, async ({
    browser,
  }) => {
    const year = Number(today().slice(0, 4));
    const db = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const auth = await db.auth.signInWithPassword(fixtures.users.admin);
    expect(auth.error).toBeNull();
    const entries: {
      id: string;
      version: number;
      title: string;
      status: string;
    }[] = [];
    const context = await browser.newContext(
      mobile
        ? {
            viewport: { width: 390, height: 844 },
            isMobile: true,
            hasTouch: true,
          }
        : { viewport: { width: 1440, height: 1000 } },
    );
    try {
      for (const [i, status] of [
        "미실행",
        "진행중",
        "완료",
        "보류",
        "취소",
        "미실행",
      ].entries()) {
        const target = i === 5 ? year + 1 : year;
        const { data, error } = await db.rpc("save_entry", {
          p_id: randomUUID(),
          p_version: 0,
          p_data: {
            kind: "plan",
            title: `[검수용] 요약 이동 ${randomUUID()}`,
            body: "격리된 로컬 브라우저 시험",
            target_year: target,
            start_date: `${target}-01-01`,
            end_date: `${target}-12-31`,
            status,
            actual_date: status === "완료" ? today() : null,
            result: status === "완료" ? "시험 완료" : "",
          },
        });
        expect(error).toBeNull();
        entries.push(data);
      }
      const page = await context.newPage();
      await page.goto("/");
      await page
        .getByLabel("이메일", { exact: true })
        .fill(fixtures.users.viewer.email);
      await page
        .getByLabel("비밀번호", { exact: true })
        .fill(fixtures.users.viewer.password);
      await page.getByRole("button", { name: "로그인", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "농장의 오늘을 살펴보세요" }),
      ).toBeVisible();

      for (const [label, scope] of [["올해 계획", ""]]) {
        // Leave old year, search, and status filters behind before opening the summary.
        await nav(page, "농장계획");
        await page.getByLabel("검색어").fill(`목표연도:${year + 1}`);
        await page.getByLabel("검색어").fill("결과가 없어야 하는 이전 검색");

        await nav(page, "홈");
        const card = page.getByRole("button", {
          name: new RegExp(`^${label} \\d+건 목록 보기$`),
        });
        const count = Number(
          (await card.getAttribute("aria-label"))!.match(/(\d+)건/)![1],
        );
        if (mobile) await card.locator(".stat-value").tap();
        else {
          await card.focus();
          await page.keyboard.press("Enter");
        }
        await expect(
          page.getByRole("heading", { name: "농장계획", exact: true }),
        ).toBeVisible();
        await expect(page.getByLabel("목표 연도")).toHaveCount(0);
        await expect(page.getByLabel("계획 상태", { exact: true })).toHaveCount(
          0,
        );
        await expect(page.getByLabel("검색어")).toHaveValue(`목표연도:${year}`);
        await expect(page.locator("tbody tr")).toHaveCount(count);
        for (const [i, entry] of entries.entries()) {
          const visible =
            i < 5 &&
            (!scope ||
              (scope === "pending"
                ? ["미실행", "진행중"].includes(entry.status)
                : entry.status === scope));
          await expect(
            page.getByRole("button", { name: entry.title, exact: true }),
          ).toHaveCount(visible ? 1 : 0);
        }
      }
      await page.getByLabel("검색어").fill(`목표연도:${year} 완료`);
      await expect(
        page.getByRole("button", { name: entries[2].title, exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: entries[0].title, exact: true }),
      ).toHaveCount(0);
      await page.getByLabel("검색어").fill(`목표연도:${year} 미완료`);
      await expect(
        page.getByRole("button", { name: entries[0].title, exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: entries[2].title, exact: true }),
      ).toHaveCount(0);
      await page.getByLabel("검색어").fill(`목표연도:${year}`);
      await expect(
        page.getByRole("button", { name: entries[3].title, exact: true }),
      ).toBeVisible();
      await nav(page, "농작업일지");
      await page.getByLabel("검색어").fill("결과가 없어야 하는 이전 검색");
      await nav(page, "홈");
      const logCard = page.getByRole("button", {
        name: /^쌓인 농작업일지 \d+건 목록 보기$/,
      });
      const logCount = Number(
        (await logCard.getAttribute("aria-label"))!.match(/(\d+)건/)![1],
      );
      await logCard.locator(".stat-value").click();
      await expect(
        page.getByRole("heading", { name: "농작업일지", exact: true }),
      ).toBeVisible();
      await expect(page.getByLabel("검색어")).toHaveValue("");
      await expect(page.locator(".records-list .record-card")).toHaveCount(
        logCount,
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBeTruthy();
    } finally {
      await context.close();
      for (const entry of entries) {
        const result = await db.rpc("trash_entry", {
          p_id: entry.id,
          p_version: entry.version,
        });
        expect(result.error).toBeNull();
      }
      await db.auth.signOut();
    }
  });
}
