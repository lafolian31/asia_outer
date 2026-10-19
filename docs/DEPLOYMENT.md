# 무료 서비스 연결·배포

현재 공개 접속 주소는 https://asia-outer.pages.dev/ 입니다. Cloudflare 배포 성공 화면을 확인했고, 실서버 로그인·공동 사용 검증을 진행 중입니다. 완료한 단계와 남은 단계는 [배포 진행 상태](DEPLOYMENT_PROGRESS.md)를 확인하세요. 아래 내용은 전체 설치 절차이며, 이미 설치한 SQL을 다시 실행하지 않습니다.

## 1. 무료 Supabase 프로젝트

1. 서비스 소유자의 계정으로 새 **Free 조직·프로젝트**를 만듭니다. 기존 Pro 조직 안에 만들면 무료 프로젝트가 되지 않으므로 플랜을 확인합니다. 결제 기능이나 유료 옵션이 나타나면 승인 없이 진행하지 않습니다.
2. 가능하면 가까운 리전을 선택합니다. 프로젝트 DB 비밀번호는 서비스의 안전한 설정 또는 비밀번호 관리 도구에 보관합니다. 채팅·소스에 넣지 않습니다.
3. SQL Editor에서 `supabase/migrations/202610160001_farm.sql`을 **새 프로젝트에 한 번** 실행합니다. 이 파일은 앱 테이블, RPC, RLS, 비공개 `farm-files` 버킷을 만듭니다. 기존 업무 DB와 섞지 않습니다.
   이어서 `supabase/migrations/202610180001_resource_categories.sql`을 실행합니다. 기존 설치에 분류 기능을 추가할 때는 이 두 번째 파일만 실행합니다. 기존 자료를 삭제하지 않으며 반복 실행해도 설정한 목록을 초기화하지 않습니다.
   감정표현·댓글 기능에는 이어서 `supabase/migrations/202610190001_discussion.sql`을 실행합니다. 기존 설치에는 이 파일만 추가 실행합니다. 작업일지·자료는 보존되며 댓글·감정표현 전용 테이블과 권한 검사가 추가됩니다.
   선택형 농작업·운영 기록에는 `supabase/migrations/202610190002_selectable_work.sql`을 추가 실행합니다. 기존 기록의 분류를 추정하지 않으며 사진·작성자·계획 연결을 유지합니다. 운영 SQL 적용 전에는 UI가 기존 입력 방식으로 동작하고 운영 기록 생성을 제한합니다.
4. Authentication 설정에서 Email·Password 사용, **공개 회원가입 비활성화**를 확인합니다. 로그인 계정이 있어도 별도 참여 승인 없이는 농장 자료를 볼 수 없습니다.
5. Authentication → Users → Add user에서 소유자 본인의 이메일·12자 이상 임시 비밀번호로 계정을 생성하고 확인 완료 상태를 설정합니다. Invite by email 기능은 기본 SMTP 제약 때문에 사용하지 않습니다.
6. `scripts/initialize-owner.sql`의 `owner_email`을 그 계정 이메일로 바꾸고 SQL Editor에서 실행합니다. 이것이 최초 관리자 지정이며, 선착순 회원가입자가 관리자가 되는 방식이 아닙니다.
7. API 설정에서 **Project URL**과 **publishable key 또는 legacy anon key**를 확인합니다. 이 공개 키만 화면 연결에 사용합니다. `service_role/secret` 키는 브라우저에 넣지 않습니다.
8. Storage에서 `farm-files`가 **Private**인지 확인합니다. Public으로 전환하지 않습니다. 프로젝트 글로벌 업로드 한도는 앱 문서 10MiB 이상·Free 상한 이내로 두며 버킷 자체는 10MiB 제한입니다.

Hosted Supabase에는 `scripts/local-bootstrap.sql`과 `scripts/local-storage-grants.sql`을 실행하지 않습니다. 이는 시험용 최소 Docker 서버 구성 전용입니다.

## 2. Cloudflare Pages Free

1. [무료 조건](FREE_TIER.md)과 현행 약관을 확인한 뒤 Free 계정의 Workers & Pages → Pages에서 정적 사이트를 만듭니다. 소스 저장소를 연결하거나 빌드 결과물을 Direct Upload할 수 있습니다. Git 연결에는 이 저장소의 `main` 브랜치를 사용합니다.
2. Git 연결 방식의 빌드 명령은 `npm run build`, 출력 폴더는 `dist`, Node.js는 24 또는 22.12 이상입니다. Pages Functions·Workers·R2를 만들 필요가 없습니다.
3. Pages 빌드 환경변수에 다음 **공개 설정**을 입력합니다.

   ```text
   VITE_SUPABASE_URL = 프로젝트의 HTTPS URL
   VITE_SUPABASE_ANON_KEY = 프로젝트의 publishable 또는 anon 키
   ```

4. 로컬에서 직접 빌드 후 업로드하려면 `.env.production.local`에 위 두 공개 설정을 넣습니다. `.env.local`에 남은 로컬 시험 주소가 우선할 수 있으므로 배포 빌드에서는 쉘 환경변수로 운영 값을 명시하거나 로컬 시험 설정을 별도 보관합니다. `VITE_`는 공개 번들에 포함되므로 비밀키를 절대로 쓰지 않습니다.

   ```bash
   npm ci
   npm run build
   ```

5. `dist` 폴더 전체를 배포합니다. `_headers`와 `_redirects`도 포함되어야 합니다. 제공되는 `pages.dev` HTTPS 주소가 실제 참여자 접속 주소가 됩니다. 별도 유료 도메인은 필요하지 않습니다.
6. Supabase Auth의 Site URL을 실제 HTTPS 주소로 맞춥니다. 필요하다면 허용 Redirect URL도 정확한 해당 주소로 지정합니다. 본 앱은 이메일 링크 로그인·메일 초대를 사용하지 않습니다.

저장소의 현재 `dist`는 **로컬 시험 설정으로 빌드된 결과일 수 있습니다.** 그대로 운영 배포하지 말고 운영 공개 설정으로 다시 빌드하세요. 소스 배포 압축파일에는 로컬 설정·시험 계정·빌드 결과를 포함하지 않습니다.

## 3. 공개 전 실서버 확인

서비스 연결 후 최초 관리자로 로그인하여 농장 이름·구역·작물을 설정합니다. 시험용 별도 계정으로 아래를 확인하고 운영 자료와 시험 자료를 구분합니다.

- 두 계정에서 새 일지·사진·문서를 공동 조회하고 재로그인 후 유지.
- 타인의 수정·삭제, 열람자의 쓰기, 비참여자·접근 해제자의 기록·파일 접근 차단.
- 계획 → 일지 연결 → 결과 입력 → 명시적인 완료 처리.
- 초대 코드 참여, 비밀번호 변경, 관리자 권한 변경, 휴지통 복원.
- CSV와 파일 포함 백업·빈 별도 프로젝트 복구.
- 모바일 실기기의 촬영/사진 선택, 다운로드와 PDF 열기.
- Supabase 조직 Free 플랜·사용량과 Cloudflare Pages Free 상태.

로컬 검증 결과가 hosted 프로젝트 설정까지 자동으로 검증해 주지는 않습니다. 이 확인이 끝난 뒤 승인된 참여자에게 실제 `pages.dev` 주소를 직접 전달합니다. 현재 실제 주소나 외부 참가자 초대 메시지는 생성·발송하지 않았습니다.
