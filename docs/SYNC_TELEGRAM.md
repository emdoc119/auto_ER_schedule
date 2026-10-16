# Telegram 수신과 안전한 재개

## 연결 형태

`createTelegramHandler`는 파일 수신 인터페이스이며 웹과 동일한 sync service를 호출한다. 외부에 webhook 서버를 공개하지 않는다. 독립 polling 실행기(`npm run telegram`)는 별도 선택 사항이다.

**기존 Hermes 테스트봇에서 polling을 이미 수행한다면 이 실행기를 동시에 시작하지 않는다.** 기존 수신기가 메시지를 필터링한 뒤 원래 Telegram update와 같은 인증된 Telegram API 객체를 이 어댑터에 전달하도록 연결하거나, 테스트봇 수신 소유권을 명시적으로 이전해야 한다. 현재 PR은 Hermes upstream/gateway 또는 봇 설정을 수정하지 않았으며 그 연결을 완료했다고 주장하지 않는다.

```js
const {createTelegramHandler,createTelegramApi}=require('./backend/telegram');
const {service}=require('./backend/runtime').createRuntime();
const handler=createTelegramHandler({service,api:createTelegramApi({token:privateBotToken}),
  person:configuredName,residents:configuredResidents,calendarId:configuredCalendar,
  allowedChatId:approvedPrivateChat,allowedUserId:approvedSender});
// 기존 단일 수신기가 받은 원본 update를 이 handler에 전달한다.
await handler(authenticatedTelegramUpdate);
```

이 예제의 식별자/토큰은 비공개 설정이며 브라우저 또는 공개 저장소에 넣지 않는다. 원본 update를 임의 HTTP endpoint로 받는 구성은 제공하지 않는다. 기존 gateway에 연결하는 어댑터 작업은 실제 gateway 진입점과 소유권을 확인한 뒤 수행해야 한다.

## 독립 실행 설정

[Mac mini 설치](MAC_MINI.md)의 OAuth·Calendar·AER_STATE_DIR 설정을 공유한다. 아래는 **기존 리스너가 없거나 소유권 이전을 확인한 설치자만** 설정한다.

```sh
export AER_TELEGRAM_EXCLUSIVE_POLLING=1
export AER_TELEGRAM_EXPECTED_BOT_USERNAME='YOUR_APPROVED_TEST_BOT'
export AER_TELEGRAM_ALLOWED_CHAT_ID='APPROVED_PRIVATE_CHAT_ID'
export AER_TELEGRAM_ALLOWED_USER_ID='APPROVED_SENDER_ID'
export AER_TELEGRAM_STATE_DIR="$HOME/.config/aer-calendar/telegram"
export AER_TELEGRAM_BOT_TOKEN_FILE="$HOME/.config/aer-calendar/telegram-token.json"
export AER_PERSON='YOUR_ROSTER_NAME'
export AER_RESIDENTS='["SYNTHETIC_EXAMPLE_REPLACE_WITH_PRIVATE_CONFIG"]'
mkdir -p "$AER_TELEGRAM_STATE_DIR"
chmod 700 "$AER_TELEGRAM_STATE_DIR"
chmod 600 "$AER_TELEGRAM_BOT_TOKEN_FILE"
npm run telegram
```

토큰 파일은 `{ "token": "PRIVATE_BOT_TOKEN" }` 형식으로 저장소 밖에 만든다. 코드/Issue/PR/로그에 실토큰이나 의료진 명단을 붙이지 않는다. 환경변수 토큰도 지원하지만 둘을 동시에 지정하면 거부한다. 현재 승인된 테스트봇과 사용자 채팅만 사용하고 Old Jarvis 토큰을 재사용하지 않는다.

읽기 모드(`AER_ENABLE_WRITES=0`/미설정)에서도 수신·미리보기가 가능하다. 실제 적용은 별도 쓰기 토큰과 `AER_ENABLE_WRITES=1`이 필요하다. expected username의 `getMe` 확인과 빈 webhook 확인 후 시작한다. webhook을 지우거나 pending updates를 버리는 코드는 없다. 409 충돌은 즉시 중단한다. 배포 전 운영자는 다른 polling 프로세스가 없는지도 확인해야 한다. API만으로 polling 소유권을 완전히 증명할 수는 없다.

상시 운영은 독립 launchd 항목으로 등록한다. 웹과 수신기는 같은 `AER_STATE_DIR`를 사용해야 하나의 Calendar 쓰기 잠금을 공유한다. polling 전용 상태는 별도 `AER_TELEGRAM_STATE_DIR`를 사용한다.

## 사용자 흐름

1. 허용된 개인 채팅에서 본인이 `.xlsx` 파일(8 MiB 이하)을 **문서 첨부**로 보낸다. 다른 사용자/그룹/편집 메시지는 처리하지 않는다.
2. 봇은 같은 파서로 처리하고 기존 Calendar를 조회한 뒤 신규·변경·식별자 연결·동일·검토 건수만 회신한다. 동료 이름이나 원본 근무표는 회신하지 않는다.
3. 쓰기 활성화와 검토 0건이면 `/aer_apply PLANID`를 안내한다. 해당 명령이 그 계획의 실행 승인이다. 읽기 모드나 검토 항목이 있으면 적용 명령을 제공하지 않는다.
4. 적용은 같은 허용 chat+sender 조합에서만 가능하다. 계획은 15분 후 만료되며 일회용이다. 웹에서 발급한 계획을 Telegram에서 실행하거나 반대로 실행할 수 없다.
5. 실패/만료/Calendar 변경이면 파일을 다시 보내 새 미리보기를 확인한다. 동일 파일의 재업로드는 이미 반영된 일정의 재생성을 하지 않는다.

## 장애·개인정보·재개 경계

- 원본 Excel은 메모리에서만 처리한다. 비교 계획은 개인 상태 디렉터리(700)의 파일(600)에 저장하며 미리보기와 Calendar 재대조를 위해 의료진 정보가 포함될 수 있다. 공개 저장소에는 저장하지 않는다.
- 성공/실패 후 계획의 의료진 본문은 제거하고 상태/건수만 남긴다. 만료된 계획은 다음 미리보기에서 정리한다. 비정상 종료로 `applying` 상태가 남으면 운영자가 검토해야 한다.
- 하나의 `sync.lock`이 웹/Telegram 간 적용을 직렬화한다. 재조회/ETag 검증 없이 오래된 계획을 적용하지 않는다. 401/403/429/5xx는 안전 중단하며 무한 재시도하지 않는다.
- timeout/409 생성 결과는 고정 ID로 조회해 실제 반영 여부를 확인한다. ID가 충돌하거나 확인할 수 없으면 중단한다. 부분 반영은 자동 롤백하지 않으며 새 미리보기를 발급한다.
- polling cursor는 처리 **전에** 디스크에 기록한다. 중복 적용 재실행을 피하지만, crash가 나면 해당 update의 처리가 누락될 수 있다. 사용자에게 도착하지 않은 응답은 파일/명령을 다시 보내고 새 미리보기로 확인한다. 정확히 한 번 전달을 보장하지 않는다.
- stale `sync.lock`/`polling.lock`은 자동 제거하지 않는다. 해당 서비스만 중지하고 실제 프로세스가 종료됐는지 확인한 뒤 운영자가 복구한다. 다른 서비스나 전체 launchd를 재시작하지 않는다.

[Telegram Bot API — getUpdates/getFile](https://core.telegram.org/bots/api)와 [Calendar ETag 조건부 수정](https://developers.google.com/workspace/calendar/api/guides/version-resources)을 참고한다.
