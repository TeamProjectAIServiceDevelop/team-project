"use client";

import { useEffect, useRef, useState } from "react";
import type { Guide, Lang } from "@/lib/guide";
import type { Frame } from "./frame";
import { useLiveCamera } from "./live-camera";
import { speak, stopSpeaking, useSpeechRecognition } from "./speech";

// goal: 목표 입력(생략 가능). live: 실시간 카메라로 안내.
type Phase = "goal" | "live";

const RETRY_MS = 3000; // 실시간 분석이 실패하면 이만큼 쉬었다가 다시 본다

const TEXT = {
  ko: {
    goalTitle: "무엇을 주문하고 싶으세요?",
    goalHint: "말하거나 적어도 되고, 그냥 시작하기만 눌러도 화면을 보며 하나씩 안내해 드려요.",
    goalPlaceholder: "예: 아이스 아메리카노 한 잔 포장 (안 적어도 돼요)",
    micStart: "🎤 말하기",
    micStop: "■ 그만 듣기",
    micUnsupported: "이 브라우저는 음성 입력을 지원하지 않아요. 글자로 적거나 그냥 시작하세요.",
    start: "▶ 시작하기",
    live: "실시간",
    livePoint: "키오스크 화면이 테두리 안에 들어오게 비춰 주세요. 화면을 보고 바로 안내해 드려요.",
    liveNext: "버튼을 누르면 바뀐 화면을 자동으로 보고 다음을 알려 드려요.",
    browseNext: "화면이 바뀌면 다음을 알려 드려요. 원하는 메뉴가 있으면 🎤를 눌러 말해 주세요.",
    listening: "듣고 있어요. 원하는 메뉴를 말해 주세요.",
    liveMicGoal: "🎤 원하는 메뉴 말하기",
    liveMicChange: "🎤 목표 바꿔 말하기",
    holdStill: "휴대폰을 잠시 멈춰 주세요.",
    cameraError: "카메라를 열 수 없어요. 브라우저에서 카메라 권한을 허용한 뒤 다시 시도해 주세요.",
    retryCamera: "다시 시도",
    thinking: "화면을 보고 있어요. 잠시만 기다려 주세요.",
    pressHere: "여기를 누르세요",
    replay: "🔊 다시 듣기",
    done: "주문 완료!",
    restart: "처음으로",
    goal: "목표",
    browsing: "목표 없이 안내 중",
    failed: "안내를 받지 못했어요. 잠시 후 다시 볼게요.",
    feedbackAsk: "안내가 맞았나요?",
    feedbackGood: "👍 맞았어요",
    feedbackBad: "👎 틀렸어요",
    feedbackThanks: "알려 주셔서 고마워요!",
  },
  en: {
    goalTitle: "What would you like to order?",
    goalHint: "Speak or type it, or just tap Start and I'll guide you step by step from the screen.",
    goalPlaceholder: "e.g. One iced americano to go (optional)",
    micStart: "🎤 Speak",
    micStop: "■ Stop",
    micUnsupported: "Voice input isn't supported in this browser. Type instead, or just start.",
    start: "▶ Start",
    live: "LIVE",
    livePoint: "Fit the kiosk screen inside the frame. I'll guide you as soon as I see it.",
    liveNext: "After you press it, I'll see the new screen and tell you what's next.",
    browseNext: "I'll tell you what's next when the screen changes. Tap 🎤 to say what you want.",
    listening: "Listening. Tell me what you'd like.",
    liveMicGoal: "🎤 Say what you want",
    liveMicChange: "🎤 Change goal",
    holdStill: "Please hold your phone still.",
    cameraError: "Can't open the camera. Allow camera access in your browser and try again.",
    retryCamera: "Try again",
    thinking: "Looking at the screen. One moment, please.",
    pressHere: "Press here",
    replay: "🔊 Replay",
    done: "Order complete!",
    restart: "Start over",
    goal: "Goal",
    browsing: "Guiding without a goal",
    failed: "Couldn't get guidance. I'll look again shortly.",
    feedbackAsk: "Was this right?",
    feedbackGood: "👍 Yes",
    feedbackBad: "👎 No",
    feedbackThanks: "Thanks for letting us know!",
  },
} satisfies Record<Lang, Record<string, string>>;

type Text = (typeof TEXT)[Lang];

export function KioskGuide() {
  const [lang, setLang] = useState<Lang>("ko");
  const [phase, setPhase] = useState<Phase>("goal");
  const [goal, setGoal] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [cameraError, setCameraError] = useState(false);
  const [cameraTry, setCameraTry] = useState(0);
  const [liveGuide, setLiveGuide] = useState<Guide | null>(null);
  const [liveBusy, setLiveBusy] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastSpoken = useRef("");
  const mic = useSpeechRecognition(lang);
  const live = useLiveCamera(videoRef, {
    // 말하는 동안에는 반쯤 말한 목표로 묻지 않도록 분석을 멈춘다.
    enabled: phase === "live" && !cameraError && !liveGuide?.done && !mic.listening,
    busy: liveBusy,
    onScene: askLive,
  });
  const t = TEXT[lang];
  const browsing = goal.trim() === "";

  const say = (text: string) => speak(text, lang);

  // 실시간 화면이 계속 같은 안내를 내도 한 번만 읽어 준다.
  function sayOnce(text: string) {
    if (text === lastSpoken.current) return;
    lastSpoken.current = text;
    say(text);
  }

  // 실시간 단계에서만 후면 카메라를 켜고, 벗어나면 끈다.
  const cameraOn = phase === "live";
  useEffect(() => {
    if (!cameraOn) return;
    let stream: MediaStream | undefined;
    let cancelled = false;
    navigator.mediaDevices
      ?.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = s;
        if (videoRef.current) videoRef.current.srcObject = s;
      })
      .catch(() => setCameraError(true));
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [cameraOn, cameraTry]);

  async function requestGuide(next: Frame, sentHistory: string[]): Promise<Guide> {
    const res = await fetch("/api/guide", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        image: next.base64,
        width: next.width,
        height: next.height,
        goal,
        history: sentHistory,
        lang,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? t.failed);
    return data as Guide;
  }

  function startLive() {
    mic.stop();
    setCameraError(false);
    setLiveGuide(null);
    setLiveError(null);
    setLiveBusy(false);
    lastSpoken.current = "";
    live.rescan();
    setPhase("live");
    sayOnce(t.livePoint);
  }

  function retryCamera() {
    setCameraError(false);
    setCameraTry((n) => n + 1);
  }

  async function askLive(scene: Frame) {
    setLiveBusy(true);
    setLiveError(null);
    try {
      const next = await requestGuide(scene, history);
      // 다른 버튼을 안내받았으면 앞에서 안내한 버튼은 누른 것으로 본다.
      if (liveGuide?.button && next.button !== liveGuide.button) {
        const pressedButton = liveGuide.button;
        setHistory((h) => [...h, pressedButton]);
      }
      setLiveGuide(next);
      setLiveBusy(false);
      sayOnce(next.message);
    } catch (e) {
      const message = e instanceof Error && e.message ? e.message : t.failed;
      setLiveError(message);
      sayOnce(message);
      setTimeout(() => {
        setLiveBusy(false);
        live.rescan();
      }, RETRY_MS);
    }
  }

  function liveStatus() {
    if (mic.listening) return t.listening;
    if (live.moving) return t.holdStill;
    if (liveBusy) return t.thinking;
    if (!liveGuide) return t.livePoint;
    return browsing ? t.browseNext : t.liveNext;
  }

  function toggleMic() {
    if (mic.listening) {
      mic.stop();
      return;
    }
    mic.start(setGoal);
  }

  // 실시간 안내 중에 목표를 말하면, 말이 끝난 뒤 같은 화면을 새 목표로 다시 본다.
  function toggleLiveMic() {
    if (mic.listening) {
      mic.stop();
      return;
    }
    mic.start(setGoal, () => {
      setLiveGuide(null);
      lastSpoken.current = "";
      live.rescan();
    });
  }

  function restart() {
    stopSpeaking();
    mic.stop();
    setGoal("");
    setHistory([]);
    setLiveGuide(null);
    setLiveError(null);
    setLiveBusy(false);
    lastSpoken.current = "";
    setPhase("goal");
  }

  return (
    <div className="flex w-full max-w-md flex-1 flex-col gap-5 px-4 py-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">키오스크 길잡이</h1>
        <div className="flex overflow-hidden rounded-full border border-zinc-300 text-sm dark:border-zinc-700">
          {(["ko", "en"] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLang(l)}
              className={`px-3 py-1.5 ${lang === l ? "bg-foreground text-background" : ""}`}
            >
              {l === "ko" ? "한국어" : "EN"}
            </button>
          ))}
        </div>
      </header>

      {phase === "live" && (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-zinc-100 px-4 py-3 text-lg dark:bg-zinc-900">
          <span>
            {browsing ? (
              t.browsing
            ) : (
              <>
                <span className="text-zinc-500">{t.goal}: </span>
                {goal}
              </>
            )}
          </span>
          <button type="button" onClick={restart} className="shrink-0 text-base underline">
            {t.restart}
          </button>
        </div>
      )}

      {phase === "goal" && (
        <section className="flex flex-col gap-4">
          <h2 className="text-3xl font-bold leading-tight">{t.goalTitle}</h2>
          <p className="text-lg text-zinc-600 dark:text-zinc-400">
            {mic.supported ? t.goalHint : t.micUnsupported}
          </p>
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder={t.goalPlaceholder}
            rows={2}
            maxLength={200}
            className="rounded-xl border-2 border-zinc-300 bg-transparent p-4 text-2xl dark:border-zinc-700"
          />
          {mic.supported && (
            <button
              type="button"
              onClick={toggleMic}
              className={`h-16 rounded-2xl text-2xl font-bold text-white ${
                mic.listening ? "animate-pulse bg-red-600" : "bg-blue-600"
              }`}
            >
              {mic.listening ? t.micStop : t.micStart}
            </button>
          )}
          <button
            type="button"
            onClick={startLive}
            className="h-20 rounded-2xl bg-foreground text-3xl font-bold text-background"
          >
            {t.start}
          </button>
        </section>
      )}

      {phase === "live" && (
        <section className="flex flex-col gap-4">
          {liveError && (
            <p role="alert" className="rounded-xl bg-red-100 p-4 text-lg text-red-800 dark:bg-red-950 dark:text-red-200">
              {liveError}
            </p>
          )}
          {cameraError ? (
            <>
              <p className="text-lg">{t.cameraError}</p>
              <button
                type="button"
                onClick={retryCamera}
                className="h-20 rounded-2xl bg-foreground text-2xl font-bold text-background"
              >
                {t.retryCamera}
              </button>
            </>
          ) : (
            <>
              <p className="text-lg" aria-live="polite">
                <span className="mr-2 rounded-full bg-red-600 px-2.5 py-0.5 align-middle text-sm font-bold text-white">
                  ● {t.live}
                </span>
                {liveStatus()}
              </p>
              <div className="relative overflow-hidden rounded-2xl bg-black">
                <video ref={videoRef} autoPlay playsInline muted className="block w-full" />
                {!liveGuide?.box && (
                  <div className="pointer-events-none absolute inset-4 rounded-xl border-4 border-dashed border-white/80" />
                )}
                {liveGuide?.box && !live.moving && <PressHere box={liveGuide.box} label={t.pressHere} />}
              </div>
            </>
          )}

          {liveGuide && (
            <>
              {liveGuide.done && <p className="text-center text-3xl font-bold text-green-600">{t.done}</p>}
              <p className="rounded-2xl bg-yellow-100 p-5 text-2xl font-bold leading-snug text-zinc-900">
                {liveGuide.message}
              </p>
              {liveGuide.stage && (
                <p className="text-base text-zinc-500">
                  {liveGuide.stage}
                  {history.length > 0 && ` · ${history.join(" → ")}`}
                </p>
              )}
              <button
                type="button"
                onClick={() => say(liveGuide.message)}
                className="h-14 rounded-2xl border-2 border-zinc-300 text-xl font-bold dark:border-zinc-700"
              >
                {t.replay}
              </button>
              <Feedback key={liveGuide.message} guide={liveGuide} goal={goal} lang={lang} t={t} />
            </>
          )}

          {liveGuide?.done ? (
            <button
              type="button"
              onClick={restart}
              className="h-20 rounded-2xl bg-foreground text-2xl font-bold text-background"
            >
              {t.restart}
            </button>
          ) : (
            !cameraError &&
            mic.supported && (
              <button
                type="button"
                onClick={toggleLiveMic}
                className={`h-16 rounded-2xl text-xl font-bold text-white ${
                  mic.listening ? "animate-pulse bg-red-600" : "bg-blue-600"
                }`}
              >
                {mic.listening ? t.micStop : browsing ? t.liveMicGoal : t.liveMicChange}
              </button>
            )
          )}
        </section>
      )}
    </div>
  );
}

/** 안내가 맞았는지 묻고 저장한다. 저장이 안 돼도 사용자에게는 고맙다고만 한다. */
function Feedback({ guide, goal, lang, t }: { guide: Guide; goal: string; lang: Lang; t: Text }) {
  const [sent, setSent] = useState(false);

  function send(correct: boolean) {
    setSent(true);
    void fetch("/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        goal,
        stage: guide.stage,
        button: guide.button,
        message: guide.message,
        correct,
        mode: "live",
        lang,
      }),
    }).catch(() => {});
  }

  if (sent) return <p className="text-center text-lg text-zinc-500">{t.feedbackThanks}</p>;
  return (
    <div className="flex items-center gap-3">
      <span className="shrink-0 text-lg">{t.feedbackAsk}</span>
      <button
        type="button"
        onClick={() => send(true)}
        className="h-12 flex-1 rounded-xl border-2 border-zinc-300 text-lg font-bold dark:border-zinc-700"
      >
        {t.feedbackGood}
      </button>
      <button
        type="button"
        onClick={() => send(false)}
        className="h-12 flex-1 rounded-xl border-2 border-zinc-300 text-lg font-bold dark:border-zinc-700"
      >
        {t.feedbackBad}
      </button>
    </div>
  );
}

/** 영상 위에 눌러야 할 버튼을 빨간 상자로 표시한다. 좌표가 비율이라 크기가 바뀌어도 맞는다. */
function PressHere({ box, label }: { box: NonNullable<Guide["box"]>; label: string }) {
  const labelBelow = box.top < 0.12;
  return (
    <div
      className="pointer-events-none absolute"
      style={{
        left: `${box.left * 100}%`,
        top: `${box.top * 100}%`,
        width: `${box.width * 100}%`,
        height: `${box.height * 100}%`,
      }}
    >
      <div className="absolute -inset-1 animate-ping rounded-lg border-4 border-red-500 opacity-60" />
      <div className="absolute -inset-1 rounded-lg border-4 border-red-500 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
      <span
        className={`absolute left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-red-600 px-3 py-1 text-base font-bold text-white ${
          labelBelow ? "top-full mt-2" : "bottom-full mb-2"
        }`}
      >
        {labelBelow ? "▲" : "▼"} {label}
      </span>
    </div>
  );
}
