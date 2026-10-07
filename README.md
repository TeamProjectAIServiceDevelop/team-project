# 키오스크 길잡이 (KIOSSON)

어떤 키오스크든 휴대폰 카메라로 비추면, AI가 눌러야 할 버튼을 화면에 표시하고 음성으로 안내하는 모바일 웹 서비스입니다. 기획서는 [자료/팀플기획서-KIOSSON.hwp](자료/팀플기획서-KIOSSON.hwp)에 있습니다.

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

---

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
