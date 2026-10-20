import { useState } from "react";
import {
  CloudSun,
  Sprout,
  BookOpen,
  ShieldAlert,
  ExternalLink,
  Search,
  MapPin,
  ChartNoAxesCombined,
} from "lucide-react";
const sites = [
  {
    name: "기상청 날씨누리",
    agency: "기상청",
    url: "https://www.weather.go.kr/w/index.do",
    icon: CloudSun,
    description: "기온, 강수확률·강수량, 바람과 기상특보를 확인해요.",
    use: "파종·관수·방제·수확 전 날씨 확인",
    steps:
      "날씨누리에서 농장 지역을 선택하고 작업 날짜의 예보와 특보를 확인하세요.",
    tags: [
      "파종·심기",
      "물·양분 관리",
      "병해충·방제",
      "수확",
      "시설·재해 대비",
    ],
  },
  {
    name: "흙토람",
    agency: "농촌진흥청",
    url: "https://soil.rda.go.kr/",
    icon: Sprout,
    description:
      "토양 특성, 토양환경지도, 토양검정과 비료사용처방 정보를 찾아요.",
    use: "토양개량·작물 선택·시비계획 참고",
    steps:
      "농장 위치의 토양정보를 찾고, 비료 계획은 해당 필지의 토양검정 결과와 함께 확인하세요.",
    tags: ["파종·심기", "물·양분 관리"],
  },
  {
    name: "농사로",
    agency: "농촌진흥청",
    url: "https://www.nongsaro.go.kr/",
    icon: BookOpen,
    description: "작물별 재배기술, 병해충과 친환경농업 정보를 찾아요.",
    use: "재배방법 검색·생육 관리·농작업 문제 해결",
    steps:
      "작물 이름과 궁금한 작업이나 증상을 함께 검색하세요. 예: 들깨 파종, 토마토 병해충.",
    tags: ["파종·심기", "물·양분 관리", "병해충·방제", "수확"],
  },
  {
    name: "농업기상재해 조기경보시스템",
    agency: "농촌진흥청 농업기상 서비스",
    url: "https://agmet.kr/",
    icon: ShieldAlert,
    description: "농장 단위 기상위험과 냉해·폭염 등 재해 대응 정보를 확인해요.",
    use: "기상재해 사전 점검·시설과 작물 보호",
    steps:
      "서비스의 지원 지역과 작물을 확인하고 농장 위치를 설정하세요. 맞춤 기능은 가입이나 농장 등록이 필요할 수 있어요.",
    tags: ["병해충·방제", "시설·재해 대비"],
  },
  {
    name: "용인시 농업기술센터",
    agency: "용인특례시",
    url: "https://www.yongin.go.kr/atc/index.do",
    icon: MapPin,
    description: "용인 지역 농업교육, 공지사항과 농업기술 지원 정보를 찾아요.",
    use: "지역 교육·행사 확인·영농 상담과 지원 안내",
    steps:
      "공지사항과 교육 안내에서 모집 일정·신청 방법·대상을 확인하세요. 영농 상담과 지원 서비스는 센터의 담당 부서 안내를 참고하세요.",
    tags: ["지역·교육"],
  },
  {
    name: "농산물유통정보 KAMIS",
    agency: "한국농수산식품유통공사(aT)",
    url: "https://www.kamis.or.kr/customer/main/main.do",
    icon: ChartNoAxesCombined,
    description:
      "농산물 가격을 품목별로 찾아보고, 도매·소매 가격과 추이를 확인해요.",
    use: "수확물 판매·나눔 준비·농산물 시세 비교",
    steps:
      "도매·소매 구분과 품목·품종·등급·지역·조회일·단위를 맞춰 비교하세요. 조사 가격은 실제 농장 판매가격과 다를 수 있어요.",
    tags: ["가격·판매", "수확"],
  },
];
const topics = [
  "전체",
  "파종·심기",
  "물·양분 관리",
  "병해충·방제",
  "수확",
  "시설·재해 대비",
  "지역·교육",
  "가격·판매",
];
export function FarmingInfo() {
  const [topic, setTopic] = useState("전체");
  const [query, setQuery] = useState("");
  const shown = sites.filter(
    (site) =>
      (topic === "전체" || site.tags.includes(topic)) &&
      `${site.name} ${site.agency} ${site.description} ${site.use} ${site.steps} ${site.tags.join(" ")}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  return (
    <section className="farming-info" aria-label="영농정보">
      <div className="info-tools">
        <label className="search-box">
          <Search size={19} />
          <input
            type="search"
            aria-label="영농정보 찾기"
            placeholder="날씨, 토양, 교육, 농산물 가격 등 찾기"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="info-topics" role="group" aria-label="작업별 정보 선택">
          {topics.map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={topic === value}
              onClick={() => setTopic(value)}
            >
              {value}
            </button>
          ))}
        </div>
      </div>
      <div className="info-grid">
        {shown.map((site) => (
          <article className="info-card" key={site.url}>
            <div className="info-card-heading">
              <span className="info-icon">
                <site.icon size={25} />
              </span>
              <div>
                <small>{site.agency}</small>
                <h2>{site.name}</h2>
              </div>
            </div>
            <p>{site.description}</p>
            <p className="info-purpose">
              <strong>이럴 때 활용해요</strong>
              {site.use}
            </p>
            <details>
              <summary>활용 방법</summary>
              <p>{site.steps}</p>
            </details>
            <a
              className="primary info-link"
              href={site.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${site.name} 열기 (새 탭)`}
            >
              사이트 열기 <ExternalLink size={16} />
            </a>
          </article>
        ))}
      </div>
      {!shown.length && (
        <p className="inset" role="status">
          조건에 맞는 정보가 없습니다. 검색어나 작업 선택을 바꿔 주세요.
        </p>
      )}
      <p className="info-note">
        공식 사이트로 연결되며 새 탭에서 열립니다. 예보·토양·재해 정보는 각
        사이트에서 농장 지역과 기준 시각을 확인해 주세요. 맞춤 정보는 서비스별
        지원 범위와 가입 조건에 따라 달라집니다.
      </p>
    </section>
  );
}
