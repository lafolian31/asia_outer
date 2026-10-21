import { Network, ArrowRight } from "lucide-react";
import { navigation } from "../lib/navigation";
import type { Role } from "../lib/types";
export function SiteMap({
  farmName,
  role,
  onNavigate,
}: {
  farmName: string;
  role: Role;
  onNavigate: (page: string) => void;
}) {
  const menus = navigation.filter(
    (menu) =>
      menu.id !== "sitemap" && (menu.id !== "admin" || role === "admin"),
  );
  return (
    <section className="site-map" aria-label="앱 메뉴 구조">
      <div className="site-map-root">
        <Network size={25} />
        <div>
          <strong>{farmName}</strong>
          <p>전체 메뉴 · 현재 화면: 사이트맵</p>
        </div>
      </div>
      <div className="site-map-grid">
        {menus.map((menu) => (
          <article className="site-map-card" key={menu.id}>
            <h2>
              <button
                type="button"
                aria-label={`${menu.name} 메뉴로 이동`}
                onClick={() => onNavigate(menu.id)}
              >
                <menu.icon size={22} />
                <span>{menu.name}</span>
                <ArrowRight size={18} />
              </button>
            </h2>
            <p>{menu.description}</p>
            <ul>
              {menu.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
            {menu.id === "admin" && <small>관리자 전용</small>}
          </article>
        ))}
      </div>
      <div className="site-map-help">
        <h2>어느 화면에서나 사용할 수 있어요</h2>
        <p>
          화면 상단에서 글자 크기 조절, 새로고침, 비밀번호 변경, 로그아웃을 할
          수 있습니다.
        </p>
        <p>
          {role === "viewer"
            ? "열람자는 기록과 자료를 볼 수 있습니다. 작성·수정·관리는 부여된 권한에 따라 제한됩니다."
            : "기록 작성과 수정은 부여된 권한에 따라 사용할 수 있습니다. 농장 관리는 관리자에게만 표시됩니다."}
        </p>
      </div>
    </section>
  );
}
