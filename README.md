# 함께그린

한 농장을 여러 사람이 함께 관리하는 한국어 반응형 웹앱입니다. 선택형 농작업일지·사진, 운영·교류 기록, 농장계획 연결, 문서·링크 공유, 계정별 권한, 휴지통, CSV와 수동 백업을 제공합니다.

**현재 상태: 소스 구현과 로컬 검증을 마쳤으며, 사용자의 요청으로 무료 서비스 연결을 진행 중입니다. 공개 접속 주소는 https://asia-outer.pages.dev/ 입니다. Cloudflare의 배포 성공 화면을 확인했으며, 실서버 로그인·공동 사용 검증을 진행 중입니다.** 사용자가 Supabase 설치·권한 확인·관리자 지정·공개 회원가입 차단을 완료했다고 확인했습니다. 실제 배포 사이트의 로그인·공동 저장은 배포 후 검증해야 합니다. 시험 계정·자료는 로컬 Docker 서버에만 있으며 운영 서비스에 업로드하지 않았습니다.

[현재 배포 진행 상태](docs/DEPLOYMENT_PROGRESS.md)

- [사용·초대·백업 안내](docs/USER_GUIDE.md)
- [무료 한도·비용·공식 출처](docs/FREE_TIER.md)
- [무료 서비스 연결·배포 순서](docs/DEPLOYMENT.md)
- [검증 결과와 제약](docs/VALIDATION.md)
- [저장 구조와 권한 설계](docs/ARCHITECTURE.md)

## 개발 환경

Node.js 22.12 이상 또는 24 LTS, npm, Docker가 필요합니다. 브라우저 테스트에는 Chromium이 필요합니다. 이 클라우드 환경은 각 작업마다 이미 격리되어 있으므로 기존 `/workspace/asia_outer` 체크아웃을 사용하며 별도 Git worktree를 만들지 않습니다.

```bash
cd /workspace/asia_outer
npm ci
npm run db:start
npm run test:integration
npm run dev
```

`db:start`는 테스트용 PostgreSQL·Supabase Auth·Storage·PostgREST를 시작하고, 첫 실행에만 스키마를 적용합니다. 로컬 서명키는 무작위 생성되어 무시되는 `.env.*` 파일에 저장됩니다. 기존 `.env.local`은 덮어쓰지 않습니다. 운영용 Supabase 설정이 있다면 로컬 테스트 설정과 섞지 마세요. 외부 환경에서는 [배포 안내](docs/DEPLOYMENT.md)의 설정을 사용합니다.

`test:integration`은 루프백 테스트 서버에서만 실행되며 `[시험]` 계정과 자료를 만듭니다. `.env.test-fixtures.json`에는 자동 생성된 시험 로그인 정보가 있으므로 Git에 추가하거나 공유하지 마세요. 운영용 데이터나 계정은 생성하지 않습니다.

프런트엔드 개발 서버 포트는 5173, 테스트 API는 54321입니다. 이 주소는 개발 머신 내부 전용이며 농장 참여자에게 공유할 운영 주소가 아닙니다. 테스트 API와 개별 서비스는 루프백에만 바인딩됩니다.

## 검증 명령

```bash
npm test
npm run test:integration
# npm run dev가 실행 중인 별도 터미널에서
npm run test:e2e
npm run build
```

브라우저 테스트의 기본 Chromium 경로는 `/usr/bin/chromium`입니다. 다른 환경은 `CHROMIUM_PATH`를 지정하세요. Playwright가 제공하는 브라우저를 쓰려면 설정의 `executablePath`를 맞추세요. 각 브라우저 테스트 자료는 별도의 시험 표식을 사용합니다.

백업 복구 검증은 빈 복구용 로컬 서버가 필요합니다.

```bash
FARM_LOCAL_INSTANCE=restore npm run db:start
npm run test:backup
FARM_LOCAL_INSTANCE=restore npm run db:stop
```

두 번째 실행에서 복구 대상이 비어 있지 않으면 안전하게 거부합니다. **복구 시험 자료를 버려도 되는 경우에만** `FARM_LOCAL_INSTANCE=restore npm run db:reset`으로 복구 시험 서버를 비우고 다시 시작합니다. 기본 서버의 `npm run db:reset`도 테스트 기록과 파일을 삭제하므로 일상적인 시작 절차에 사용하지 마세요. 일반 종료는 `npm run db:stop`이며 볼륨을 보존합니다.

## 운영 구조

React·TypeScript·Vite 화면을 Cloudflare Pages Free에 정적으로 배포하고, Supabase Free의 Auth·PostgreSQL·비공개 Storage에 연결합니다. 추가 결제 기능, SMS, 유료 이미지 변환, 유료 백업은 활성화하지 않습니다. 브라우저에 들어가는 것은 공개용 publishable/anon 키뿐이며 `service_role` 키는 절대 `VITE_` 변수나 프런트엔드에 넣지 않습니다.

농장 이름의 초기값은 `우리 농장 (임시 이름)`입니다. 실제 구역·작물·참여자·작업 내용은 만들어 넣지 않습니다. 관리자가 앱에서 설정합니다.

### 감정표현·댓글 검증

`npm run db:start` → `npm run test:integration`으로 로컬 서비스와 시험 계정을 준비한 뒤 `npm run test:discussion`, `npm run test:e2e -- tests/browser/discussion.spec.ts`를 실행합니다. 실제 운영 프로젝트를 대상으로 시험 데이터를 만들지 않습니다. 신규 설치는 마이그레이션 파일을 날짜순으로 모두 실행하고, 기존 설치는 새 마이그레이션만 적용합니다.

### 선택형 농작업 검증

기존 `npm run test:integration` 다음 `npm run test:selection`로 최소 입력·운영 연결·권한·기존 데이터 보존을 확인합니다. `npm run test:e2e`에는 모바일 선택 입력, 사진 우선 보완, 필터/복사, 계획에서 작성, 관리자 목록 변경과 기존 기능 회귀 검증이 포함됩니다. 운영 추가 SQL은 `supabase/migrations/202610190002_selectable_work.sql`입니다. 백업/복구에 새 항목과 참여자 UUID 치환이 포함됩니다.

### 복수 선택 검증

로컬 계정 준비 후 `npm run test:multi`로 복수 저장·이전 클라이언트 보존·두 번째 계획 삭제 보호·권한을 검증합니다. 브라우저 `tests/browser/multi.spec.ts`는 PC·모바일의 여러 작업/작물/장소/계획 선택, 수정·해제·복사·찾기를 검사합니다. 신규 설치는 날짜순 모든 마이그레이션, 기존 선택형 설치는 `202610200001_multi_recording.sql`만 추가 실행합니다.
