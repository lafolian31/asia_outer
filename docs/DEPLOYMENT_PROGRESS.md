# 무료 배포 진행 상태

이 문서는 설치 진행 상황이며, 공개 서비스의 기능 검증 통과를 의미하지 않습니다.

## 사용자 화면·응답으로 확인한 내용

- Supabase 조직에 FREE 표시, 프로젝트 Healthy, 서울 지역 확인.
- 초기 조회에서 기존 앱 테이블과 farm-files 버킷이 없음을 확인.
- 설치 SQL 실행 성공 보고.
- 테이블 6개 RLS, 비공개 파일 버킷, 익명 직접 조회 차단, 인증 계정 저장 RPC 실행 권한을 확인하는 조회가 모두 true였다고 확인.
- 소유자의 Auth 계정 생성과 초기 관리자 지정 SQL 실행 성공 보고.
- 공개 회원가입 OFF, 익명 로그인 OFF, 이메일 확인 ON 상태를 화면으로 확인하고 저장 완료 보고.
- Publishable key 위치 확인. 키나 비밀번호는 소스에 넣지 않음.
- Cloudflare 계정 생성, Pages Git 연결 및 GitHub 본인 확인 진행.
- Cloudflare의 저장소 선택 화면에 asia_outer가 보이는 상태.

## 다음 단계

1. 이 소스를 GitHub의 main 브랜치에서 사용할 수 있게 준비.
2. Cloudflare Pages에서 asia_outer 선택 후 빌드 설정 적용: 명령 npm run build, 출력 dist, Node 24.
3. 사용자가 Pages 빌드 환경변수에 VITE_SUPABASE_URL과 공개용 VITE_SUPABASE_ANON_KEY를 직접 입력. secret/service_role 키는 사용하지 않음.
4. 무료 Pages 배포 후 실제 HTTPS 주소 확인, Supabase Site URL 설정.
5. 실제 사이트에서 관리자 로그인과 설정·기록 저장을 확인. 별도 시험 계정으로 권한·공유·파일을 검증하고 운영 자료와 분리.

유료 플랜·도메인 구매·유료 Workers/R2·메일 서비스는 활성화하지 않습니다. 사용자에게는 한 번에 한 단계씩 안내합니다. 로컬 파일 경로와 도구의 이미지 출력은 이 사용자에게 보이지 않았으므로 검수용 접속 주소로 안내합니다.
