# Hermes 단일 수신기 → AER 최소 어댑터 설계

2026-10-16 읽기 전용 조사. 소스와 설치 경로는 확인했으며 현재 프로세스의 import 경로·설정·실제 연결은 미검증이다. 이번 작업은 Hermes 코드·설정·서비스를 변경하지 않는다.

## 확인한 설치와 진입점

아래 표의 경로는 다음 루트를 기준으로 한다.

- `P`: `/Users/choo/Documents/Codex/2026-10-15/referenced-chatgpt-conversation-this-is-an-2/work/hermes-poc`
- `E`: `P/data/installs/2ddb460ef3c1c52d/environments/212936c78c12437381d3bcb44406952a`
- `W`: `E/workspace` — 설치된 editable import mapping이 가리키는 staged workspace.
- `V`: `E/venv/lib/python3.14/site-packages`

원본 `P/source`의 origin은 `NousResearch/hermes-agent`, SHA는 `73b9f2af7b87a619f42396710c332be04353aef2`다. 아래 관련 ingress/hook 파일은 W와 source가 바이트 단위로 같음을 확인했다. staged pyproject의 설치 옵션 차이가 있어 전체 배포 동일성까지 주장하지 않는다. Python 배포 버전 0.0.0은 placeholder, Telegram plugin은 1.0.0, 설치된 python-telegram-bot(PTB)은 22.8이다. editable 근거는 `V/hermes_agent-0.0.0.dist-info/direct_url.json:1` 및 `V/__editable___hermes_agent_0_0_0_finder.py:9`다.

| 파일:행 | 확인한 근거 |
|---|---|
| `W/plugins/platforms/telegram/adapter.py:7311` | `register(ctx)`가 실제 Telegram platform adapter를 등록한다. 옛 gateway/platforms/telegram.py 경로는 없다. |
| `W/plugins/platforms/telegram/adapter.py:3154` | `connect`; 3198에서 plugin을 연결하고 3199에서 core handler를 등록한다. 1764의 `_start_polling_once`가 기존 수신 polling 진입점이며 webhook도 지원한다. 현재 설정은 읽지 않았다. |
| `W/plugins/platforms/telegram/adapter.py:2884` | `_register_handlers`의 core text/command/media는 group 0, observer는 group 99. 실제 callback은 6466 `_handle_text_message`, 6480 `_handle_command`, 6779 `_handle_media_message`. |
| `W/hermes_cli/plugins.py:827` 및 `:844` | `register_platform_handler(factory(native,adapter))`와 `register_telegram_handler` 별칭이 존재한다. 기존 Application에 추가할 수 있다. |
| `W/gateway/platforms/base.py:2266` | plugin factory 실패를 2292–2296에서 기록하고 연결을 계속한다. 등록 실패만으로 전체 수신기가 멈추지는 않는다. |
| `W/plugins/platforms/telegram/update_admission.py:278` | `TelegramApplication.process_update`가 원래 PTB Update를 처리한다. bot_id:update_id receipt 중복 검사가 있지만 TTL/cap·비동기 저장이므로 영구 exactly-once 보장은 아니다. |
| `W/gateway/platforms/base.py:2371` | `_is_sender_authorized`는 gateway 인증 callback의 literal True/False만 인정하고 미설정·예외는 None이다. adapter.py:942의 DM 사전 필터는 pairing 대상을 통과시킬 수 있어 최종 인증으로 쓰면 안 된다. |
| `W/plugins/platforms/telegram/adapter.py:7101` | MessageEvent.raw_message는 전체 Update가 아닌 Message다. 원래 Update는 native callback에서 받아야 한다. |
| `W/gateway/run_inbound_consumer.py:34` | post_gateway_admission은 전체 Update가 없고 hook 예외 때 agent로 계속한다. run_inbound_hooks.py:63의 pre_gateway_dispatch도 auth 전·예외 무시여서 안전한 소비 경계로 부적합하다. |
| `V/telegram/ext/_application.py:1298` | block=True callback을 await하고 group당 첫 일치를 실행하며 ApplicationHandlerStop은 후속 group도 중단한다. |
| `W/hermes_cli/plugins_discovery.py:189` | profile plugins 디렉터리와 enabled opt-in을 지원한다. plugin_isolation.py:37의 native SDK factory는 in-process 전용이다. 실제 profile isolation 설정은 미확인이다. |

## 제안 흐름 — 미구현

1. 기존 Hermes receiver 하나만 유지한다. AER의 별도 polling CLI와 npm 실행 항목은 비활성화했다. webhook/offset을 변경하지 않는다.
2. 승인 후 profile 전용 `aer-ingress` Python plugin이 `register_telegram_handler`로 기존 native Application의 group 0/core 앞에 block=True handler를 등록한다. 새로운 Bot receiver/Updater는 만들지 않는다.
3. 제안하는 선택 규칙은 허용된 개인 chat+sender의 `.xlsx` 문서와 caption `/aer_preview`, 그리고 `/aer_apply PLANID`다. 일반 파일·대화를 가로채지 않는다. caption은 새 정책 제안이며 기존 기능이라고 주장하지 않는다.
4. 원래 Update에서 ID를 읽고 `_is_sender_authorized(...) is True`와 AER allowlist를 모두 요구한다. False/None/예외는 다운로드·Calendar 작업 전에 거부한다. 이 내부 API 의존은 위 SHA에 묶어 검증한다.
5. 선택·인증된 AER 요청을 `await dispatch(original_update)`하고 성공·검증 오류·IPC 실패 모두 ApplicationHandlerStop으로 소비한다. 일반 Hermes/LLM으로 오류 fallback하지 않는다. 미등록 plugin의 별도 방어는 아래 승인 범위 B가 필요하다.

## Python → Node 경계

Python plugin은 원래 PTB Update를 보관한 채 `update.to_json()`의 전체 JSON을 고정 Node child에 stdin/stdout RPC로 전달한다. update_id, message_id, chat, from, document, caption을 유지하며 MessageEvent로 Update를 재구성하지 않는다. SDK 재직렬화이므로 원래 HTTP JSON 바이트와 동일하다는 보장은 없다.

Node는 기존 `createTelegramHandler`와 `createRuntime`을 사용한다. sendMessage와 getFile/download는 양방향 RPC로 같은 `context.bot`에 위임해 토큰 복제와 별도 수신기를 피한다. bridge는 고정 chat/file_id만 허용하고 8 MiB/실제 길이·시간 제한을 적용한다. Python이 child 완료를 기다리는 동안 API 하위 요청도 처리해 교착을 막는다. shell 명령 문자열/HTTP 공개 수신기를 만들지 않는다.

RPC schema·버전·request ID와 private durable ledger `(bot ID, profile, update_id)`를 두고 부작용 전에 원자 claim한다. 중복·미확정 작업은 자동 재실행하지 않고 새 preview를 요구한다. Hermes receipt와 AER의 메모리 seen Set만으로 crash 재처리를 막을 수는 없다. ACK는 Calendar 성공을 뜻하지 않으며 결과 회신·원격 재조회까지 확인해야 한다. 원본 파일·Update·토큰은 argv/env/일반 로그에 넣지 않는다.

## 필요한 승인 범위와 남은 위험

**A. 확장 추가:** `P/data/profiles/model-test/plugins/aer-ingress/`에 manifest·Python bridge 추가, AER에 `backend/hermes-bridge.js`와 durable ledger 추가, profile config의 enabled plugin 및 비공개 allowlist/OAuth/state 경로 설정. 실제 설정을 읽지 않았으므로 비밀정보를 제외한 설정 diff부터 검토해야 한다. isolation 변경이 필요하면 별도 범위로 보고한다.

**B. 등록 실패 시 차단:** 기존 hook은 plugin 등록 실패를 무시한다. 이 상태에서는 AER 파일이 core/LLM에 넘어갈 수 있어 운영 준비 완료로 판정하지 않는다. 제안하는 최소 upstream 변경은 source와 staged workspace의 `plugins/platforms/telegram/adapter.py:_register_handlers`에서, 새 opt-in `extra.aer_required`가 참일 때 core 앞의 필수 AER handler 존재를 검증하고 없으면 연결을 거부하는 guard다. 이 guard는 **Telegram 전체 연결을 막을 수 있으므로** 정확한 diff·합성 장애 테스트·설정 영향에 대한 사전 승인이 필요하다. 숨은 monkey patch는 사용하지 않는다.

**C. 반영:** A/B 검토 후 기존 gateway의 설정 반영/reload/restart와 child 실행은 추가 승인 후 진행한다. 현재는 수행하지 않는다. cold boot의 pending-update 처리 설정도 사전에 확인해야 한다.

Rollback은 승인된 A/B diff와 설정만 복원하고 전용 child만 종료한다. 동일한 서비스 변경 승인이 필요하며 기존 수신기 하나를 유지한다. 미확정 ledger/plan은 보존하고 Calendar 역쓰기·webhook 삭제·offset 조작은 하지 않는다. 필수 guard를 해제하면 AER 입력도 중단해야 한다.
