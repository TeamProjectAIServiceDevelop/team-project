"use client";

import { useEffect, useRef, useState } from "react";
import type { Guide, Lang } from "@/lib/guide";
import { captureFrame, fileToFrame, type Frame } from "./frame";
import { useLiveCamera } from "./live-camera";
import { speak, stopSpeaking, useSpeechRecognition } from "./speech";

// live: 실시간 카메라(기본). camera/thinking/result: 찍기 버튼 방식(실시간이 불안정할 때의 대체).
type Phase = "goal" | "live" | "camera" | "thinking" | "result";

const RETRY_MS = 3000; // 실시간 분석이 실패하면 이만큼 쉬었다가 다시 본다

const TEXT = {
  ko: {
    goalTitle: "무엇을 주문하고 싶으세요?",
    goalHint: "마이크를 누르고 말해 보세요. 그냥 시작하면 메뉴를 둘러볼 수 있어요.",
    goalPlaceholder: "예: 아이스 아메리카노 한 잔 포장",
    micStart: "🎤 말하기",
    micStop: "■ 그만 듣기",
    micUnsupported: "이 브라우저는 음성 입력을 지원하지 않아요. 글자로 입력하거나 그냥 시작해 메뉴를 둘러보세요.",
    start: "시작하기",
    startBrowse: "목표 없이 둘러보기",
    live: "실시간",
    livePoint: "키오스크 화면이 테두리 안에 들어오게 비춰 주세요. 찍기 버튼은 누르지 않아도 돼요.",
    liveBrowse: "둘러볼 키오스크 화면을 비춰 주세요. 화면에 무엇이 있는지 읽어 드릴게요.",
    liveNext: "버튼을 누르면 바뀐 화면을 자동으로 보고 다음을 알려 드려요.",
    browseNext: "다른 화면을 비추면 다시 읽어 드려요.",
    holdStill: "휴대폰을 잠시 멈춰 주세요.",
    usePhoto: "찍기 버튼으로 하기",
    useLive: "실시간으로 하기",
    pointCamera: "키오스크 화면이 테두리 안에 들어오게 비추고 찍기 버튼을 누르세요.",
    shoot: "📷 찍기",
    upload: "사진 고르기",
    cameraError: "카메라를 열 수 없어요. 사진 고르기를 눌러 주세요.",
    thinking: "화면을 보고 있어요. 잠시만 기다려 주세요.",
    pressHere: "여기를 누르세요",
    replay: "🔊 다시 듣기",
    pressed: "눌렀어요, 다음 화면",
    retake: "다시 찍기",
    nextShot: "잘하셨어요. 바뀐 화면을 다시 찍어 주세요.",
    done: "주문 완료!",
    restart: "처음으로",
    changeGoal: "목표 바꾸기",
    setGoal: "목표 정하기",
    goal: "목표",
    browsing: "둘러보기 중",
    failed: "안내를 받지 못했어요. 다시 찍어 주세요.",
    feedbackAsk: "안내가 맞았나요?",
    feedbackGood: "👍 맞았어요",
    feedbackBad: "👎 틀렸어요",
    feedbackThanks: "알려 주셔서 고마워요!",
  },
  en: {
    goalTitle: "What would you like to order?",
    goalHint: "Tap the mic and speak. Or just start to browse the menu.",
    goalPlaceholder: "e.g. One iced americano to go",
    micStart: "🎤 Speak",
    micStop: "■ Stop",
    micUnsupported: "Voice input isn't supported in this browser. Type instead, or just start to browse.",
    start: "Start",
    startBrowse: "Browse without a goal",
    live: "LIVE",
    livePoint: "Fit the kiosk screen inside the frame. No need to tap a shoot button.",
    liveBrowse: "Point at the kiosk screen to browse. I'll read out what's on it.",
    liveNext: "After you press it, I'll see the new screen and tell you what's next.",
    browseNext: "Point at another screen and I'll read it again.",
    holdStill: "Please hold your phone still.",
    usePhoto: "Use the shoot button",
    useLive: "Use live mode",
    pointCamera: "Fit the kiosk screen inside the frame and tap the shoot button.",
    shoot: "📷 Shoot",
    upload: "Choose photo",
    cameraError: "Can't open the camera. Tap Choose photo instead.",
    thinking: "Looking at the screen. One moment, please.",
    pressHere: "Press here",
    replay: "🔊 Replay",
    pressed: "Done, next screen",
    retake: "Retake",
    nextShot: "Well done. Please take a photo of the new screen.",
    done: "Order complete!",
    restart: "Start over",
    changeGoal: "Change goal",
    setGoal: "Set a goal",
    goal: "Goal",
    browsing: "Browsing",
    failed: "Couldn't get guidance. Please take the photo again.",
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
  const [frame, setFrame] = useState<Frame | null>(null);
  const [guide, setGuide] = useState<Guide | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState(false);
  const [liveGuide, setLiveGuide] = useState<Guide | null>(null);
  const [liveBusy, setLiveBusy] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastSpoken = useRef("");
  const mic = useSpeechRecognition(lang);
  const live = useLiveCamera(videoRef, {
    enabled: phase === "live" && !cameraError && !liveGuide?.done,
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

  // 카메라 단계(실시간, 찍기)에서만 후면 카메라를 켜고, 벗어나면 끈다.
  const cameraOn = phase === "live" || phase === "camera";
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
  }, [cameraOn]);

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
    sayOnce(browsing ? t.liveBrowse : t.livePoint);
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
    if (live.moving) return t.holdStill;
    if (liveBusy) return t.thinking;
    if (!liveGuide) return browsing ? t.liveBrowse : t.livePoint;
    return browsing ? t.browseNext : t.liveNext;
  }

  function goToCamera(announcement: string) {
    setCameraError(false);
    setGuide(null);
    setPhase("camera");
    say(announcement);
  }

  function toggleMic() {
    if (mic.listening) {
      mic.stop();
      return;
    }
    mic.start(setGoal);
  }

  async function ask(next: Frame) {
    setFrame(next);
    setError(null);
    setPhase("thinking");
    say(t.thinking);
    try {
      const data = await requestGuide(next, history);
      setGuide(data);
      setPhase("result");
      say(data.message);
    } catch (e) {
      const message = e instanceof Error && e.message ? e.message : t.failed;
      setError(message);
      setCameraError(false);
      setPhase("camera");
      say(message);
    }
  }

  function shoot() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    void ask(captureFrame(video));
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void ask(await fileToFrame(file));
  }

  function pressed() {
    if (guide?.button) setHistory((h) => [...h, guide.button]);
    goToCamera(t.nextShot);
  }

  function restart() {
    stopSpeaking();
    setGoal("");
    setHistory([]);
    setFrame(null);
    setGuide(null);
    setError(null);
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

      {phase !== "goal" && (
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
            {browsing ? t.setGoal : t.changeGoal}
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
              className={`h-20 rounded-2xl text-2xl font-bold text-white ${
                mic.listening ? "animate-pulse bg-red-600" : "bg-blue-600"
              }`}
            >
              {mic.listening ? t.micStop : t.micStart}
            </button>
          )}
          <button
            type="button"
            onClick={startLive}
            className="h-16 rounded-2xl bg-foreground text-2xl font-bold text-background"
          >
            {browsing ? t.startBrowse : t.start}
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
                onClick={() => fileRef.current?.click()}
                className="h-20 rounded-2xl border-2 border-zinc-300 text-xl font-bold dark:border-zinc-700"
              >
                {t.upload}
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
              <Feedback key={liveGuide.message} guide={liveGuide} goal={goal} mode="live" lang={lang} t={t} />
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
            !cameraError && (
              <button type="button" onClick={() => goToCamera(t.pointCamera)} className="text-lg underline">
                {t.usePhoto}
              </button>
            )
          )}
        </section>
      )}

      {phase === "camera" && (
        <section className="flex flex-col gap-4">
          {error && (
            <p role="alert" className="rounded-xl bg-red-100 p-4 text-lg text-red-800 dark:bg-red-950 dark:text-red-200">
              {error}
            </p>
          )}
          <p className="text-lg">{cameraError ? t.cameraError : t.pointCamera}</p>
          {!cameraError && (
            <div className="relative overflow-hidden rounded-2xl bg-black">
              <video ref={videoRef} autoPlay playsInline muted className="block w-full" />
              <div className="pointer-events-none absolute inset-4 rounded-xl border-4 border-dashed border-white/80" />
            </div>
          )}
          <div className="flex gap-3">
            {!cameraError && (
              <button
                type="button"
                onClick={shoot}
                className="h-20 flex-1 rounded-2xl bg-blue-600 text-2xl font-bold text-white"
              >
                {t.shoot}
              </button>
            )}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className={`h-20 rounded-2xl border-2 border-zinc-300 px-4 text-lg font-bold dark:border-zinc-700 ${
                cameraError ? "flex-1" : ""
              }`}
            >
              {t.upload}
            </button>
          </div>
          {!cameraError && (
            <button type="button" onClick={startLive} className="text-lg underline">
              {t.useLive}
            </button>
          )}
        </section>
      )}

      <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />

      {(phase === "thinking" || phase === "result") && frame && (
        <section className="flex flex-col gap-4">
          <div className="relative overflow-hidden rounded-2xl">
            {/* eslint-disable-next-line @next/next/no-img-element -- 방금 찍은 data URL 사진이라 next/image 최적화 대상이 아니다 */}
            <img src={frame.dataUrl} alt="찍은 키오스크 화면" className="block w-full" />
            {phase === "thinking" && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-2xl font-bold text-white">
                <span className="animate-pulse">{t.thinking}</span>
              </div>
            )}
            {phase === "result" && guide?.box && <PressHere box={guide.box} label={t.pressHere} />}
          </div>

          {phase === "result" && guide && (
            <>
              {guide.done && <p className="text-center text-3xl font-bold text-green-600">{t.done}</p>}
              <p className="rounded-2xl bg-yellow-100 p-5 text-2xl font-bold leading-snug text-zinc-900">
                {guide.message}
              </p>
              {guide.stage && (
                <p className="text-base text-zinc-500">
                  {guide.stage}
                  {history.length > 0 && ` · ${history.join(" → ")}`}
                </p>
              )}
              <button
                type="button"
                onClick={() => say(guide.message)}
                className="h-14 rounded-2xl border-2 border-zinc-300 text-xl font-bold dark:border-zinc-700"
              >
                {t.replay}
              </button>
              <Feedback key={guide.message} guide={guide} goal={goal} mode="photo" lang={lang} t={t} />
              {guide.done ? (
                <button
                  type="button"
                  onClick={restart}
                  className="h-20 rounded-2xl bg-foreground text-2xl font-bold text-background"
                >
                  {t.restart}
                </button>
              ) : (
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={pressed}
                    className="h-20 flex-[2] rounded-2xl bg-blue-600 text-xl font-bold text-white"
                  >
                    {t.pressed}
                  </button>
                  <button
                    type="button"
                    onClick={() => goToCamera(t.pointCamera)}
                    className="h-20 flex-1 rounded-2xl border-2 border-zinc-300 text-xl font-bold dark:border-zinc-700"
                  >
                    {t.retake}
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}

/** 안내가 맞았는지 묻고 저장한다. 저장이 안 돼도 사용자에게는 고맙다고만 한다. */
function Feedback({
  guide,
  goal,
  mode,
  lang,
  t,
}: {
  guide: Guide;
  goal: string;
  mode: "live" | "photo";
  lang: Lang;
  t: Text;
}) {
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
        mode,
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

/** 사진·영상 위에 눌러야 할 버튼을 빨간 상자로 표시한다. 좌표가 비율이라 크기가 바뀌어도 맞는다. */
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
