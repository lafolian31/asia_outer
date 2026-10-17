# 무료 시험 운영 조건

확인일: **2026-10-17 (Asia/Seoul)**. 공식 문서의 공개 GitHub 원본을 직접 조회했습니다. 이 실행 환경에서는 일부 제품 웹사이트가 네트워크 정책으로 차단되어, 같은 서비스가 관리하는 문서 원본을 근거로 했습니다. 서비스 연결·결제·공개 배포는 하지 않았습니다. 무료 조건은 변경될 수 있으므로 실제 연결일에 다시 확인해야 합니다.

## 선택한 구성

| 항목 | 선택 | 확인한 무료 범위와 제약 |
| --- | --- | --- |
| 화면 호스팅 | Cloudflare Pages Free | 정적 파일 요청 무료·무제한. 빌드 월 500회, 동시 1개, 빌드 20분 제한. 사이트 파일 2만 개, 개별 정적 파일 25MiB. 기본 제공 pages.dev 도메인 사용 |
| 서버·DB | Supabase Free | DB 500MB/프로젝트. Auth·PostgREST로 API 제공. 활성 무료 프로젝트 2개. 일부 사용량 한도는 같은 조직의 프로젝트끼리 공유 |
| 로그인 | Supabase Auth Free | 월 활성 사용자 50,000명. 개인별 이메일·비밀번호 로그인. 농장 참여자에게 ChatGPT·Supabase 유료 구독이 필요하지 않음 |
| 사진·문서 | Supabase Storage Free | 총 1GB. 서비스 자체의 Free 업로드 한도는 개별 50MB이지만 앱은 사진 2MiB·문서 10MiB로 더 작게 제한 |
| 전송량 | Supabase Free | 월 비캐시 5GB / 캐시 5GB, 별도 한도. DB·Auth·Storage 등의 전송량이 집계됨. 본 앱은 인증 다운로드를 사용하므로 캐시 여유를 전제로 계산하지 않음 |
| 백업 | 앱 수동 내보내기 | 무료 플랜의 관리형 일일 백업은 제공되지 않음. CSV·메타데이터·파일 수동 백업과 복구 스크립트를 제공 |

근거:

- [Supabase 플랜별 사용량](https://supabase.com/docs/guides/platform/billing-on-supabase) · [조회한 공식 원본](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/platform/billing-on-supabase.mdx)
- [Supabase 전송량·캐시 한도](https://supabase.com/docs/guides/platform/manage-your-usage/egress)
- [Supabase Free 초과와 서비스 제한](https://supabase.com/docs/guides/platform/billing-faq#what-will-happen-when-i-exceed-the-free-plan-quota)
- [Storage 파일 한도](https://supabase.com/docs/guides/storage/uploads/file-limits)
- [Supabase 백업](https://supabase.com/docs/guides/platform/backups)
- [Cloudflare Pages 제한](https://developers.cloudflare.com/pages/platform/limits/) · [조회한 공식 원본](https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/docs/pages/platform/limits.mdx)
- [Cloudflare Pages 정적 요청 가격](https://developers.cloudflare.com/pages/functions/pricing/#static-asset-requests) · [조회한 공식 원본](https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/docs/pages/functions/pricing.mdx)

## 사진 저장 예상량

앱은 예약·확정 파일 합계를 **900MB**에서 차단하여 서비스의 1GB보다 여유를 둡니다. 휴지통 파일과 미완료 예약도 포함합니다.

- 사진 평균 0.5MB라면 약 1,800장, 평균 1MB라면 약 900장 정도입니다.
- 실제 압축 결과와 문서 크기에 따라 달라지는 **예상치**입니다. 사진 장수를 보장하지 않습니다.
- 사진 보기·원본 다운로드·백업도 전송량을 소비합니다. 0.5MB 사진을 1만 번 받으면 사진만 약 5GB이므로 DB 등 다른 전송량을 함께 고려해야 합니다.
- 관리 화면의 사용량은 앱에 등록·예약된 파일 기준입니다. 서비스 전체의 정확한 저장량·DB 크기·월 전송량은 Supabase 대시보드가 기준입니다.
- 앱 밖에서 같은 프로젝트에 파일을 추가하면 앱의 900MB 제한에 포함되지 않습니다. 운영용 프로젝트를 이 앱 전용으로 사용하세요.

## 휴면·중단·한도 초과

Supabase Free 프로젝트는 **7일간 DB 활동이 낮으면 일시 중지될 수 있습니다.** 소유자가 대시보드에서 Resume project로 재개합니다. 확인한 현재 문서의 중지 프로젝트 복구 가능 기간은 최대 1년입니다. 무료 영구 보존이나 무중단 서비스를 보장하지 않습니다.

- [Supabase 프로젝트 일시 중지](https://supabase.com/docs/guides/platform/free-project-pausing)
- Free 한도 초과 시 통지·유예·서비스 제한이 적용될 수 있습니다. DB 쓰기·조회·파일 전송이 제한되면 앱은 실패를 표시합니다.
- 앱 자체 파일 한도에 도달하면 새 업로드를 거부합니다. 백업 후 불필요한 항목을 휴지통에서 영구 삭제하거나 미완료 첨부를 정리합니다. 휴지통으로 옮기기만 해서는 용량이 줄지 않습니다.
- Cloudflare Pages 정적 호스팅에는 조회한 문서에 별도 비활성 7일 자동 중지 조건이 없습니다. 빌드 한도에 도달하면 새 빌드를 다음 한도 회복 시점까지 미뤄야 할 수 있습니다. 정책 위반·서비스 장애로 인한 중단 가능성은 별개입니다.

## 메일·업무 용도·참여자 비용

Supabase 기본 SMTP는 프로젝트 조직의 사전 허용 이메일에만 발송하며, 일반 농장 참여자의 초대·재설정 메일을 보장하지 않습니다. 따라서 첫 버전은 **소유자가 계정 생성 → 관리자가 코드 생성 → 대상자에게 직접 전달**하는 방식입니다. 외부 SMTP·SMS·유료 메일 서비스는 연결하지 않았습니다.

- [공식 SMTP 제한](https://supabase.com/docs/guides/auth/auth-smtp)
- Supabase의 [현행 이용약관](https://supabase.com/terms)에는 조직과 직원·계약자 등의 Authorized User 및 내부 업무 이용을 전제로 한 규정이 있습니다. 조회한 [v4.1 공식 원문](https://github.com/supabase/supabase/blob/master/apps/www/data/legal/terms/v4-1.mdx)과 Free 플랜 문서에서 비상업 개인 전용 제한은 확인되지 않았습니다.
- Cloudflare Pages Free의 조회한 공식 제품·가격 문서에도 개인 비상업 전용 조건은 명시되어 있지 않습니다. 다만 Cloudflare 전체 서비스 약관 페이지는 이 환경에서 직접 확인하지 못했습니다. **공개 배포 전에 계정 소유자가 [Cloudflare 약관](https://www.cloudflare.com/terms/)의 현행 조건을 확인해야 합니다.** 조직 업무 용도에 대한 별도 계약·심사를 마쳤다고 주장하지 않습니다.
- 작업자·관계자는 웹앱 계정만 사용하며 개인별 유료 구독을 요구하는 기능은 없습니다. 서비스 소유자의 관리 계정과 일반 앱 계정은 다릅니다.

## 0원 유지 원칙

Cloudflare **Free**, Supabase **Free 조직**을 선택하고 유료 플랜 전환·자동 업그레이드·추가 기능 구매를 하지 않습니다. Free 초과 시 제한을 받아들이는 구성입니다. Pro 플랜의 spend cap은 Pro 기본 구독료 자체를 없애지 않으므로 0원 구성의 대안으로 사용하지 않습니다.

활성화하지 않은 항목: 유료 컴퓨트, 유료 이미지 변환, PITR·관리형 백업, 유료 도메인, 유료 메일·SMS, Cloudflare 유료 Workers·R2. 별도 도메인은 필요하지 않습니다. 호스팅과 DB 계정을 연결하지 않았기 때문에 현재 이 앱으로 발생한 외부 운영비도 없습니다.

사용자의 ChatGPT/Codex 구독·크레딧은 앱의 호스팅·저장 비용과 별개입니다. 개발 도구 구독이 앱 운영 비용을 대신 부담하지 않습니다.
