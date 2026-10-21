import {
  LayoutDashboard,
  CalendarDays,
  BookOpen,
  Users,
  FolderOpen,
  CloudSun,
  Settings,
  Network,
} from "lucide-react";
export const navigation = [
  {
    id: "home",
    name: "홈",
    icon: LayoutDashboard,
    description: "농장 현황을 한눈에 살펴봐요.",
    features: [
      "안녕동 농장 날씨",
      "계획·기록·자료 요약",
      "최근 농작업과 다가오는 계획",
    ],
  },
  {
    id: "plan",
    name: "농장계획",
    icon: CalendarDays,
    description: "농장 일정과 연결된 기록을 확인해요.",
    features: [
      "연도·날짜·상태 통합 찾기",
      "계획 작성과 실행 결과",
      "관련 농작업·운영 기록 연결",
    ],
  },
  {
    id: "log",
    name: "농작업일지",
    icon: BookOpen,
    description: "농작업과 생육 관찰을 기록하고 찾아봐요.",
    features: [
      "작업·작물·장소 복수 선택",
      "사진·문서 첨부와 통합 찾기",
      "댓글·감정표현, 이전 작업 복사",
    ],
  },
  {
    id: "activity",
    name: "운영·교류",
    icon: Users,
    description: "공동체 활동을 함께 남겨요.",
    features: [
      "회의·운영, 교육·견학, 행사·교류",
      "판매·홍보, 나눔·봉사, 자재·행정",
      "사진·문서·참여자와 계획 연결",
    ],
  },
  {
    id: "resource",
    name: "자료함",
    icon: FolderOpen,
    description: "함께 참고할 자료를 나누고 찾아봐요.",
    features: [
      "문서·사진·웹링크 공유",
      "분류별 조회와 검색",
      "첨부 내려받기, 댓글·감정표현",
    ],
  },
  {
    id: "info",
    name: "영농정보",
    icon: CloudSun,
    description: "농사에 필요한 외부 정보를 찾아요.",
    features: [
      "날씨누리·흙토람·농사로",
      "농업기상재해 조기경보",
      "용인시 농업기술센터·농산물 가격",
    ],
  },
  {
    id: "admin",
    name: "농장 관리",
    icon: Settings,
    description: "농장 설정과 참여자·자료를 관리해요.",
    features: [
      "농장 이름·구역·작물·작업·자료 분류",
      "참여자 권한·초대 코드",
      "첨부 복구·휴지통·백업",
    ],
  },
  {
    id: "sitemap",
    name: "사이트맵",
    icon: Network,
    description: "앱의 전체 메뉴 구조와 주요 기능을 한눈에 확인하세요.",
    features: [],
  },
];
