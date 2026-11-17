# 키오스크 길잡이 (KIOSSON)

어떤 키오스크든 휴대폰 카메라로 비추면, AI가 눌러야 할 버튼을 화면에 표시하고 음성으로 안내하는 모바일 웹 서비스입니다. 키오스크 주문이 어려운 고령자, 저시력자, 외국인을 돕습니다.

- **서비스 접속:** https://kiosson.vercel.app/
- **기획서:** [자료/팀플기획서-KIOSSON.hwp](자료/팀플기획서-KIOSSON.hwp)
- **구현계획서:** [자료/8조_구현계획.md](자료/8조_구현계획.md)

## 주요 기능

1. **목표 정하기**: 주문할 메뉴를 말하거나(음성 인식), 글자로 적거나, 키오스크 메뉴 화면을 찍어서 AI가 읽어 준 메뉴 중에서 고릅니다.
2. **실시간 안내**: 카메라로 키오스크 화면을 비추면, 휴대폰이 멈춰 있고 화면이 바뀌었을 때만 자동으로 사진을 보내 분석합니다. 찍기 버튼을 누를 필요가 없습니다.
3. **버튼 표시**: 이 화면에서 누를 버튼을 최대 3개까지 사진 위에 상자와 1·2·3 번호로 표시합니다.
4. **음성 안내**: 지금 누를 버튼의 위치와 이름을 한 문장으로 읽어 줍니다. 한국어와 영어를 지원합니다.
5. **피드백**: 안내가 맞았는지 "맞았어요/틀렸어요"로 받아 DB에 저장합니다. 사진은 저장하지 않습니다.

## 구조

```
휴대폰(웹) → Vercel(Next.js API) → Cloudflare Tunnel → 3060 PC의 Ollama → Qwen2.5-VL 3B
```

안내 한 번은 AI를 두 단계로 부릅니다.

1. **판단**: 목표와 지금까지 누른 버튼을 보고, 이 화면에서 누를 버튼의 이름과 순서를 JSON으로 받습니다.
2. **위치 찾기**: 고른 버튼들의 상자 좌표(`bbox_2d`)를 따로 받습니다. 한 번에 받으면 상자가 부정확해서 나눴습니다. 위치 찾기가 실패해도 음성 안내는 그대로 합니다.

| 경로 | 내용 |
|---|---|
| [app/kiosk-guide.tsx](app/kiosk-guide.tsx) | 화면 전체(목표 입력 → 메뉴 찍기 → 실시간 안내) |
| [app/live-camera.ts](app/live-camera.ts) | 화면 변화를 보고 분석할 장면을 고름 |
| [app/frame.ts](app/frame.ts) | 카메라 화면을 모델에 맞는 크기(28의 배수, 약 98만 픽셀)로 캡처 |
| [app/speech.ts](app/speech.ts) | 음성 인식과 음성 안내(Web Speech API) |
| [app/api/guide/route.ts](app/api/guide/route.ts) | `POST /api/guide`: 다음에 누를 버튼 안내 |
| [app/api/menu/route.ts](app/api/menu/route.ts) | `POST /api/menu`: 메뉴 화면에서 메뉴 읽기 |
| [app/api/feedback/route.ts](app/api/feedback/route.ts) | `POST /api/feedback`: 피드백 저장(Neon Postgres) |
| [lib/guide.ts](lib/guide.ts) | 요청·응답 형식, 프롬프트, 모델 출력 검증 |
| [lib/ollama.ts](lib/ollama.ts) | Ollama 호출 |
| [db/schema.sql](db/schema.sql) | 피드백 테이블 |

**기술 스택:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, Ollama + Qwen2.5-VL 3B, Neon Postgres, Vercel

## 실행 방법

Node.js가 필요합니다.

```bash
npm install
cp .env.example .env.local
npm run dev
```

브라우저에서 http://localhost:3000 을 엽니다. localhost에서는 PC 웹캠으로 카메라를 쓸 수 있습니다.

### 환경변수 (`.env.local`)

| 이름 | 설명 |
|---|---|
| `OLLAMA_URL` | Ollama 주소. 기본값 `http://localhost:11434`. 다른 PC에서 돌리면 Cloudflare Tunnel 주소를 넣습니다. |
| `OLLAMA_MODEL` | 모델 이름. 기본값 `qwen2.5vl:3b` |
| `KIOSK_AI_MOCK` | `1`로 두면 AI 서버 없이 정해진 가짜 안내로 화면 흐름만 확인합니다. |
| `DATABASE_URL` | 피드백을 저장할 Neon Postgres 연결 문자열. 비워 두면 저장하지 않습니다. |

### AI 서버 띄우기

[Ollama](https://ollama.com)를 설치하고 모델을 받습니다(약 3GB).

```bash
ollama pull qwen2.5vl:3b
```

GPU가 있는 PC에서 실행해야 실시간으로 쓸 수 있는 속도가 나옵니다. 휴대폰 연결(Tunnel + Vercel)과 LoRA 파인튜닝은 [자료/AI_구현_가이드라인.md](자료/AI_구현_가이드라인.md)를 봅니다.

### 피드백 DB

Neon 콘솔의 SQL Editor에서 [db/schema.sql](db/schema.sql)을 한 번 실행하고, 연결 문자열을 `DATABASE_URL`에 넣습니다.

### 휴대폰에서 테스트

휴대폰 카메라는 HTTPS에서만 열립니다. 실기기 테스트는 Vercel 배포 주소(https://kiosson.vercel.app/)로 합니다. Vercel 환경변수의 `OLLAMA_URL`에는 Tunnel 주소를 넣습니다.

## 알려진 한계

- 화면 변화 기준값([app/live-camera.ts](app/live-camera.ts)의 `MOVING`, `CHANGED`)은 추정치라 실제 매장에서 조정해야 합니다.
- 목업 모드(`KIOSK_AI_MOCK=1`)는 정해진 답만 돌려주므로 실시간 모드에서는 첫 단계 안내만 반복됩니다. 단계 진행은 실제 모델로 확인합니다.
- 임시 Tunnel 주소는 cloudflared를 다시 켤 때마다 바뀝니다. 바뀌면 Vercel 환경변수를 고치고 다시 배포합니다.

## 브랜치 규칙

| 브랜치 | 담당 | 내용 |
|---|---|---|
| `master` | 공동 | 항상 실행 가능한 상태로 유지합니다. 직접 커밋하지 않고 Pull Request로만 병합합니다. |
| `feat/ai` | 이동건 | AI 서버, 프롬프트, 모델 비교, 평가 스크립트 |
| `feat/web` | 정윤서 | 모바일 웹 화면, 음성, API, DB, 배포 |

1. 작업 전에 master의 최신 내용을 담당 브랜치에 반영합니다: `git switch feat/web` 후 `git pull origin master`
2. 담당 브랜치에서 커밋하고 `git push`로 올립니다.
3. 기능이 완성되면 GitHub에서 master로 Pull Request를 만들고, 상대가 확인한 뒤 병합합니다.

기획서 등 `자료/` 폴더의 문서와 README는 코드 실행에 영향이 없으므로 master에 바로 올려도 됩니다.

두 사람이 만나는 지점은 웹 서버와 AI 서버 사이의 요청·응답 형식([lib/guide.ts](lib/guide.ts))입니다. 이 형식을 바꿀 때는 먼저 서로 알립니다.

## 자료

| 문서 | 내용 |
|---|---|
| [자료/8조_구현계획.md](자료/8조_구현계획.md) | MVP·완성본 구현 계획, 일정, 리스크 |
| [자료/AI_구현_가이드라인.md](자료/AI_구현_가이드라인.md) | Ollama 실행, Tunnel 연결, LoRA 파인튜닝 |
| [자료/팀플기획서-KIOSSON.hwp](자료/팀플기획서-KIOSSON.hwp) | 기획서 |
| [자료/중간발표/](자료/중간발표/) | 중간발표 PPT와 대본 |
