# PR #4 GitHub Pages 영향 독립 검토

**판정: 실질적인 공개 화면 변경이 있는 조건부 병합 승인 요청 준비 완료.** 로컬 검증에서 Pages 배포를 막을 결함은 발견하지 않았으나, 아래 입력 호환성·설명 변경·localhost 제약을 수용하고 **동일 최종 SHA의 CI 성공을 확인한 뒤** 병합해야 한다. 최초 독립 검토 후 메인 세션이 공개 URL과 CDN을 확인했고, CDN 403에 대응해 고정 버전 로컬 자산으로 보완했다. 로컬 후보 실제 브라우저에서 합성 파일 2건과 D(I)/N(I) 표시·JavaScript 오류 없음까지 확인했다. 공개 배포 후 회귀는 별도 확인한다.

## 대상과 배포 전제

- 검토 HEAD: `ce2e5ea2a7b4320b11878c0fb56c88a8d22aa922` (`/private/tmp/aer-pr4-review`, 검토 시작 시 clean).
- 비교 main: `c0998958b0e62c4f20903a1c677e8b0bcedf46db`. 정확한 두 커밋의 전체 diff와 관련 소스를 로컬에서 확인했다.
- 메인 세션의 GitHub API 직접 확인: GitHub Pages는 public legacy build, source `main /`, `https_enforced=true`, 마지막 빌드 커밋은 위 main이다. 공개 주소는 [AER Pages](https://emdoc119.github.io/auto_ER_schedule/). 현재 root/dashboard HTTP200과 main 소스의 byte 일치도 확인했다. 기존 사이트는 변경하지 않았다.
- 이 설정이 유지되면 PR4를 main에 병합하는 것은 **후속 Pages 자동 빌드·공개 배포를 유발하는 변경**이다. 실제 배포 성공까지 보장하는 판정은 아니다. 추가된 CI는 테스트 워크플로이며 별도 백엔드 배포 기능은 없다.

## 보존되는 경로와 달라지는 동작

| 항목 | 확인 결과와 공개 영향 |
| --- | --- |
| URL·레이아웃 | `index.html`은 byte 동일하며 기존 `./aer_dashboard.html` 이동을 유지한다. 기존 CSS·달력·월별/전체 ICS·빠른등록 UI가 남고, 결과 영역에 dry-run 버튼과 안내가 추가된다. 새 상대 경로 `lib/aer-parser.js`는 추적 파일로 존재하여 프로젝트 URL 아래 `/auto_ER_schedule/lib/aer-parser.js`로 해석된다. 새 parser/vendor 자산은 아직 병합 전이므로 공개 배포 응답은 미확인이다. 로컬 후보의 dashboard/vendor/parser 모두 HTTP200과 합성 파일 입력 성공을 확인했다. |
| Excel 스키마 | `lib/aer-parser.js:34–75`: A열 날짜, H열 이후 의료진, 첫 30행의 본인 이름 헤더를 요구한다. 연도 없는 시트의 현재 연도 추정을 없애고 `YYYY년`(2000–2100)을 요구한다. 중복 헤더·이름·날짜, 잘못된 날짜와 미지원 코드는 오류가 된다. 종전 파일 일부가 이제 거절될 수 있다. |
| 근무코드 | 동료의 알 수 없는 코드도 전체 Excel 변환을 중단한다. `MD/E1/ICU/EICU/외래/E1`은 허용된 동료 코드이며 ICU 등 보조 코드는 D/N 인계에 섞이지 않는다. 본인은 D/E/N/HEMS/HEMS/N 및 지원 `(I)` 변형만 일정화하며 MD/E1/ICU 등은 거절한다. 본인 미지원 코드 거절 자체는 기존에도 있었다. |
| 누적·오류 | 같은 날짜 수의 재업로드도 갱신 가능하며, 파싱·일정 검증 후 누적 데이터를 교체한다. 실패한 새 Excel은 기존 성공 데이터와 마지막 성공 Excel을 지우지 않는다. 오류 후 남은 달력·dry-run 대상이 새 파일 결과라고 오인하지 않도록 주의해야 한다. |
| ICS·빠른등록·설명 | 생성 함수는 그대로이며 날짜·제목·종일 종료일·안정 UID는 보존된다. 그러나 공유 `buildEvents`는 `없음`, `자료없음…`, 별도 `ICU: 겸무` 설명 행을 생략한다(`lib/aer-parser.js:132`). 상세 화면·ICS DESCRIPTION·빠른등록 details가 바뀐다. `(I)` 제목과 기본 그룹 인계 계산은 유지된다. 수동 가져오기/링크의 중복 방지는 보장하지 않는다. |
| 이미지 흐름 | 이미지→Gemini 요청→JSON 확인·수정→달력/ICS 흐름과 추출·변환 함수는 동일하다. 이후 공유 일정 생성에서 위 설명 생략이 적용된다. 이미지 확인 시 Excel 전달 상태를 비워 dry-run은 다시 Excel 업로드를 요구한다. 기존 Gemini 키 localStorage 저장·외부 이미지 전송은 남아 있으며 새로 생긴 동작은 아니다. |

## 공개 백엔드 소스와 localhost 버튼

- `backend/*.js`가 저장소·정적 경로에서 보일 수 있어도 Pages는 Node의 `require`, 파일 읽기, OAuth, `listen`을 실행하지 않는다. 병합만으로 백엔드·launchd·OAuth·Calendar 조회가 시작되지 않는다. `backend/preview.html`을 Pages에서 직접 열어도 독립 백엔드가 되지 않는다.
- HEAD 추적 파일 목록과 비밀키 패턴 검사에서 실제 `.env`, OAuth 자격증명/토큰, 개인 XLSX/ICS, 저장된 preview JSON을 발견하지 않았다. `.gitignore`도 이를 제외한다. 이는 검토 HEAD 범위의 확인이며 모든 과거 이력에 대한 비밀정보 부재 보증은 아니다.
- 버튼(`aer_dashboard.html:523–538`)은 **사용자 브라우저의** `http://127.0.0.1:8787/`을 새 창으로 연다. 독립 백엔드와 필요 시 Mac mini SSH 포워딩이 미리 있어야 한다. 마지막 성공 Excel 한 파일·현재 이름/전공의만 `postMessage`로 전달하며, 누적 달력 전체를 전달하지 않는다. 파일을 URL·공개 서버에 싣는 새 요청은 없다.
- 준비 메시지의 정확한 loopback origin과 popup source를 확인하고, 수신 측은 Pages origin과 opener를 확인한다. 다만 Pages origin 검증은 저장소 경로 단위 격리는 아니다. 로컬 비교는 전달 후 사용자가 별도 버튼을 눌러야 실행된다. 후보 백엔드는 Calendar GET/읽기 전용 scope만 구현하며 apply/sync/delete 경로가 없다.
- **백엔드 미기동 시** 새 창에 연결 오류가 나고 자동 대체 서버나 대시보드 오류 안내는 없다. 60초 후 수신 대기를 해제할 뿐 timeout 메시지도 없다. 팝업 차단은 대시보드에서 안내한다. 기존 달력·ICS·빠른등록은 계속 사용할 수 있다. 전송만 실패하고 로컬 화면이 열리면 파일·이름을 직접 입력할 수 있지만, 백엔드 자체가 없으면 이 우회도 불가능하다.

## 검증 근거와 남은 위험

- `NODE_PATH=/private/tmp/aer-calendar-issue3/node_modules node --test tests/aer_duty_rules.test.js tests/web.test.js tests/pipeline.test.js`: **초기 독립 focused 28/28 통과**. 합성 XLSX·가짜 Calendar 응답만 사용했다. 서버를 여는 `tests/server.test.js`와 전체 `npm test`는 실행하지 않았다.
- 별도 인메모리 baseline/candidate 비교: 합성 5개 근무의 날짜·제목·스타일·ICS UID·종일 시작/종료가 동일했다. 연도 누락·알 수 없는 동료 코드는 baseline 허용/candidate 거절, ICU 동료는 candidate 허용을 확인했다. 설명 생략에 따른 출력 차이도 확인했다. 이미지 함수·ICS/빠른등록 함수·index 동일성 및 상대 parser 파일 존재를 검증했다. 사용한 SheetJS는 `0.20.3`이다.
- 정확한 main→HEAD `git diff --check` 통과. 네트워크·브라우저·서비스 시작·의존성 설치·개인 근무표 열람 없이 검토했다. 실제 GitHub CI 결과는 확인하지 않았다.
- SheetJS는 기존 외부 cdnjs 0.18.5 대신 로컬 `vendor/xlsx-0.20.3.full.min.js` 0.20.3을 사용한다. 새 외부 CDN 직접 조회가 HTTP403을 반환해 해당 의존을 제거했다. 고정 npm 배포본과 동일 파일, 보존된 Apache-2.0 라이선스와 SHA-256을 포함한다. VM에서 브라우저 배포본으로 합성 XLSX 생성·재읽기·공유 파서 연동까지 검증했다. 보완 후 PR4 전체 30/30 통과. 기존 Google Fonts/Gemini 외부 의존은 남는다.
- 브라우저의 ICS 다운로드 버튼은 실행했지만 자동화 download 이벤트를 포착하지 못해 실제 다운로드 산출물은 검증하지 못했다. ICS 생성 내용·UID·종일 날짜는 합성 회귀에서 검증했다.
- 새 parser 로드 실패 시 최상위 `AER` 참조가 실패하여 이미지 등 후속 이벤트 연결도 막힐 수 있다. Pages 배포 지연·HTML/JS 캐시 혼합, 팝업/opener·브라우저 로컬 접근 정책, Gemini 외부 API는 실제 공개 배포 환경에서 미검증이다. 로컬 vendor 코드도 페이지 권한으로 실행되므로 버전 업데이트 시 원본 무결성과 회귀 검증이 필요하다.

## 요청할 승인

> 위 공개 동작 변경과 미검증 위험을 수용하고, CI가 동일 HEAD에서 성공한 것을 확인한 뒤 **PR #4의 최종 SHA `ce2e5ea2a7b4320b11878c0fb56c88a8d22aa922`만 main에 병합하여 기존 Pages 설정에 따른 자동 공개 배포가 진행되는 것을 승인하시겠습니까?**

SHA가 바뀌면 변경분 재검토가 필요하다. 이 승인에는 **PR #5, Calendar 생성·수정·삭제, 실제 근무표 처리, OAuth 발급, 백엔드 설치·기동·재시작, launchd/Telegram 등 runtime 변경**이 포함되지 않는다. 이 문서는 승인 요청안이며 승인·병합·배포를 실행한 기록이 아니다.

초기 독립 검토는 상속 모델 조사 에이전트, CDN/로컬 자산 보완과 최종 통합 검증은 메인 세션이 수행했다.
