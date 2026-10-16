# 독립 Mac mini 설치 및 사용

## 현재 범위

이번 버전은 dry-run 전용이다. Calendar API는 GET 조회만 구현되어 있고 OAuth 권한도 `calendar.events.readonly`다. apply/sync/delete API는 없다. 기존 22건에 쓰지 않았고 실제 Excel과의 전수 비교도 아직 하지 않았다. 실제 자동 반영은 별도 승인 후 구현·검증해야 한다.

2026-10-16 개발 시 연결된 `AER duty`의 2026-11-01~2027-01-01 구간 22건을 읽기 전용으로 확인했다. 개인 일정 내용·ID·의료진 명단은 이 저장소에 보관하지 않았다.

## 필요한 구성요소

1. Mac mini 전용 사용자 소유 디렉터리(예: `$HOME/Services/aer-calendar`), Node.js 22 이상, npm, Git.
2. Google Cloud 프로젝트에서 Calendar API 활성화, 본인 계정을 테스트 사용자로 등록한 OAuth 동의 화면, **Desktop app OAuth client** JSON.
3. 읽기 전용 OAuth refresh token. 이 도구의 `npm run authorize`로 최초 발급한다. ChatGPT 연결의 토큰을 복사하지 않는다.
4. 저장소 바깥의 비공개 설정 폴더(예: `$HOME/.config/aer-calendar`, 권한 700), OAuth 파일 권한 600.
5. 상시 사용할 때 이 서비스만을 위한 별도 launchd 항목. 기존 launchd, Old Jarvis, Gemini Spark, 기존 스케줄러 및 금융 프로그램은 수정하지 않는다.

아직 Mac mini에는 아무것도 설치·기동하지 않았다. 아래는 설치자가 실행하는 예시다. `PR_HEAD_SHA`는 검증된 PR의 전체 HEAD SHA로 바꾼다. 기존 폴더를 덮어쓰지 말고 검증된 PR 커밋을 체크아웃한다.

```sh
mkdir -p "$HOME/Services"
git clone https://github.com/emdoc119/auto_ER_schedule.git "$HOME/Services/aer-calendar"
cd "$HOME/Services/aer-calendar"
git fetch origin PR_HEAD_SHA
git switch --detach FETCH_HEAD
npm ci --ignore-scripts
npm test
mkdir -p "$HOME/.config/aer-calendar"
chmod 700 "$HOME/.config/aer-calendar"
```

Desktop OAuth JSON을 비공개 폴더의 `client.json`으로 복사한 뒤 다음을 설정한다. Calendar ID는 본인의 Google Calendar 설정에서 **AER duty의 실제 ID**를 확인해서 사용한다. `primary`는 거부되며 조회 응답의 달력 이름도 `AER duty`인지 검증한다.

```sh
export AER_OAUTH_CLIENT_FILE="$HOME/.config/aer-calendar/client.json"
export AER_OAUTH_TOKEN_FILE="$HOME/.config/aer-calendar/token.json"
export AER_CALENDAR_ID='YOUR_AER_DUTY_CALENDAR_ID'
chmod 600 "$AER_OAUTH_CLIENT_FILE"
npm run authorize
```

출력된 Google 인증 URL을 Mac mini 브라우저에서 열고 본인 계정으로 읽기 권한만 승인한다. 콜백은 `127.0.0.1:8788`이며 5분 후 종료된다. token.json은 신규 파일로만 600 권한으로 작성한다. 기존 token.json이 있으면 덮어쓰지 않는다. 원격 브라우저로 인증할 때는 8788 포트도 SSH 로컬 포워딩해야 한다. 테스트 모드 OAuth 앱의 토큰 만료/재동의 정책은 Google Cloud 설정에 따른다.

최초 동작 확인은 같은 환경변수로 `npm start`를 실행하고 `http://127.0.0.1:8787/health`에서 `mode: dry-run`, `writesEnabled: false`를 확인한다. 계속 사용할 때는 터미널에 남겨두지 말고 독립 launchd로 전환한다.

## 독립 launchd 구성

`docs/launchd.example.plist`의 `REPLACE_HOME`과 Node 절대 경로를 설치자의 실제 값으로 치환한 복사본을 만든다. 예제는 활성 파일이 아니며 자동 등록되지 않는다. 새 Label `local.aer-calendar.preview`를 사용하고 이 Label만 등록한다. 기존 서비스의 포트·환경·파일을 재사용하지 않는다. 실행 경로에 현재 PR의 검증된 커밋을 설치하고, 시크릿은 환경변수 값이 아닌 별도 파일 경로로만 전달한다. 로그에는 업로드·일정·토큰을 기록하지 않는다.

## Excel 업로드 → 비교

1. Mac mini 서비스가 시작된 상태에서, 다른 Mac에서는 `ssh -N -L 8787:127.0.0.1:8787 USER@MAC_MINI`로 연결한다. Mac mini 자체에서는 포워딩 없이 사용한다. LAN/인터넷에 8787을 바인딩하지 않는다.
2. PR 병합·Pages 반영 후 기존 AER 페이지에서 본인 이름, 전공의 목록을 입력하고 `.xlsx`를 선택한다. 기존 달력/ICS 미리보기 기능은 유지된다.
3. **Calendar dry-run 열기**를 누른다. 마지막으로 선택한 Excel 한 파일과 입력한 이름이 `127.0.0.1:8787` 화면으로 전달된다. 전달은 정확한 Pages origin과 팝업 source를 검증하는 `postMessage`이며 URL·localStorage·공개 서버에 근무표를 넣지 않는다. 브라우저의 팝업 허용이 필요하다.
4. 로컬 화면에서 파일·본인 이름·전공의 목록을 확인하고 **기존 Calendar 조회 후 비교**를 누른다. 다른 origin에서 연 개발 미리보기나 전송을 지원하지 않는 브라우저에서는 로컬 화면에서 파일을 직접 선택한다. 이 경로는 PR 병합 전에도 사용할 수 있다.
5. 해당 Excel에 포함된 전체 월의 Calendar 이벤트를 먼저 페이지 끝까지 읽는다. 신규/변경/동일/검토 건수와 종일 제목·동료·인계 설명을 확인한다. 실제 반영은 항상 **0건**이다.

여러 Excel을 브라우저 달력에 누적해도 dry-run에는 마지막 파일 하나만 전달한다. 월 경계 인계에 필요한 전월 말·익월 초 자료는 가능하면 동일 통합문서의 연도 명시 시트들에 포함한다. 없는 인계 항목은 추측하지 않고 생략한다. 공개 웹의 기존 사진 인식 경로는 이번 Calendar 입력 대상이 아니다.

## 비교 및 후속 실제 동기화 조건

- 표 구조는 기존과 같이 A열 `11월1일` 또는 `11월1일(일)` 형태, H열 이후 의료진 헤더, 시트명에 `2026년`처럼 연도를 명시한다. 이름/날짜/알 수 없는 근무코드/시트 간 중복 날짜는 fail closed. `E1`, `MD`는 동료 코드로 인식하며 본인 코드로는 지원하지 않으므로 변환을 중단한다.
- `D(I)`, `N(I)`, `HEMS/N(I)`는 기본 코드로 동료·인계를 계산하고 제목에 `(I)`를 보존한다. 종일 종료일은 다음 날의 배타적 날짜다.
- 기존 private key가 없는 일정은 같은 날짜의 단일 종일·동일 제목 후보만 매칭한다. 설명이 다르면 update 후보다. 제목 변경, 중복 후보, 시간 지정, 반복, 취소 이벤트는 review다. 남은 기존 이벤트와 누락된 근무도 review다.
- review가 한 건이라도 있으면 **전체 계획 blocked**다. 자동 삭제는 없다. 날짜 이동/근무 취소는 수동 확인해야 한다. 업로드한 월 밖의 과거 일정 이동은 이 조회로 판정할 수 없다.
- 신규 일정 후보 ID는 개인+날짜의 SHA-256 기반으로 안정적이며 코드 변경에도 변하지 않는다. 설명에는 의료진 정보만 넣고 내부 ID는 `extendedProperties.private` 후보에 둔다. dry-run은 private 메타데이터도 기록하지 않는다.
- 동일 파일 재업로드 테스트는 기존 이벤트가 있는 상태의 신규 0건을 검증한다. 빈 Calendar에서는 쓰기가 없으므로 재미리보기에도 같은 create 후보가 나오는 것이 정상이다.
- 실제 쓰기 구현 시 read-write scope의 별도 승인, 최신 Calendar 재조회, legacy 후보별 확인 및 private key 이관, ETag 조건부 수정, deterministic ID 생성 후 충돌/타임아웃 재조회, 동시 실행 잠금, 부분 실패 재개를 먼저 검증한다. 현재 코드는 이를 실행하지 않는다.
- 401/403/429/5xx, 페이지 오류, OAuth 실패 시 계획을 반환하지 않는다. 자동 재시도·운영 프로세스 재시작은 하지 않는다.

## 참고 공식 문서

- [Calendar events.list — 페이지네이션, 시간 범위, 읽기 권한](https://developers.google.com/workspace/calendar/api/v3/reference/events/list)
- [Calendar OAuth scopes](https://developers.google.com/workspace/calendar/api/auth)
- [SheetJS 설치 — 공식 배포본](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/)
