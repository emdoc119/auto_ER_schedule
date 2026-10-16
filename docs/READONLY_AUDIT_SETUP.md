# 최소 OAuth 읽기 전용 Calendar audit

## 범위와 현재 차단

Calendar 쓰기, Hermes 설정 변경, gateway 재시작, main 병합 없이 실제 create/update/adopt/noop/review를 확정하기 위한 준비다. 현재 전용 Desktop OAuth JSON과 audit 토큰이 없어 직접 raw API audit는 아직 실행하지 않았다. 기존 커넥터의 metadata 누락을 속성 부재로 간주하지 않는다.

Google Cloud UI를 읽기 전용으로 확인했다. AER 이름의 전용 프로젝트는 검색되지 않았고 새 프로젝트 생성 화면은 무료 평가판 프로젝트 한도 도달을 표시했다. 기존 다른 프로젝트·OAuth 클라이언트는 수정하지 않았다. 새 프로젝트 또는 사용할 별도 프로젝트/전용 Desktop 클라이언트가 정해져야 발급을 이어갈 수 있다. 프로젝트 삭제·한도 요청·기존 앱 재사용을 자동으로 하지 않는다.

## 최소 권한

`https://www.googleapis.com/auth/calendar.events.owned.readonly` 하나만 사용한다. AER duty 소유 계정으로 이벤트 ID, ETag, 내용과 해당 Calendar 복사본의 extendedProperties.private를 읽는다. 별도의 private-property 쓰기 권한은 필요하지 않다.

이 scope는 소유 Calendar 전반의 읽기 권한이며 Google OAuth에서 이름이 AER duty인 Calendar 하나로 권한을 한정하는 것은 아니다. audit 코드는 비공개 설정의 명시적인 Calendar ID만 조회하고 이름 AER duty 및 owner 응답을 검증한다. Calendar ID는 이미 알고 있으므로 calendarlist/설정/ACL scope는 요청하지 않는다. owned scope로 403이 나면 올바른 소유 계정인지 확인하고 중단하며 더 넓은 scope를 자동 추가하지 않는다.

## Google Cloud 준비

1. 기존 운영 앱과 구분되는 audit용 프로젝트를 정하거나 새 프로젝트 한도를 해결한다. 프로젝트 삭제·운영 앱의 동의 화면/클라이언트 변경은 하지 않는다.
2. 그 프로젝트에 Google Calendar API를 사용 설정한다. Google 인증 플랫폼에서 audit 앱을 설정하고 필요한 경우 External / Testing 및 본인 테스트 사용자를 등록한다. app 이름 예시는 AER Readonly Calendar Audit다.
3. 데이터 액세스에서 위 단일 scope를 확인한다. IAM/service-account 키, 결제 연결, 도메인 위임은 필요하지 않다.
4. 클라이언트 유형 Desktop app으로 audit 전용 클라이언트를 만든다. 생성된 JSON은 비공개 로컬 경로에만 둔다. 기존 운영 클라이언트·토큰을 재사용하거나 채팅/Issue/PR에 붙이지 않는다.
5. 새 credential 생성 및 Google 데이터 접근 허용은 실제 수행 직전에 소유자의 확인/동의를 받아 진행한다. 이 문서는 절차이며 생성·동의를 수행한 기록이 아니다.

## 비공개 로컬 입력과 인증

전용 폴더는 700, 파일은 600으로 준비한다. 개인 이름·전공의 목록·원본 경로·Calendar ID는 저장소 밖 audit.env에 둔다. 이번 준비에서는 사용자 로컬에 해당 입력만 준비했고 credential/token은 생성하지 않았다. 실제 파일과 기존 웹의 전공의 기본 목록을 사용한다.

```sh
cd /PRIVATE/CHECKOUT/auto_ER_schedule
source "$HOME/.config/aer-calendar/audit.env"
# 전용 Desktop JSON을 audit-client.json에 저장한 뒤:
chmod 600 "$AER_OAUTH_CLIENT_FILE"
npm run authorize:audit
```

필수 경로는 AER_OAUTH_CLIENT_FILE(Desktop JSON), AER_AUDIT_OAUTH_TOKEN_FILE(새 audit 토큰)다. 일반 authorize --write 명령을 사용하지 않는다. audit 전용 명령은 flags를 받지 않아 --write를 거부하며 scope 하나만 요청한다. PKCE S256/state, loopback callback, 발급 access token의 실제 scopes 검증 후에만 refresh token을 신규 600 파일에 저장한다. 기존 파일은 덮어쓰지 않는다. 실제 grant가 더 넓은 읽기나 쓰기 scope를 포함하면 저장/조회하지 않고 거부한다.

본인 브라우저에서 Google 동의 URL을 열어 요청 권한을 확인한다. callback은 127.0.0.1:8788, helper는 최대 5분 실행된다. 다른 Mac 브라우저라면 이 포트만 SSH로 포워딩한다. 기존 gateway를 시작·중지·재시작하지 않는다. 인증 URL 외 토큰/secret/code/verifier는 로그에 출력하지 않는다. 테스트 앱 토큰의 만료/재동의 정책은 Google 설정에 따른다.

## 실제 건수와 ID/private/ETag 확인

```sh
# audit.env에서 AER_ENABLE_WRITES=0 및 비공개 입력을 읽는다.
source "$HOME/.config/aer-calendar/audit.env"
npm run audit -- "$AER_AUDIT_WORKBOOK" --private-report "$AER_AUDIT_REPORT"
```

- audit는 전용 token의 실제 scope를 먼저 확인한 후 Calendar GET만 수행한다. createRuntime, writer, Telegram 수신기를 시작하지 않는다.
- 전체 업로드 월 범위/KST와 pagination을 사용한다. fields projection에 event id, etag, extendedProperties를 명시한다. 원본 collection kind, owner, AER duty 이름과 각 event의 ID/ETag를 검증하고 빠진 응답은 확정 audit로 취급하지 않는다.
- 터미널에는 counts(create/update/adopt/noop/review), desiredCount/existingCount, mappedIdsPreserved, etagsReady, writes:0만 출력한다. 전용 report 옵션은 raw ID/ETag/private 속성과 기존 ID 매핑을 저장소 밖 700/600 파일에 저장한다. 의료진 본문은 저장하지 않으며 기존 report를 덮어쓰지 않는다. 재실행 시 새 파일명을 사용한다.
- report가 필요 없으면 --private-report를 생략한다. raw API 응답이나 report를 공개 저장소/CI 로그에 넣지 않는다.
- 실제 private 키가 모두 없고 내용이 같으면 예상 adopt22가 확정된다. 이미 관리된 이벤트가 있으면 해당 건수만 noop 등으로 바뀐다. review가 생기면 이관을 보류한다.
- audit는 계획 계산만 하며 adopt도 쓰지 않는다. 22개 기존 ID가 유지되는 매핑과 per-event ETag 준비 여부를 보고한 뒤, 실제 쓰기는 별도 승인 대상으로 남긴다.

## 검증과 공식 근거

합성 검증은 단일 최소 scope 요청, PKCE/state, 권한 확대/동의 거부/기존 토큰 덮어쓰기 방지, raw private/ETag projection, GET-only 조회, 불완전 응답 거부와 비공개 report 권한을 다룬다. 합성 통과를 실제 OAuth/22건 audit 완료로 표현하지 않는다.

- [Calendar scope 목록](https://developers.google.com/workspace/calendar/api/auth)
- [events.list 권한·응답·페이지네이션](https://developers.google.com/workspace/calendar/api/v3/reference/events/list)
- [Event ID/ETag/extendedProperties](https://developers.google.com/workspace/calendar/api/v3/reference/events)
- [private 속성은 Calendar ID + event ID의 로컬 복사본 기준](https://developers.google.com/workspace/calendar/api/guides/extended-properties)
- [Desktop OAuth 생성](https://developers.google.com/workspace/guides/create-credentials)
- [Native OAuth, PKCE, loopback](https://developers.google.com/identity/protocols/oauth2/native-app)
