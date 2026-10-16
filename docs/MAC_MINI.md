# Mac mini 독립 설치 및 승인형 동기화

## 범위와 현재 운영 상태

코드는 dry-run과 명시적 적용을 지원한다. 기본값은 `AER_ENABLE_WRITES` 미설정/0이며 실제 Calendar 쓰기를 거부한다. `AER duty`를 먼저 조회하고 미리보기를 발급한 뒤 같은 웹 세션/Telegram 사용자 채널에서만 적용한다. 자동 삭제는 없다.

이 개발 과정에서는 실제 Calendar 쓰기, Mac mini 설치/재시작, 기존 Hermes polling 변경을 수행하지 않았다. 제공된 원본 Excel에서 22건을 추출해 연결된 Calendar의 22건과 날짜·제목·의료진 설명 내용을 대조했으며 모두 일치했다(공백/줄바꿈은 정규화). 신규·내용 변경 0건이므로 재등록하지 않았다. 독립 OAuth 파일과 봇 소유권이 확인되지 않아 자동화 런타임의 현장 E2E는 아직 미완료다. 기존 22건은 앞선 읽기 전용 조회로 확인했으며 이 저장소에 개인 응답을 보관하지 않는다.

## 이번 읽기 전용 audit 준비

[최소 OAuth audit 절차](READONLY_AUDIT_SETUP.md)를 사용한다. 이번에는 audit 전용 owned.readonly grant만 발급하며 아래 일반 write 설정은 실행하지 않는다. raw ID/private/ETag를 읽은 뒤 실제 건수를 확정해야 한다.

## 준비와 설치

- Node.js 22+, Git, npm, 독립 코드 경로(예: `$HOME/Services/aer-calendar`).
- Google Cloud Calendar API 활성화, 본인 테스트 계정, Desktop app OAuth client JSON.
- 저장소 바깥의 비공개 설정 폴더(700)와 파일(600). 읽기/쓰기 토큰은 서로 다른 파일로 저장한다.
- 상시 운영은 별도 launchd Label만 사용한다. Old Jarvis/Gemini Spark/기존 스케줄러/금융 프로그램의 파일·토큰·프로세스는 재사용하지 않는다.

기존 디렉터리를 덮어쓰지 않는다. 다음은 설치자가 실행하는 예시이며 `PR_HEAD_SHA`는 검증된 PR 전체 SHA로 바꾼다.

```sh
mkdir -p "$HOME/Services"
git clone https://github.com/emdoc119/auto_ER_schedule.git "$HOME/Services/aer-calendar"
cd "$HOME/Services/aer-calendar"
git fetch origin PR_HEAD_SHA
git switch --detach FETCH_HEAD
npm ci --ignore-scripts
npm test
mkdir -p "$HOME/.config/aer-calendar/state"
chmod 700 "$HOME/.config/aer-calendar" "$HOME/.config/aer-calendar/state"
export AER_OAUTH_CLIENT_FILE="$HOME/.config/aer-calendar/client.json"
export AER_OAUTH_TOKEN_FILE="$HOME/.config/aer-calendar/read-token.json"
export AER_OAUTH_WRITE_TOKEN_FILE="$HOME/.config/aer-calendar/write-token.json"
export AER_STATE_DIR="$HOME/.config/aer-calendar/state"
export AER_CALENDAR_ID='YOUR_AER_DUTY_CALENDAR_ID'
chmod 600 "$AER_OAUTH_CLIENT_FILE"
npm run authorize
```

Google 인증 URL을 본인 브라우저에서 열고 읽기 권한만 승인한다. 콜백은 `127.0.0.1:8788`, 제한 시간 5분이다. 원격 브라우저에서는 이 포트도 SSH로 포워딩한다. 기존 토큰을 덮어쓰지 않는다. OAuth client/token은 일반 사용자에게 읽기 가능한 권한이거나 저장소 안이면 거부한다. Calendar 조회 응답 이름은 `AER duty`여야 하고 `primary` ID는 거부한다.

우선 `npm start` 후 `http://127.0.0.1:8787/health`에서 `mode: dry-run`, `writesEnabled: false`를 확인한다. 상시 사용은 터미널 세션 대신 독립 launchd로 전환한다. `docs/launchd.example.plist`의 사용자 경로, Node 절대 경로, Calendar ID를 설치자가 치환하여 새 Label만 등록한다. 예제는 자동 활성화되지 않는다.

## 현재 단계의 운영 보류

[운영 전 검증 보고](PRE_DEPLOY_REVIEW.md)가 우선한다. 현재 추가 승인 없이 main 병합, 쓰기 활성화, gateway 재시작을 수행하지 않는다. 아래 쓰기 설정은 승인 후 참고 절차이며 지금 실행하라는 지시가 아니다.

## Excel에서 적용까지

1. 다른 Mac에서는 `ssh -N -L 8787:127.0.0.1:8787 USER@MAC_MINI`로 연결한다. 서비스는 루프백만 바인딩하며 LAN/인터넷에 노출하지 않는다. 웹 세션은 브라우저 쿠키별로 분리되고 재시작/30분 만료 후에는 새 미리보기가 필요하다.
2. AER 웹에서 Excel을 올린 뒤 **Calendar dry-run 열기**를 누른다. 마지막 선택 파일 한 개를 로컬 화면으로 전달한다. URL/localStorage/공개 서버에 근무표를 넣지 않는다. 공식 Pages origin만 전송을 허용하므로 PR 미배포 시에는 로컬 화면에서 직접 파일을 선택한다.
3. 로컬 화면에서 본인 이름·전공의 목록·파일을 확인하고 **기존 Calendar 조회 후 비교**를 누른다. 새 일정/내용 수정/동일/식별자 연결/검토 항목을 확인한다. 미리보기는 쓰기를 수행하지 않는다.
4. 실제 원본 Excel의 날짜·본인 근무·인계 및 기존 22건 대조를 검증한 뒤 쓰기 인증을 준비한다.

```sh
npm run authorize -- --write
export AER_ENABLE_WRITES=1
```

이 명령은 소유 Calendar 이벤트 쓰기 권한(`calendar.events.owned`)을 별도 토큰에 발급한다. Google에서 실제 동의가 필요하며 이 코드가 자동 승인하지 않는다. 서버를 새 설정으로 시작하고 새 미리보기를 발급한다. **검증된 계획을 Calendar에 적용** 버튼은 쓰기 활성화와 검토 0건인 경우에만 표시된다. 이 버튼이 해당 계획의 실행 승인이다.

적용 전 전체 범위를 재조회하고 미리보기와 다르면 0건 적용 후 새 미리보기를 요구한다. 생성 ID는 개인+날짜 기반 고정값, 수정은 If-Match ETag를 사용한다. 실제 요청 후 다시 전체 조회하여 일치해야 성공으로 보고한다. 중간 실패는 부분 반영 가능성을 알리고 중단하며, 같은 계획 재사용 대신 새 미리보기로 재개한다.

## 기존 22건과 파서 경계

- private key가 없는 기존 일정은 날짜의 단일 종일·동일 제목 후보만 연결한다. 이미 내용이 같아도 비공개 식별자 연결(`adopt`)을 별도 건수로 미리보기에 표시한다. 제목·설명은 바꾸지 않고 기존 unrelated private/shared properties를 유지한다.
- 제목 변경, 중복·시간 지정·반복·취소·다른 소유 식별자 충돌, 업로드에 없는 기존 일정은 검토로 보류한다. 검토가 있으면 전체 적용을 막으며 삭제하지 않는다.
- A열 `11월1일` 또는 `11월1일(일)`, H열 이후 의료진 헤더, `2026년`처럼 명시적인 연도 시트명을 요구한다. 본인/날짜/알 수 없는 코드는 변환을 중단한다. E1/MD는 동료 코드만 지원한다. ICU/EICU/외래/E1은 동료 전용 보조 코드로 읽되 D/N 인계 그룹에는 넣지 않는다.
- 모든 근무는 시작일의 종일 이벤트다. D(I)/N(I)/HEMS/N(I)는 제목을 유지하고 D/N/HEMS-N 그룹으로 동료·인계를 계산한다. 없는 의료진 범주는 생략한다. 월 경계에 필요한 인접 날짜는 같은 통합문서에 넣는다.
- 여러 파일을 웹 화면에 누적해도 전달은 마지막 파일 하나다. 업로드 월 밖의 날짜 이동은 이 조회만으로 판정할 수 없다.
- 기존 수동 ICS/빠른등록 기능은 자동 동기화와 별도이며 중복 방지를 보장하지 않는다.

## 공식 근거

[Calendar events.list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list), [events.patch](https://developers.google.com/workspace/calendar/api/v3/reference/events/patch), [events.insert](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert), [OAuth scopes](https://developers.google.com/workspace/calendar/api/auth), [SheetJS 설치](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/).
