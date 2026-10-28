// 평가 스크립트 시험용 가짜 키오스크 화면(eval/data/sample)을 만든다. 실제 평가에는 쓰지 않는다.
// 사용법: node eval/make-sample.mjs
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const dir = path.join("eval", "data", "sample");
const W = 720;
const H = 1280;

function tile([x1, y1, x2, y2], label, fill = "#ffffff") {
  const size = Math.min(40, Math.floor((x2 - x1 - 30) / (label.length * 0.95))); // 긴 이름은 상자에 맞게 줄인다
  return `<rect x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}" rx="16" fill="${fill}" stroke="#c8c8c8" stroke-width="3"/>
  <text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 + size / 3}" font-size="${size}" text-anchor="middle">${label}</text>`;
}

function screen(title, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="Malgun Gothic, sans-serif">
  <rect width="${W}" height="${H}" fill="#f4f1ea"/>
  <rect width="${W}" height="140" fill="#3b2f2a"/>
  <text x="${W / 2}" y="92" font-size="48" fill="#ffffff" text-anchor="middle">${title}</text>
  ${body}
</svg>`;
}

const box = {
  coffee: [250, 540, 470, 680],
  americano: [40, 760, 330, 900],
  pay: [420, 1120, 690, 1240],
};

const menu = screen(
  "메뉴를 선택하세요",
  [
    tile([30, 540, 240, 680], "음료"),
    tile(box.coffee, "커피"),
    tile([480, 540, 690, 680], "디저트"),
    tile(box.americano, "아이스 아메리카노"),
    tile([390, 760, 680, 900], "카페라떼"),
  ].join("\n"),
);

const cart = screen(
  "장바구니",
  [
    `<text x="60" y="260" font-size="40">아이스 아메리카노 1잔 · 4,500원</text>`,
    tile([30, 1120, 400, 1240], "이전으로"),
    tile(box.pay, "결제하기", "#ffd84d"),
  ].join("\n"),
);

await mkdir(path.join(dir, "images"), { recursive: true });
await sharp(Buffer.from(menu)).png().toFile(path.join(dir, "images", "menu.png"));
await sharp(Buffer.from(cart)).png().toFile(path.join(dir, "images", "cart.png"));

const goal = "아이스 아메리카노 한 잔 포장";
const labels = [
  { id: "sample-menu-1", image: "images/menu.png", store: "가짜 카페", source: "photo", goal, history: [], answer: { stage: "메뉴 선택", button: "커피", box: box.coffee } },
  { id: "sample-menu-2", image: "images/menu.png", store: "가짜 카페", source: "photo", goal, history: ["커피"], answer: { stage: "메뉴 선택", button: "아이스 아메리카노", box: box.americano } },
  { id: "sample-cart-1", image: "images/cart.png", store: "가짜 카페", source: "photo", goal, history: ["커피", "아이스 아메리카노"], answer: { stage: "장바구니", button: "결제하기", box: box.pay } },
];
await writeFile(path.join(dir, "labels.jsonl"), labels.map((l) => JSON.stringify(l)).join("\n") + "\n", "utf8");
console.log(`만들었어요: ${dir} (${labels.length}문항)`);
