# AER Excel → Calendar dry-run

기존 `aer_dashboard.html`의 Excel/ICS 기능에 공유 파서와 읽기 전용 Calendar 비교를 추가한다. **현재 버전은 Calendar 생성·수정·삭제를 실행하지 않는다.** Issue #3의 첫 단계이며 실제 동기화 승인은 후속 단계다.

- `lib/aer-parser.js`: 브라우저/Node 공통 Excel 행 파서와 동료·인계 규칙.
- `backend/pipeline.js`: 입력 수단에 독립적인 `previewExcel(Buffer, options)` 진입점. 향후 승인된 Telegram 수신기가 같은 함수를 호출할 수 있다. 봇 연결은 아직 없다.
- `lib/reconcile.js`: 종일 이벤트 후보와 create/update/noop/review 비교. 내부 키는 설명 대신 private extended properties 후보에만 포함한다.
- `backend/`: Mac mini의 독립 읽기 전용 OAuth 및 루프백 업로드 화면.

설치와 사용: [Mac mini 운영 안내](docs/MAC_MINI.md). `npm ci --ignore-scripts && npm test`로 합성 테스트만 실행한다. 실명 근무표, Calendar 응답, OAuth 파일을 저장소나 CI에 넣지 않는다.

기존 정적 화면 배포는 이 PR 병합 후 별도 확인한다. ICS/빠른등록은 수동 기능이며 중복 방지 보장이 없다.
