"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { buttonClass } from "@/components/ui";
import { formatNumber } from "@/lib/format";
import {
  SCAN_RESULT_TEXT,
  addPending,
  cleanBarcode,
  dropAnswered,
  isCartonBarcode,
  pendingKey,
  readPending,
  scanIsGood,
  type PendingScan,
  type ScanResult,
} from "@/lib/supplier";
import { scanCartons } from "@/server/actions/supplier";

export type ScanCarton = { barcode: string; carton_no: number; product: string; status: "issued" | "loaded" | "void" };

type Feedback = { tone: "ok" | "warn" | "bad"; title: string; detail: string } | null;
type Detector = { detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> };

/** Reads a frame: the phone's own barcode reader where there is one (Android Chrome), else the QR code on the label. */
async function makeReader(): Promise<{ read: (video: HTMLVideoElement) => Promise<string | null>; qrOnly: boolean }> {
  const Native = (globalThis as { BarcodeDetector?: { new (init: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> } }).BarcodeDetector;
  if (Native) {
    try {
      const formats = (await Native.getSupportedFormats?.()) ?? ["code_128", "qr_code"];
      const wanted = ["code_128", "qr_code"].filter((f) => formats.includes(f));
      if (wanted.length) {
        const detector = new Native({ formats: wanted });
        return { qrOnly: !wanted.includes("code_128"), read: async (video) => (await detector.detect(video))[0]?.rawValue ?? null };
      }
    } catch {
      // Fall through to the QR reader.
    }
  }
  const { default: jsQR } = await import("jsqr");
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  return {
    qrOnly: true,
    read: async (video) => {
      if (!ctx || !video.videoWidth) return null;
      // The middle of the picture, at most 640px wide: fast enough on an old phone.
      const scale = Math.min(1, 640 / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" })?.data ?? null;
    },
  };
}

function signal(good: boolean) {
  try {
    navigator.vibrate?.(good ? 60 : [120, 60, 120]);
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const audio = new Ctx();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = good ? 880 : 220;
    gain.gain.value = 0.15;
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + (good ? 0.12 : 0.35));
    osc.onended = () => void audio.close();
  } catch {
    // No sound is fine.
  }
}

/**
 * The loading screen. Every carton is scanned as it goes on the vehicle; the count runs live.
 * A scan is first kept on the phone and then sent, so loading carries on with no signal: the scans wait and go when
 * the connection is back. The same carton twice counts once.
 */
export function Scanner({ dispatchId, number, cartons, planned, backHref }: { dispatchId: string; number: number; cartons: ScanCarton[]; planned: number; backHref: string }) {
  const [status, setStatus] = useState(() => new Map(cartons.map((c) => [c.barcode, c.status])));
  const [waiting, setWaiting] = useState<PendingScan[]>([]);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [camera, setCamera] = useState<"off" | "starting" | "on" | "blocked">("off");
  const [qrOnly, setQrOnly] = useState(false);
  const [typed, setTyped] = useState("");
  const [online, setOnline] = useState(true);
  const [closed, setClosed] = useState(false);

  const byCode = useRef(new Map(cartons.map((c) => [c.barcode, c])));
  const queue = useRef<PendingScan[]>([]);
  const sending = useRef(false);
  const flushRef = useRef<() => Promise<void>>(async () => undefined);
  const lastSeen = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);

  const keep = useCallback(
    (next: PendingScan[]) => {
      queue.current = next;
      setWaiting(next);
      try {
        window.localStorage.setItem(pendingKey(dispatchId), JSON.stringify(next));
      } catch {
        // No storage (private mode): the scans still wait in memory while this screen is open.
      }
    },
    [dispatchId],
  );

  const flush = useCallback(async () => {
    if (sending.current || !queue.current.length) return;
    sending.current = true;
    try {
      const batch = queue.current.slice(0, 200);
      const result = await scanCartons(dispatchId, batch);
      if (!result.ok || !result.data) return;
      const answers = result.data;
      keep(dropAnswered(queue.current, answers.length ? answers : batch));
      setStatus((old) => {
        const next = new Map(old);
        for (const a of answers) if (a.result === "loaded" || a.result === "already") next.set(a.barcode, "loaded");
        for (const a of answers) if (a.result === "void") next.set(a.barcode, "void");
        return next;
      });
      const refused = answers.filter((a) => !scanIsGood(a.result));
      if (answers.some((a) => a.result === "closed")) setClosed(true);
      if (refused.length) {
        const a = refused[refused.length - 1];
        signal(false);
        setFeedback({ tone: "bad", title: SCAN_RESULT_TEXT[a.result as ScanResult], detail: a.carton_no ? `Label ${a.carton_no} · ${a.barcode}` : a.barcode });
      }
    } catch {
      // No connection: the scans stay on the phone and are sent later.
    } finally {
      sending.current = false;
      // More than one batch was waiting: send the next.
      if (queue.current.length && navigator.onLine) window.setTimeout(() => void flushRef.current(), 400);
    }
  }, [dispatchId, keep]);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  const take = useCallback(
    (raw: string) => {
      const code = cleanBarcode(raw);
      const now = Date.now();
      if (!code || (code === lastSeen.current.code && now - lastSeen.current.at < 2500)) return;
      lastSeen.current = { code, at: now };
      if (!isCartonBarcode(code)) {
        signal(false);
        return setFeedback({ tone: "bad", title: "Not a carton label", detail: "Scan the barcode printed on the dispatch label." });
      }
      const known = byCode.current.get(code);
      const state = status.get(code);
      if (known && state === "void") {
        signal(false);
        return setFeedback({ tone: "bad", title: SCAN_RESULT_TEXT.void, detail: `Label ${known.carton_no} · ${known.product}` });
      }
      if (known && (state === "loaded" || queue.current.some((s) => s.barcode === code))) {
        signal(true);
        return setFeedback({ tone: "warn", title: SCAN_RESULT_TEXT.already, detail: `Label ${known.carton_no} · ${known.product}` });
      }
      keep(addPending(queue.current, code, new Date(now).toISOString()));
      if (known) {
        signal(true);
        setFeedback({ tone: "ok", title: `Label ${known.carton_no}`, detail: known.product });
      } else {
        // A label made after this screen opened (a reprint), or not ours: the server decides.
        setFeedback({ tone: "warn", title: "Checking this label", detail: code });
      }
      void flush();
    },
    [flush, keep, status],
  );

  // Scans left on the phone from before (no signal, or the screen was closed): pick them up and send them.
  useEffect(() => {
    const start = window.setTimeout(() => {
      let stored: PendingScan[] = [];
      try {
        stored = readPending(window.localStorage.getItem(pendingKey(dispatchId)));
      } catch {
        stored = [];
      }
      queue.current = stored;
      setWaiting(stored);
      setOnline(navigator.onLine);
      void flush();
    }, 0);
    const up = () => {
      setOnline(true);
      void flush();
    };
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    const timer = window.setInterval(() => void flush(), 15000);
    return () => {
      window.clearTimeout(start);
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
      window.clearInterval(timer);
    };
  }, [dispatchId, flush]);

  // The camera loop.
  const takeRef = useRef(take);
  useEffect(() => {
    takeRef.current = take;
  }, [take]);
  useEffect(() => {
    if (camera !== "starting") return;
    let stop = false;
    let timer = 0;
    (async () => {
      try {
        const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } }, audio: false });
        if (stop) return media.getTracks().forEach((t) => t.stop());
        stream.current = media;
        if (video.current) {
          video.current.srcObject = media;
          await video.current.play();
        }
        const reader = await makeReader();
        setQrOnly(reader.qrOnly);
        setCamera("on");
        const tick = async () => {
          if (stop) return;
          try {
            const value = video.current ? await reader.read(video.current) : null;
            if (value) takeRef.current(value);
          } catch {
            // A frame that could not be read: try the next one.
          }
          timer = window.setTimeout(() => void tick(), 180);
        };
        void tick();
      } catch {
        setCamera("blocked");
      }
    })();
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [camera]);
  useEffect(
    () => () => {
      stream.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  const waitingCodes = new Set(waiting.map((s) => s.barcode));
  let scanned = 0;
  for (const c of cartons) if (status.get(c.barcode) === "loaded" || waitingCodes.has(c.barcode)) scanned += 1;
  const tone = feedback?.tone === "ok" ? "border-ok bg-ok-soft" : feedback?.tone === "warn" ? "border-warn bg-warn-soft" : "border-bad bg-bad-soft";

  return (
    <div className="mx-auto flex max-w-[560px] flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h1 className="t-card-title">Dispatch {number}: scan cartons</h1>
        <Link href={backHref} className={buttonClass("row")}>
          Done
        </Link>
      </div>

      <div className="sp-card p-3" aria-live="polite">
        <p className="t-caption">Cartons scanned</p>
        <p className="t-score mt-1.5 text-[52px]">
          {formatNumber(scanned)}
          <span className="text-[22px] text-muted"> / {formatNumber(planned)}</span>
        </p>
      </div>

      {waiting.length ? (
        <p className="rounded-[12px] border border-warn bg-warn-soft px-3 py-2 text-[15px] font-semibold" role="status">
          {formatNumber(waiting.length)} {waiting.length === 1 ? "scan is" : "scans are"} saved on this phone and waiting to be sent{online ? "." : ": no connection. Keep scanning; they go when the signal is back."}
        </p>
      ) : !online ? (
        <p className="rounded-[12px] border border-warn bg-warn-soft px-3 py-2 text-[15px] font-semibold" role="status">
          No connection. Keep scanning; scans are saved on this phone and sent when the signal is back.
        </p>
      ) : null}

      {closed ? (
        <p className="rounded-[12px] border border-bad bg-bad-soft px-3 py-2 text-[15px] font-semibold" role="alert">
          This dispatch is closed. No more cartons can be scanned on it.
        </p>
      ) : null}

      <div className={`min-h-[76px] rounded-[14px] border-2 px-4 py-3 ${feedback ? tone : "border-line-soft"}`} role="status" aria-live="assertive">
        {feedback ? (
          <>
            <p className="t-card-title">{feedback.title}</p>
            <p className="text-[15px]">{feedback.detail}</p>
          </>
        ) : (
          <p className="t-caption">Point the camera at a label, or type its number. The result of each scan shows here.</p>
        )}
      </div>

      <div className="overflow-hidden rounded-[14px] border border-line bg-black">
        <video ref={video} playsInline muted className={`aspect-[4/3] w-full object-cover ${camera === "on" || camera === "starting" ? "" : "hidden"}`} />
        {camera === "off" || camera === "blocked" ? (
          <div className="flex aspect-[4/3] flex-col items-center justify-center gap-3 bg-surface2 p-4 text-center">
            {camera === "blocked" ? <p className="text-[15px] font-semibold text-bad">The camera could not be opened. Allow camera access for this site in the browser, or type the numbers below.</p> : null}
            <button type="button" onClick={() => setCamera("starting")} className={buttonClass("primary")}>
              {camera === "blocked" ? "Try the camera again" : "Start the camera"}
            </button>
          </div>
        ) : null}
      </div>
      {camera === "on" && qrOnly ? <p className="t-caption">This phone reads the square code on the label (the QR code), not the striped barcode. Point the camera at the square.</p> : null}

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          lastSeen.current = { code: "", at: 0 };
          take(typed);
          setTyped("");
        }}
      >
        <input className="input" inputMode="numeric" autoComplete="off" placeholder="Or type the 16 digits under the barcode" aria-label="Carton barcode number" value={typed} onChange={(e) => setTyped(e.target.value)} />
        <button type="submit" className={buttonClass("secondary")} disabled={!typed.trim()}>
          Add
        </button>
      </form>
    </div>
  );
}
