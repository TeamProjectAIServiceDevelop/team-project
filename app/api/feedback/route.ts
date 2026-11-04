import { neon } from "@neondatabase/serverless";
import type { Lang } from "@/lib/guide";

const DATABASE_URL = process.env.DATABASE_URL;

type Feedback = {
  goal: string;
  stage: string;
  button: string;
  message: string;
  correct: boolean;
  mode: "live" | "photo";
  lang: Lang;
};

/** 안내가 맞았는지 사용자 피드백을 저장한다. 사진은 저장하지 않는다 (db/schema.sql). */
export async function POST(request: Request) {
  const fb = readFeedback(await request.json().catch(() => null));
  if (!fb) return Response.json({ error: "요청 형식이 올바르지 않아요." }, { status: 400 });
  if (!DATABASE_URL) return Response.json({ error: "피드백 저장소가 설정되지 않았어요." }, { status: 503 });

  try {
    const sql = neon(DATABASE_URL);
    await sql`
      INSERT INTO feedback (goal, stage, button, message, correct, mode, lang)
      VALUES (${fb.goal}, ${fb.stage}, ${fb.button}, ${fb.message}, ${fb.correct}, ${fb.mode}, ${fb.lang})
    `;
  } catch {
    return Response.json({ error: "피드백을 저장하지 못했어요." }, { status: 502 });
  }
  return Response.json({ saved: true });
}

function readFeedback(body: unknown): Feedback | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const text = (v: unknown, max: number) => typeof v === "string" && v.length <= max;
  const ok =
    text(b.goal, 200) &&
    text(b.stage, 100) &&
    text(b.button, 100) &&
    text(b.message, 500) &&
    typeof b.correct === "boolean" &&
    (b.mode === "live" || b.mode === "photo") &&
    (b.lang === "ko" || b.lang === "en");
  return ok ? (b as Feedback) : null;
}
