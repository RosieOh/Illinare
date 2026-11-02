---
version: 1
slug: "app-page-tsx"
primary_target: "app/page.tsx"
related_targets: []
---

Scope: 앱 전체 (단일 페이지 셸 + 7개 뷰). Mode: Operate.
Audience/job: 데스크톱 지식 노동자가 AI 팀에게 일을 맡기고, 진행을 지켜보고, 승인하고, 결과를 받는다.
Pinned by user: Apple Liquid Glass. 멀티에이전트 기반. 질문하지 말고 끝까지 진행.

## Direction contract

THESIS: 에이전트는 유리 구체이고 일은 그 안을 흐르는 액체다. 지휘자에서 액체가 갈라져 나가면 위임이고, 결과 구체로 합쳐지면 종합이다. Liquid Glass의 변형(분리, 병합, 굴절)이 장식이 아니라 실제 오케스트레이션 상태를 1:1로 나타낸다. "왼쪽 대화 목록 + 가운데 채팅 칼럼"이라는 AI 앱 기본 배치를 거부한다.

OWN-WORLD: 전면 생성형 배경(시간대에 따라 변하는 메시 그라디언트) 위에 두 층. 기능 계층(아일랜드, 레일, 컴포저, 시트, 팔레트)은 굴절과 스펙큘러가 있는 Liquid Glass. 콘텐츠 계층은 글이 읽히는 불투명에 가까운 프로스트 머티리얼. 유리 위에 유리를 쌓지 않는다. Apple 시스템 컬러를 바탕으로 액체로 렌더링했을 때 구분되도록 조정한 에이전트 고유 색(지휘자 파랑, 리서처 민트, 아키비스트 인디고, 오퍼레이터 주황, 플래너 분홍, 라이터 보라, 애널리스트 깊은 청록). 주황 계열 강조는 승인과 실제 주의 상태에만 쓴다. 미팅, 맑은 날씨, 데모 표시에는 쓰지 않는다. 동심 코너. Pretendard Variable, 숫자는 tabular. 스프링 모션. 코스튬 금지(레이더, 홀로그램, 모노 터미널 로그).

STORY: 쉬는 동안 구체는 빈 유리이고 일하는 에이전트만 액체를 담는다. 처음 온 사람은 첫 화면에서 "일을 맡기는 앱"임을 안다. 맡기면 방울이 갈라지며 팀이 일하는 모습이 실제 데이터로 보인다. 위험한 행동은 아일랜드가 커지며 먼저 묻는다. 끝나면 방울이 합쳐져 결과가 된다. 어떤 화면에 있든 컴포저로 일을 맡기고 아일랜드로 진행을 본다.

FIRST VIEWPORT: 상단 중앙에 떠 있는 아일랜드(작은 필). 왼쪽에 떠 있는 유리 레일(오늘, 미션, 플래너, 발표, 시스템, 활동, 설정). 하단 중앙에 넓은 유리 컴포저 "무엇을 맡길까요?"가 주 행동. 그 사이 콘텐츠: 큰 인사말과 오늘의 실제 데이터(다음 일정, 할 일, 날씨, 시스템 상태)를 위계 있는 비대칭 벤토로. 같은 크기 카드 나열 금지.

FORM: 사용자가 지정한 Apple Liquid Glass (Operate 모드: 표준 탐색과 컨트롤을 유지하고 유리는 타입, 색, 밀도, 시그니처 무브로만 기여). 시그니처 무브는 유리 구체 사이를 흐르는 액체의 분리/병합(스테이지가 곧 미션 화면이다)과 아일랜드 변형. 코드 주도 빌드. 사용자가 세계를 지정해 굴림 결과가 아닌 지정을 따른다. seed:40a36bc7d557b10e

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Liquid Glass 구현 규칙
- 재질 토큰 2종. `.material`(콘텐츠 표면: 불투명도 80~92%, 색 번짐 없음, 본문 대비 4.5:1 보장. 배경이 계속 움직이므로 비용을 고려해 블러는 24px로 둔다), `<LiquidGlass>`(기능 계층: 얇은 틴트 + backdrop blur + saturate + SVG 변위 굴절 + 가장자리 스펙큘러 + 포인터 추적 하이라이트).
- 크로뮴 계열에서만 backdrop-filter url(#svg) 굴절. 그 외 브라우저는 blur/saturate로 폴백. `prefers-reduced-transparency`, `prefers-contrast: more`, 설정의 reduceTransparency 시 불투명 표면.
- 라이트/다크 모두 대비 검증. 라벨 위계는 Apple의 label/secondary/tertiary 체계.
- 동심 코너: 안쪽 radius = 바깥 radius - padding.
- 모션: spring(stiffness 380~520, damping 32~40). prefers-reduced-motion 존중.
- 금지: 그라디언트 텍스트, 에이브로(kicker) 라벨, 같은 크기 카드 그리드, 네온 글로우, 이모지 아이콘, 색 border-left, 가짜 지표.
