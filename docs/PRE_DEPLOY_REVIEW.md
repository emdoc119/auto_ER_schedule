# PR #5 운영 전 독립 검증 후속

## 웹 승인 세션

서버 전역 CSRF/채널을 제거하고 브라우저 쿠키별 메모리 세션을 사용한다. 쿠키는 무작위 HttpOnly/SameSite=Strict이며 CSRF 토큰과 승인 채널은 서로 별개다. 만료는 30분, 계획은 15분이다. 동일 브라우저의 새 탭은 세션을 공유하지만 다른 쿠키 저장소는 공유하지 않는다.

서버 재시작은 모든 웹 세션을 폐기한다. private plan 파일이 남아 있어도 새 서버 epoch의 세션으로 기존 계획을 적용할 수 없으며 새 preview가 필요하다. cross-session cookie/token 조합, 다른 세션의 올바른 CSRF로 PLAN ID 탈취, 재시작·만료·중복 쿠키·고정 세션 시도를 HTTP와 실제 private plan store를 사용하는 합성 테스트로 검증했다.

## 기존 22건의 읽기 전용 비교

사용자 제공 원본과 fresh Calendar 검색/22건 상세 조회를 대조했다. 실제 이벤트 22건, 날짜 중복 0건, 원본과 날짜·제목·설명 내용 일치 22건(공백/줄바꿈 정규화), 실제 쓰기 0건이다. 개인 원본·명단·이벤트 ID/응답은 공개 저장소에 보관하지 않는다.

**미관리 일정이라는 전제의 예상 계획:** create 0 / update 0 / adopt 22 / noop 0 / review 0. 현재 22개 Google event ID를 각각 그대로 patch 대상으로 연결하며, 재생성 ID로 바꾸지 않는 경로를 합성 22건 테스트로 검증했다. adopt는 내용 변경과 다르며 비공개 식별자 연결 쓰기다. 이번에는 실행하지 않았다.

**확정 제한:** 연결된 Calendar 도구는 상세 조회에서도 extendedProperties.private와 ETag를 노출하지 않는다. 따라서 이미 관리된 이벤트가 있는지 확인할 수 없어 실제 adopt/noop 분리는 아직 확정하지 못했다. 누락된 metadata를 '없음'으로 확정하지 않는다. raw API 권한 확인 전에는 이 예상치를 운영 실행의 근거로 쓰지 않는다.

최소 owned.readonly audit 전용 OAuth와 실제 grant 검사, 명시적인 ID/ETag/private projection을 추가했다. 준비는 [읽기 audit 절차](READONLY_AUDIT_SETUP.md)를 따른다. 기존 커넥터 결과를 확정 raw 응답으로 사용하지 않는다. 직접 OAuth 준비 후 실행할 수 있는 집계 전용 명령을 추가했다. 쓰기 adapter나 plan 저장 없이 기본 Calendar events.list를 조회하고 같은 planFor를 사용한다.

```sh
# 파일/본인/전공의/Calendar/OAuth 경로는 비공개 환경 설정에서 공급한다.
AER_ENABLE_WRITES=0 npm run audit -- '/PRIVATE/PATH/workbook.xlsx'
```

AER_RESIDENTS는 명시적인 JSON 배열이어야 한다. 출력은 create/update/adopt/noop/review, ID 보존 건수, ETag 준비 여부와 writes:0뿐이다. 직접 API 조회로 실제 private 속성 부재/존재를 확인한 뒤 확정 건수를 기록한다. token 발급 자체는 Google 동의가 필요하다. 이 명령은 아직 실환경 OAuth로 실행하지 않았다.

## PR 병합 순서

1. PR #4(main 대상)를 먼저 검토했다. 실제 양식의 동료 전용 코드를 거부하는 호환 문제를 최소 수정했고 29/29 합성 테스트 및 실제 파일 22건 추출을 확인했다. main 병합은 하지 않았다.
2. PR #5에 수정된 PR #4를 일반 병합으로 가져와 선행 코드와 정합성을 유지한다. rebase/force push는 사용하지 않는다.
3. 현재 origin/main은 PR #5의 조상이며 현재 main 대비 diff/전체 검증을 수행한다. 이것은 미래 main의 검증을 대체하지 않는다.
4. 사용자가 PR #4 병합을 별도 승인한 뒤에만 병합한다. 실제 병합 SHA를 fetch하고 PR #5를 main 대상으로 변경한 후 전체 테스트/CI를 다시 실행한다. 지금은 PR #5의 stacked base를 유지한다.

## 최초 실환경 시험 순서

1. 소유자 동의로 읽기 OAuth만 준비하고 위 audit로 raw 속성/ETag와 ID 22개 보존을 재확인한다. 쓰기 flag는 계속 0이다.
2. [Hermes 설계](HERMES_INGRESS_DESIGN.md)의 실제 native 진입점과 plugin·등록 실패 guard 변경을 검토하고 별도 승인한다. 별도 polling은 시작하지 않는다.
3. 승인된 코드/설정과 gateway 반영 범위만 적용해 단일 수신기에서 합성 문서, 비인가 chat/sender, 일반 문서 무영향, 중복·crash·bridge 실패 시 LLM fallback 없음부터 검증한다. 재시작은 별도 승인 후 진행한다.
4. 허용된 사용자가 실제 파일을 caption `/aer_preview`와 함께 보내게 하고 수신→동일 파서→읽기 전용 계획 회신까지 검증한다. 이 caption은 승인받아 구현할 bridge 정책이다.
5. 별도 Calendar 쓰기 승인이 있을 때만 write OAuth/flag를 활성화하고 새 계획으로 adopt를 실행한다. ID/내용/중복/설명 내부정보 비노출을 재조회한 뒤 같은 파일 재수신에서 create/update/adopt 0, noop 22를 확인한다.

현재 차단 항목: raw Calendar metadata/ETag 확인, Python↔Node bridge·durable ledger 미구현, 필수 plugin 등록 실패 시 차단 guard 미승인, gateway runtime 설정·현장 E2E 미검증. Calendar 쓰기·main 병합·별도 polling·서비스 재시작은 수행하지 않는다.
