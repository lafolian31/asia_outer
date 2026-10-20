import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
const fixture = JSON.parse(readFileSync(".env.test-fixtures.json", "utf8"));
const env = Object.fromEntries(
  readFileSync(".env.test", "utf8")
    .trim()
    .split("\n")
    .map((s) => {
      const i = s.indexOf("=");
      return [s.slice(0, i), s.slice(i + 1)];
    }),
);
if (env.SUPABASE_URL !== "http://127.0.0.1:54321")
  throw Error("Local multi UI test only.");
async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("이메일", { exact: true }).fill(fixture.users.a.email);
  await page
    .getByLabel("비밀번호", { exact: true })
    .fill(fixture.users.a.password);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "농장의 오늘을 살펴보세요" }),
  ).toBeVisible();
}
async function nav(page: Page, name: string) {
  await page.locator("nav").getByRole("button", { name }).click();
}
async function choices(page: Page, label: string) {
  const block = page
    .getByRole("dialog")
    .locator(".multi-choice")
    .filter({ has: page.locator(`fieldset[aria-label="${label}"]`) });
  if ((await block.getAttribute("open")) === null)
    await block.locator("summary").click();
  return block;
}
for (const mobile of [false, true])
  test(`복수 선택·해제·보존·찾기·다중 계획·복사 (${mobile ? "모바일" : "PC"})`, async ({
    browser,
  }) => {
    const db = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });
    expect(
      (await db.auth.signInWithPassword(fixture.users.admin)).error,
    ).toBeNull();
    const settings = (await db.from("farm_settings").select("*").single()).data;
    expect(
      (
        await db.rpc("save_settings", {
          p_version: settings.version,
          p_name: settings.name,
          p_zones: Array.from(
            new Set([...settings.zones, "[검수용] A밭", "[검수용] B밭"]),
          ),
          p_crops: Array.from(
            new Set([...settings.crops, "[검수용] 들깨", "[검수용] 고추"]),
          ),
        })
      ).error,
    ).toBeNull();
    const plans: any[] = [];
    for (const year of [2026, 2027]) {
      const r = await db.rpc("save_entry", {
        p_id: randomUUID(),
        p_version: 0,
        p_data: {
          kind: "plan",
          title: "[검수용] 복수 연결 " + randomUUID(),
          target_year: year,
          start_date: `${year}-10-20`,
          end_date: `${year}-10-21`,
        },
      });
      expect(r.error).toBeNull();
      plans.push(r.data);
    }
    const ctx = await browser.newContext(
      mobile
        ? {
            viewport: { width: 390, height: 844 },
            isMobile: true,
            hasTouch: true,
          }
        : {},
    );
    const page = await ctx.newPage();
    try {
      await login(page);
      await nav(page, "농작업일지");
      await page
        .getByRole("button", { name: "농작업 기록하기", exact: true })
        .click();
      const dialog = page.getByRole("dialog");
      await dialog
        .getByRole("button", { name: "잡초·병해충", exact: true })
        .click();
      await dialog.getByRole("button", { name: "제초", exact: true }).click();
      await dialog
        .getByRole("button", { name: "물·양분 관리", exact: true })
        .click();
      await dialog.getByRole("button", { name: "관수", exact: true }).click();
      await expect(
        dialog.getByRole("button", { name: "제초", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      const crops = await choices(page, "작물");
      await crops
        .getByRole("checkbox", { name: "[검수용] 들깨", exact: true })
        .check();
      await crops
        .getByRole("checkbox", { name: "[검수용] 고추", exact: true })
        .check();
      const zones = await choices(page, "작업 장소");
      await zones
        .getByRole("checkbox", { name: "[검수용] A밭", exact: true })
        .check();
      await zones
        .getByRole("checkbox", { name: "[검수용] B밭", exact: true })
        .check();
      const linked = await choices(page, "관련 농장계획");
      for (const p of plans)
        await linked.locator(`input[value="${p.id}"]`).check();
      await expect(dialog.getByLabel("제목", { exact: true })).toHaveValue(
        "[검수용] 들깨, [검수용] 고추 · 제초, 관수",
      );
      const title = "[검수용] 다중 일지 " + randomUUID();
      await dialog.getByLabel("제목", { exact: true }).fill(title);
      await dialog
        .getByRole("button", { name: "저장하기", exact: true })
        .click();
      await expect(dialog).toBeHidden();
      await page.reload();
      await nav(page, "농작업일지");
      await page
        .getByLabel("검색어")
        .fill(`${title} [검수용] 고추 B밭 관수 ${plans[1].title}`);
      await page
        .getByRole("button")
        .filter({
          has: page.getByRole("heading", { name: title, exact: true }),
        })
        .click();
      for (const p of plans)
        await expect(
          dialog.getByRole("button", {
            name: `${p.target_year} · ${p.title}`,
            exact: true,
          }),
        ).toBeVisible();
      await dialog
        .getByRole("button", {
          name: `${plans[1].target_year} · ${plans[1].title}`,
          exact: true,
        })
        .click();
      await expect(
        dialog.locator(".linked-log").filter({ hasText: title }),
      ).toBeVisible();
      await expect(dialog.getByText("미실행", { exact: true })).toBeVisible();
      await dialog
        .locator(".linked-log")
        .filter({ hasText: title })
        .getByRole("button")
        .click();
      await dialog
        .getByRole("button", { name: "수정하기", exact: true })
        .click();
      await expect(
        (await choices(page, "작물")).getByRole("checkbox", {
          name: "[검수용] 고추",
          exact: true,
        }),
      ).toBeChecked();
      await dialog
        .getByRole("button", { name: "잡초·병해충", exact: true })
        .click();
      await expect(
        dialog.getByRole("button", { name: "관수", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(
        dialog.getByRole("button", { name: "제초", exact: true }),
      ).toHaveCount(0);
      await (await choices(page, "작물"))
        .getByRole("checkbox", { name: "[검수용] 들깨", exact: true })
        .uncheck();
      await (await choices(page, "관련 농장계획"))
        .locator(`input[value="${plans[0].id}"]`)
        .uncheck();
      await dialog
        .getByRole("button", { name: "저장하기", exact: true })
        .click();
      await expect(dialog).toBeHidden();
      await nav(page, "농작업일지");
      await page.getByLabel("검색어").fill(title);
      await page
        .getByRole("button")
        .filter({
          has: page.getByRole("heading", { name: title, exact: true }),
        })
        .click();
      await expect(
        dialog.getByRole("button", {
          name: `${plans[0].target_year} · ${plans[0].title}`,
          exact: true,
        }),
      ).toHaveCount(0);
      await dialog
        .getByRole("button", { name: "이전 작업 복사", exact: true })
        .click();
      await expect(
        (await choices(page, "작물")).getByRole("checkbox", {
          name: "[검수용] 고추",
          exact: true,
        }),
      ).toBeChecked();
      await expect(
        (await choices(page, "작업 장소")).getByRole("checkbox", {
          name: "[검수용] B밭",
          exact: true,
        }),
      ).toBeChecked();
      await expect(
        dialog.getByRole("button", { name: "관수", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBeTruthy();
      page.once("dialog", (d) => d.accept());
      await dialog.getByRole("button", { name: "닫기", exact: true }).click();
    } finally {
      await ctx.close();
      await db.auth.signOut();
    }
  });

test("분류 없이 직접 입력했던 작업을 보존하며 새 작업도 함께 추가", async ({
  page,
}) => {
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
  expect((await db.auth.signInWithPassword(fixture.users.a)).error).toBeNull();
  const title = "[검수용] 미분류 직접 작업 " + randomUUID();
  const saved = await db.rpc("save_entry", {
    p_id: randomUUID(),
    p_version: 0,
    p_data: {
      kind: "log",
      work_date: "2026-10-20",
      title,
      body: "예전 기록",
      work_task: "이전 직접 작업",
    },
  });
  expect(saved.error).toBeNull();
  await login(page);
  await nav(page, "농작업일지");
  await page
    .getByRole("button")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "수정하기", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "이전 직접 작업", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await dialog.getByRole("button", { name: "관찰·점검", exact: true }).click();
  await dialog.getByRole("button", { name: "사진 기록", exact: true }).click();
  await dialog.getByRole("button", { name: "저장하기", exact: true }).click();
  await expect(dialog).toBeHidden();
  const result = await db
    .from("entries")
    .select("*")
    .eq("id", saved.data.id)
    .single();
  expect(result.error).toBeNull();
  expect(result.data.work_items).toEqual([
    { group: "", task: "이전 직접 작업" },
    { group: "관찰·점검", task: "사진 기록" },
  ]);
  expect(result.data.author_id).toBe(fixture.users.a.id);
  await db.auth.signOut();
});
