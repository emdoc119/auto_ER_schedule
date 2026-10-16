# AER Excel → Calendar

기존 `aer_dashboard.html`의 Excel/ICS 기능과 같은 파서로, Mac mini의 독립 백엔드에서 `AER duty` 미리보기와 승인형 동기화를 수행한다. **기본값은 쓰기 비활성**이며 미리보기 이후 적용 버튼/명령을 실행해야 반영한다.

- `lib/aer-parser.js`: 브라우저/Node 공통 파서, ICU 그룹과 동료·인계 규칙.
- `backend/pipeline.js`: 입력 수단에 독립적인 Excel 정규화와 미리보기.
- `lib/reconcile.js`: 종일 일정과 보수적인 기존 이벤트 대조. 설명에는 의료진만, 식별자는 private properties에 보관한다.
- `backend/sync-service.js`: 채널에 묶인 만료 계획, 재조회, ETag, 프로세스 간 잠금, 적용 후 검증. 삭제는 지원하지 않는다.
- `backend/telegram.js`: 허용된 개인 채팅의 Excel → 미리보기 → 명시적 적용 수신 어댑터. 운영 수신기는 기존 Hermes만 유지한다. 별도 polling CLI는 비활성화했으며 실제 수신 진입점의 최소 어댑터 설계는 docs/HERMES_INGRESS_DESIGN.md에서 확인한다.

[읽기 전용 audit 준비](docs/READONLY_AUDIT_SETUP.md) · [설치·웹 사용](docs/MAC_MINI.md) · [Telegram 및 복구](docs/SYNC_TELEGRAM.md)

`npm ci --ignore-scripts && npm test`는 합성 데이터만 사용한다. 개인 Excel, Calendar 응답, OAuth·Telegram 인증정보는 저장소/CI에 넣지 않는다. 실제 파일·인증·기존 봇 연결의 현장 검증과 운영 설치는 별도 확인이 필요하다.
