# 한투 ETF 자동매매 - 모바일 현황 앱

한국투자증권 ETF 자동매매의 오늘 상태를 **휴대폰에서** 확인하는 화면입니다.
이 저장소에는 **화면(HTML/CSS/JS)만** 있습니다. 계좌 데이터는 들어 있지 않습니다.

- 앱 주소: <https://jimkdy531-jimi.github.io/kis-etf-dashboard/>
- 예시(데모) 화면: <https://jimkdy531-jimi.github.io/kis-etf-dashboard/?demo=1>

## 어떻게 동작하나요

```
[휴대폰 브라우저]
   이 화면(공개 저장소, 정적 파일)
        │  사용자가 입력한 GitHub 토큰(localStorage)
        ▼  GitHub API 직접 호출
[비공개 저장소 jimkdy531-jimi/kis-etf-rebalancer]
   · data/status.json  ← 매 실행 후 자동 커밋되는 계좌 요약
   · Actions 실행 이력 / Variables(일시중지 스위치)
```

1. 자동매매 프로그램(GitHub Actions)이 평일 09:20에 돌고, 끝나면 `data/status.json`을 저장소에 커밋합니다.
2. 이 화면은 사용자가 넣은 토큰으로 그 파일을 읽어 카드·차트를 그립니다.
3. **[지금 1회 실행]** 은 `workflow_dispatch`로, **[자동매매 일시중지]** 는 `KIS_KILL_SWITCH` 변수로 실행을 제어합니다.

**토큰이 없으면 데모/안내 화면만 보이고, 실제 계좌 정보는 표시되지 않습니다.**

## 휴대폰에서 앱처럼 쓰기 (안드로이드 크롬)

1. 크롬에서 앱 주소를 엽니다.
2. 오른쪽 위 `⋮` → **홈 화면에 추가** 를 누릅니다.
3. 홈 화면의 `한투ETF` 아이콘으로 열면 주소창 없는 앱 화면으로 뜹니다.

## 필요한 토큰 권한 (Fine-grained PAT)

`kis-etf-rebalancer` 저장소 **하나에만** 권한을 주는 토큰을 만드세요.
(<https://github.com/settings/personal-access-tokens/new>)

| 권한 | 값 | 쓰임 |
| --- | --- | --- |
| Repository access | Only select repositories → `kis-etf-rebalancer` | 다른 저장소는 못 봄 |
| Contents | Read-only | `data/status.json` 읽기 |
| Actions | Read and write | 실행 요청, 실행 이력 |
| Variables | Read and write | 일시중지 스위치 읽기/쓰기 |

- 만료일은 90일을 권장합니다. 만료되면 새 토큰을 만들어 화면에서 교체하면 됩니다.
- 토큰은 그 휴대폰 브라우저의 `localStorage`에만 저장되고, `api.github.com` 외에는 전송되지 않습니다.
- 휴대폰을 잃어버렸다면 GitHub에서 그 토큰을 **Revoke** 하면 즉시 무효가 됩니다.

## 파일

| 파일 | 설명 |
| --- | --- |
| `index.html` | 화면 구조 (1열 카드, 큰 글씨) |
| `styles.css` | 스타일 (기본 18px, 큰 버튼, 밝은 카드 UI) |
| `app.js` | GitHub API 호출·화면 그리기·버튼 동작 (Chart.js 사용) |
| `manifest.json` | PWA 설정 (홈 화면 추가, standalone) |
| `sw.js` | Service Worker (앱 파일 오프라인 보관, **계좌 API는 캐시하지 않음**) |
| `icon-*.png`, `apple-touch-icon.png`, `favicon.png` | 앱 아이콘 |

## 개발 메모

- 정적 파일만 있으므로 빌드 과정이 없습니다. 파일을 고치고 커밋하면 바로 반영됩니다.
- 화면에서 쓰는 상태 파일 형식(`data/status.json`)은 `kis-etf-rebalancer` 저장소의
  `rebalance.py`가 만들며, 계좌번호·앱키 같은 민감정보는 들어가지 않습니다.
- 차트는 Chart.js(CDN)를 씁니다. 첫 로딩 때만 인터넷이 필요하고, 이후에는 Service Worker가 보관합니다.
