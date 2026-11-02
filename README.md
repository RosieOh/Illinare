# 일리네어 (Illionaire)

내 컴퓨터에서 일하는 AI 팀. 목표를 말하면 전문 에이전트들이 일을 나눠 처리하고, 되돌리기 어려운 일은 실행 전에 먼저 묻습니다.

- **멀티에이전트:** 지휘자가 목표를 단계로 나누고, 권한이 분리된 전문가 6명에게 병렬로 맡긴 뒤 결과를 합칩니다.
- **보이는 진행:** 추론 요약, 도구 호출, 토큰, 비용이 실제 데이터 그대로 화면에 나타납니다.
- **승인과 되돌리기:** 시스템을 바꾸는 행동은 승인 후에만 실행되고, 파일 변경은 되돌릴 수 있으며, 모든 실행이 활동 기록에 남습니다.
- **로컬 우선:** 서버는 루프백에만 열리고 데이터는 이 기기에 저장됩니다. 사용자의 Anthropic API 키로 동작합니다.
- **한국어 문서:** 한글(HWPX), Word, PowerPoint, Excel 본문을 읽고 PDF와 이미지를 직접 분석합니다.
- **Windows, macOS, Linux.** 플랫폼별 코드 경로가 따로 있습니다. Windows 외 플랫폼의 검증 상태는 [상용화 분석](docs/COMMERCIAL_READINESS.md)을 보세요.

API 키가 없으면 데모 모드로 실행됩니다. 데모는 미리 만든 시나리오를 재생할 뿐 AI를 호출하거나 컴퓨터를 건드리지 않습니다.

## 시작하기

Node.js 22 이상이 필요합니다.

```bash
npm install
npm run dev
```

http://127.0.0.1:3000 을 열고 온보딩을 따라가세요. 키는 온보딩이나 설정에서 넣거나, `ANTHROPIC_API_KEY` 환경 변수로 줄 수 있습니다.

## 데스크톱 앱

```bash
npm run desktop:dev     # 개발 모드
npm run desktop:pack    # 설치 없이 실행 가능한 앱 (build/desktop/)
npm run desktop:build   # 설치 파일
```

`next dev`가 켜져 있으면 끄고 빌드하세요. 코드 서명과 공증은 꺼져 있습니다. 아이콘은 임시입니다. 배포 전에 인증서와 최종 아이콘이 필요합니다.

## 에이전트

| 에이전트 | 하는 일 | 도구 |
| --- | --- | --- |
| 지휘자 | 계획과 종합 | 없음 |
| 리서처 | 웹 조사 | 웹 검색, 웹 읽기, 날씨. 로컬 파일 접근 없음 |
| 아키비스트 | 파일 찾기, 읽기, 정리 | 파일 도구. 네트워크 접근 없음 |
| 오퍼레이터 | 앱과 시스템 제어 | 볼륨, 다크 모드, 앱 실행, 클립보드, 스크린샷 등 |
| 플래너 | 할 일과 일정 | 플래너 도구, 기억 |
| 라이터 | 문서와 발표 자료 | 메모 저장, 발표 자료 만들기 |
| 애널리스트 | 계산과 분석 | Anthropic 샌드박스의 코드 실행 |

모델 구성(최고 품질, 균형, 절약)과 미션당 비용 상한은 설정에서 바꿉니다.

## 구조

```
app/                Next.js 앱과 REST, SSE 라우트
components/glass/   Liquid Glass 디자인 시스템
components/shell/   아일랜드, 레일, 컴포저, 팔레트, 온보딩
components/views/   7개 화면
components/mission/ 미션 스테이지와 승인 UI
lib/contracts.ts    서버와 클라이언트의 공유 타입
lib/agents/         멀티에이전트 런타임
lib/tools/          도구 레지스트리, 승인 정책, 경로 보호
lib/platform/       OS별 구현
lib/store/          로컬 JSON 저장소, 감사 기록, 되돌리기
electron/           데스크톱 셸
```

## 개발

```bash
npm test            # vitest
npm run typecheck
npm run lint
```

실제 Claude API로 미션을 끝까지 돌려 보려면 빌드한 뒤 `live-check`를 씁니다. 실제 비용이 나가므로 `--yes`가 없으면 시작하지 않습니다. 앱 데이터는 임시 폴더를 쓰고, 쓰기 점검은 문서 폴더에 파일 하나를 만들었다가 되돌리기로 지웁니다.

```bash
npm run build
ANTHROPIC_API_KEY=... npm run live-check -- --yes   # 답변, 웹, 코드 실행, 첨부, 쓰기 승인, 오염 승인, 비용
npm run live-check -- --demo                        # 키 없이 스크립트만 점검
```

이 저장소의 Next.js는 학습 데이터와 다를 수 있습니다. 코드를 쓰기 전에 `node_modules/next/dist/docs/`를 확인하세요. 디자인 시스템은 [DESIGN.md](DESIGN.md), 시각 방향은 [.impeccable/surfaces/app-page-tsx.md](.impeccable/surfaces/app-page-tsx.md), 제품 원칙은 [PRODUCT.md](PRODUCT.md), 보안 모델은 [SECURITY.md](SECURITY.md)에 있습니다.

## 이름 바꾸기

표시 이름은 `lib/contracts.ts`의 `BRAND`에 있습니다. 데스크톱 빌드는 `electron-builder.yml`과 `electron/main.mjs`의 `APP_TITLE`도 함께 바꿔야 합니다.
