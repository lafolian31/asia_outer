import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
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
  throw Error("Local test only");
for (const mobile of [false, true]) {
  test(`계획 통합 찾기 ${mobile ? "모바일" : "PC"}: 모든 연도·상태·작성자·담당자·일지와 CSV`, async ({
    browser,
  }) => {
    const db = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });
    expect(
      (await db.auth.signInWithPassword(fixtures.users.admin)).error,
    ).toBeNull();
    const members = await db.from("members").select("user_id,display_name");
    expect(members.error).toBeNull();
    const person = (id: string) =>
      members.data!.find((m) => m.user_id === id)!.display_name;
    const year = Number(today().slice(0, 4));
    const batch = "검수계획" + randomUUID();
    const saved: any[] = [];
    const ctx = await browser.newContext({
      viewport: mobile
        ? { width: 390, height: 844 }
        : { width: 1440, height: 1000 },
    });
    try {
      for (const [i, status] of ["미실행", "완료", "진행중"].entries()) {
        const target = [year - 1, year + 1, year][i];
        const r = await db.rpc("save_entry", {
          p_id: randomUUID(),
          p_version: 0,
          p_data: {
            kind: "plan",
            title: `${batch} ${i}`,
            body: i === 0 ? "빗물관리 시험메모" : batch,
            target_year: target,
            start_date: `${target}-02-10`,
            end_date: `${target}-12-11`,
            status,
            assignee: i === 0 ? fixtures.users.b.id : null,
            crop: i === 0 ? "들깨" : "",
            zone: i === 0 ? "안녕동" : "",
            actual_date: status === "완료" ? today() : null,
            result: status === "완료" ? "토양개량 결과입력" : "",
          },
        });
        expect(r.error).toBeNull();
        saved.push(r.data);
      }
      const linked = await db.rpc("save_entry", {
        p_id: randomUUID(),
        p_version: 0,
        p_data: {
          kind: "log",
          record_type: "farm",
          title: "연결일지검수" + randomUUID(),
          body: "연결검색희귀단어",
          work_date: today(),
          plan_ids: [saved[1].id],
        },
      });
      expect(linked.error).toBeNull();
      saved.push(linked.data);
      const page = await ctx.newPage();
      await page.route("https://api.open-meteo.com/**", (r) => r.abort());
      await page.goto("/");
      await page
        .getByLabel("이메일", { exact: true })
        .fill(fixtures.users.viewer.email);
      await page
        .getByLabel("비밀번호", { exact: true })
        .fill(fixtures.users.viewer.password);
      await page.getByRole("button", { name: "로그인", exact: true }).click();
      await page
        .locator("nav")
        .getByRole("button", { name: "농장계획", exact: true })
        .click();
      const search = page.getByLabel("검색어");
      await expect(page.locator(".filters select")).toHaveCount(0);
      await expect(page.locator(".filters input")).toHaveCount(1);
      await expect(search).toHaveValue("");
      for (const entry of saved.slice(0, 3))
        await expect(
          page.getByRole("button", { name: entry.title, exact: true }),
        ).toHaveCount(1);
      for (const [query, expected] of [
        [batch, [0, 1, 2]],
        [`${batch} ${year - 1} 2월`, [0]],
        [`${batch} 없는작성자`, []],
        [`${batch} 완료`, [1]],
        [`${batch} 미완료`, [0, 2]],
        [`${batch} ${person(fixtures.users.b.id)} 들깨`, [0]],
        [`${batch} ${person(fixtures.users.admin.id)}`, [0, 1, 2]],
        [`${batch} 목표연도:${year - 1} 6월`, [0]],
        [`${batch} 빗물관리`, [0]],
        [`${batch} 토양개량`, [1]],
        [`${batch} 연결검색희귀단어`, [1]],
        [`${batch} 목표연도:${year}`, [2]],
      ] as [string, number[]][]) {
        await search.fill(query);
        for (const [i, entry] of saved.slice(0, 3).entries())
          await expect(
            page.getByRole("button", { name: entry.title, exact: true }),
          ).toHaveCount(expected.includes(i) ? 1 : 0);
      }
      await search.fill(`${batch} 완료`);
      const download = page.waitForEvent("download");
      await page.getByRole("button", { name: "CSV", exact: true }).click();
      const file = await download;
      const content = readFileSync((await file.path())!, "utf8");
      expect(content).toContain(saved[1].title);
      expect(content).not.toContain(saved[0].title);
      await page.locator(".plan-results summary").click();
      await expect(page.locator(".plan-summary")).toContainText("전체 1");
      await search.fill("");
      for (const entry of saved.slice(0, 3))
        await expect(
          page.getByRole("button", { name: entry.title, exact: true }),
        ).toHaveCount(1);
      const rows = await page.locator("tbody").innerText();
      expect(rows.indexOf(saved[1].title)).toBeLessThan(
        rows.indexOf(saved[0].title),
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    } finally {
      await ctx.close();
      for (const entry of saved.reverse())
        expect(
          (
            await db.rpc("trash_entry", {
              p_id: entry.id,
              p_version: entry.version,
            })
          ).error,
        ).toBeNull();
      await db.auth.signOut();
    }
  });
}
