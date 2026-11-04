const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen2.5vl:3b";

/** AI 서버 호출이 실패했을 때. status는 웹 API가 그대로 돌려줄 HTTP 상태 코드다. */
export class AiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Ollama에 대화를 보내고 모델 출력을 받는다. format 스키마를 주면 그 형식의 JSON 문자열이 오고,
 * 주지 않으면 모델이 쓰는 그대로(위치 찾기의 ```json 블록 등) 온다.
 */
export async function chat(messages: unknown[], format?: object): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        ...(format ? { format } : {}),
        // 모델이 같은 말을 되풀이하면 끝없이 써서 30초 넘게 걸렸다. 정상 답은 메뉴 12개를 읽어도 400토큰 안쪽이다.
        options: { temperature: 0, num_predict: 600 },
        messages,
      }),
      signal: AbortSignal.timeout(90_000),
    });
  } catch {
    throw new AiError("AI 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.", 503);
  }
  if (!res.ok) {
    // 사용자에게는 상태 코드만 보여 주고, 원인은 서버 로그(Vercel Logs)에서 본다.
    console.error("Ollama error", res.status, (await res.text().catch(() => "")).slice(0, 500));
    throw new AiError(`AI 서버 오류 (${res.status})`, 502);
  }

  const data = (await res.json()) as { message?: { content?: string } };
  return data.message?.content ?? "";
}
