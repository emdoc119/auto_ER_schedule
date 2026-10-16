# Current objective

Issue #3 후속: 검증된 미리보기의 Calendar 적용과 독립 Telegram Excel 수신.

- Scope: 채널에 묶인 계획, 기본 쓰기 비활성, 별도 쓰기 OAuth, 재조회/ETag/고정 ID/잠금/적용 후 검증, Telegram 개인 chat+sender allowlist와 명시적 적용.
- Files: backend/sync-service.js, calendar-writer.js, state.js, runtime.js, server.js, telegram*.js, tests/*, docs/MAC_MINI.md, docs/SYNC_TELEGRAM.md.
- Constraints: Old Jarvis/Gemini Spark/기존 스케줄러/금융 불변; 개인 원본과 인증정보 공개 금지; 기존 Hermes polling과 경쟁 금지; 자동 삭제/자동 webhook 해제 없음.
- Done criteria: 합성 검증과 CI 통과, 후속 PR, 설치/복구 안내. 실제 파일/쓰기 인증/기존 봇 소유권이 확인되면 현장 E2E 수행.
- Actual-file validation: 사용자 제공 원본 22건과 Calendar 22건의 날짜/제목/의료진 설명이 모두 일치. 신규/내용 변경 0건, 실제 쓰기 없음. 기존 웹의 전공의 설정 사용.
- Pending: 독립 운영 OAuth/봇 설정과 수신 소유권 확인 및 자동화 런타임 현장 E2E.
