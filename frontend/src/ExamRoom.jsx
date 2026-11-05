import { useEffect, useRef, useState } from "react";
import { HubConnectionBuilder } from "@microsoft/signalr";
import { api } from "./api";
import { openPublisher } from "./liveDesk";
import { loadWatchers, readPosture } from "./watchPose";
import { HelpGuide } from "./People";

const WARM_SECONDS = 20 * 60;
const HEAVY_SECONDS = 5 * 60;

function phaseFor(seconds, status) {
  if (status !== "in_progress") return "ended";
  if (seconds <= 0) return "ended";
  if (seconds <= HEAVY_SECONDS) return "heavy";
  if (seconds <= WARM_SECONDS) return "warm";
  return "running";
}

function formatClock(seconds) {
  const safe = Math.max(0, seconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const rest = safe % 60;
  const pad = (value) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${pad(minutes)}:${pad(rest)}`;
}

function remainingFrom(sync, nowMs) {
  const ends = new Date(sync.endsAt).getTime();
  const server = new Date(sync.serverNow).getTime();
  const skew = server - sync.receivedAt;
  return Math.max(0, Math.ceil((ends - (nowMs + skew)) / 1000));
}

function cameraBlocked() {
  return !window.isSecureContext || !navigator.mediaDevices?.getUserMedia;
}

async function openCamera() {
  if (cameraBlocked()) {
    const blocked = new Error("The camera is blocked on this address.");
    blocked.name = "SecurityError";
    throw blocked;
  }
  const attempts = [
    { video: { facingMode: "user", width: { ideal: 640 } }, audio: false },
    { video: true, audio: false }
  ];
  let last;
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      last = err;
      if (err?.name === "NotAllowedError" || err?.name === "NotReadableError") throw err;
    }
  }
  throw last ?? new Error("The camera did not start.");
}

function watchBadge(watch) {
  if (/missing|second|turned away|at ear|stopped|did not/i.test(watch)) return "bg-red-500 text-white";
  if (/looking at the paper/i.test(watch)) return "bg-emerald-200 text-emerald-950";
  return "bg-amber-200 text-amber-950";
}

function cameraFailure(err) {
  if (err?.name === "SecurityError") return "This page is http, so the browser will not start the camera. Open the questions to continue.";
  if (err?.name === "NotAllowedError") return "The browser blocked the camera. Allow it in the address bar, then try again.";
  if (err?.name === "NotReadableError") return "The camera is already open in another window. Close that window, then try again.";
  if (err?.name === "NotFoundError") return "This browser cannot find a camera. Connect one, then try again.";
  return "The camera did not start. Close any other window using it, then try again.";
}

function alarm() {
  try {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "square";
    oscillator.frequency.value = 220;
    oscillator.connect(gain);
    gain.connect(context.destination);
    gain.gain.setValueAtTime(0.12, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.7);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.7);
    oscillator.onended = () => context.close();
  } catch {
    // The browser blocked the tone. The warning on screen still stands.
  }
}

function tone(kind) {
  const context = new AudioContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.connect(gain);
  gain.connect(context.destination);
  if (kind === "warm") {
    oscillator.frequency.value = 494;
    gain.gain.value = 0.03;
    oscillator.start();
    oscillator.stop(context.currentTime + 0.22);
  } else {
    oscillator.type = "square";
    oscillator.frequency.value = 311;
    gain.gain.setValueAtTime(0.07, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.45);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.45);
  }
  oscillator.onended = () => context.close();
}

export default function ExamRoom({ sittingId, onLeave }) {
  const [sync, setSync] = useState(null);
  const [remaining, setRemaining] = useState(0);
  const [error, setError] = useState("");
  const [camera, setCamera] = useState("ask");
  const [cameraError, setCameraError] = useState("");
  const [watch, setWatch] = useState("Waiting for the preview.");
  const [models, setModels] = useState("loading");
  const watchersRef = useRef(null);
  const [hand, setHand] = useState("down");
  const [note, setNote] = useState("");
  const [localAlert, setLocalAlert] = useState("");
  const [away, setAway] = useState(false);
  const [lookAway, setLookAway] = useState(false);
  const lookAwayRef = useRef(false);
  const [leaveAsk, setLeaveAsk] = useState(false);
  const [help, setHelp] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [opened, setOpened] = useState(false);
  const awayRef = useRef(false);
  const heard = useRef("running");
  const expiring = useRef(false);
  const streamRef = useRef(null);
  const videoRef = useRef(null);
  const hubRef = useRef(null);
  const reportRef = useRef(() => {});
  const viewerPeers = useRef(new Map());
  const earlyIce = useRef(new Map());
  const pendingOffers = useRef(new Map());
  const answerViewerRef = useRef(() => {});

  async function refresh() {
    const body = await api(`/api/sittings/${sittingId}`);
    setSync({ ...body, receivedAt: Date.now() });
    return body;
  }

  useEffect(() => {
    refresh().catch((err) => setError(err.message));
    const poll = setInterval(() => refresh().catch(() => {}), 4000);
    const connection = new HubConnectionBuilder().withUrl("/hubs/desk").withAutomaticReconnect().build();
    hubRef.current = connection;
    connection.on("expired", () => refresh().catch(() => {}));
    connection.on("handSeen", () => setHand("seen"));
    connection.on("watching", (open) => setOpened(Boolean(open)));
    connection.on("viewerOffer", (viewerId, sdp) => answerViewerRef.current(viewerId, sdp));
    connection.on("viewerIce", (viewerId, raw) => {
      const candidate = JSON.parse(raw);
      const publisher = viewerPeers.current.get(viewerId);
      if (!publisher) {
        const queued = earlyIce.current.get(viewerId) || [];
        queued.push(candidate);
        earlyIce.current.set(viewerId, queued);
        return;
      }
      publisher.addIce(candidate);
    });
    connection.start().then(() => connection.invoke("JoinSitting", sittingId)).catch(() => {});
    return () => {
      clearInterval(poll);
      hubRef.current = null;
      for (const publisher of viewerPeers.current.values()) publisher.close();
      viewerPeers.current.clear();
      connection.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, [sittingId]);

  useEffect(() => {
    if (!sync) return undefined;
    const tick = () => {
      const next = remainingFrom(sync, Date.now());
      setRemaining((current) => current === next ? current : next);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [sync?.endsAt, sync?.serverNow, sync?.receivedAt]);

  const phase = sync ? phaseFor(remaining, sync.status) : "running";

  useEffect(() => {
    if (!sync || sync.status !== "in_progress") return;
    if (phase === heard.current) return;
    if (phase === "warm" || phase === "heavy") tone(phase);
    heard.current = phase;
  }, [phase, sync]);

  useEffect(() => {
    if (!sync || sync.status !== "in_progress" || remaining > 0 || expiring.current) return;
    expiring.current = true;
    api(`/api/sittings/${sittingId}/expire`, { method: "POST" })
      .then((body) => setSync({ ...body, receivedAt: Date.now() }))
      .catch((err) => setError(err.message));
  }, [remaining, sync, sittingId]);

  useEffect(() => {
    const stillAt = {};
    const cameraKinds = new Set(["face-missing", "second-face", "head-away", "hand-ear"]);
    reportRef.current = (kind) => {
      setLocalAlert(kind);
      hubRef.current?.invoke("ReportSignal", sittingId, kind).catch(() => {});
      if (!cameraKinds.has(kind)) return;
      const now = Date.now();
      if (stillAt[kind] && now - stillAt[kind] < 60000) return;
      const video = videoRef.current;
      if (!video || video.videoWidth === 0) return;
      stillAt[kind] = now;
      const width = Math.min(640, video.videoWidth);
      const height = Math.max(1, Math.round(video.videoHeight * (width / video.videoWidth)));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d", { alpha: false })?.drawImage(video, 0, 0, width, height);
      canvas.toBlob((blob) => {
        if (!blob) return;
        fetch(`/api/sittings/${sittingId}/still?kind=${encodeURIComponent(kind)}`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "image/jpeg" },
          body: blob
        }).catch(() => {});
      }, "image/jpeg", 0.7);
    };
  }, [sittingId]);

  useEffect(() => {
    if (sync?.status !== "in_progress") return undefined;
    const markAway = () => {
      if (awayRef.current) return;
      awayRef.current = true;
      setAway(true);
      reportRef.current("window");
      alarm();
    };
    const onHide = () => { if (document.hidden) markAway(); };
    let blurTimer = 0;
    const onBlur = () => {
      window.clearTimeout(blurTimer);
      blurTimer = window.setTimeout(() => {
        if (document.hidden || !document.hasFocus()) markAway();
      }, 200);
    };
    const onBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "You are leaving the exam window. This is recorded. Stay here until you submit.";
    };
    const onCopy = () => reportRef.current("copy");
    const onPaste = () => reportRef.current("paste");
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("blur", onBlur);
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("copy", onCopy);
    document.addEventListener("paste", onPaste);
    return () => {
      window.clearTimeout(blurTimer);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("paste", onPaste);
    };
  }, [sync?.status]);

  useEffect(() => {
    if (sync?.status !== "in_progress") return undefined;
    let alive = true;
    const watchers = loadWatchers();
    watchers.faceReady.then((loaded) => {
      if (!alive) return;
      watchersRef.current = loaded;
      setModels("ready");
    }).catch(() => {
      if (alive) setModels("failed");
    });
    watchers.both.then((loaded) => {
      if (alive) watchersRef.current = loaded;
    }).catch(() => {});
    return () => { alive = false; };
  }, [sync?.status]);

  useEffect(() => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (camera !== "live" || !video || !stream) return undefined;
    video.srcObject = stream;
    let missingSince = 0;
    let secondSince = 0;
    let headSince = 0;
    let earSince = 0;
    const reported = { missing: false, second: false, head: false, ear: false };
    let busy = false;
    let stopped = false;
    if (models === "failed") setWatch("The camera models did not start. The preview is on.");
    else if (models !== "ready") setWatch("Loading face and posture models…");
    else setWatch("Looking for a face");
    const markLook = (next) => {
      if (lookAwayRef.current === next) return;
      lookAwayRef.current = next;
      setLookAway(next);
    };
    const hold = (active, since, reportedKey, limit, signal) => {
      if (!active) {
        reported[reportedKey] = false;
        return 0;
      }
      const started = since || Date.now();
      if (Date.now() - started >= limit && !reported[reportedKey]) {
        reported[reportedKey] = true;
        reportRef.current(signal);
      }
      return started;
    };
    const tick = () => {
      const watchers = watchersRef.current;
      if (stopped || busy || !watchers || video.readyState < 2) return;
      busy = true;
      try {
        const posture = readPosture(watchers, video, performance.now());
        if (!posture) return;
        if (posture.faceCount === 0) {
          secondSince = 0;
          headSince = 0;
          earSince = 0;
          reported.second = false;
          reported.head = false;
          reported.ear = false;
          missingSince = hold(true, missingSince, "missing", 5000, "face-missing");
          if (missingSince && Date.now() - missingSince >= 800) markLook("missing");
          setWatch(missingSince && Date.now() - missingSince >= 5000 ? "Face missing" : "Looking for a face");
        } else if (posture.faceCount > 1) {
          missingSince = 0;
          headSince = 0;
          earSince = 0;
          reported.missing = false;
          reported.head = false;
          reported.ear = false;
          secondSince = hold(true, secondSince, "second", 3000, "second-face");
          markLook(false);
          setWatch(secondSince && Date.now() - secondSince >= 3000 ? "Second face" : "More than one face");
        } else {
          missingSince = 0;
          secondSince = 0;
          reported.missing = false;
          reported.second = false;
          headSince = hold(posture.headAway, headSince, "head", 5000, "head-away");
          earSince = hold(posture.handEar, earSince, "ear", 3000, "hand-ear");
          markLook(posture.headAway && headSince && Date.now() - headSince >= 400 ? "head" : false);
          const headHeld = posture.headAway && headSince && Date.now() - headSince >= 5000;
          const earHeld = posture.handEar && earSince && Date.now() - earSince >= 3000;
          const label = headHeld ? "Head turned away" : earHeld ? "Hand at ear" : posture.headAway ? "Head turning away" : posture.handEar ? "Hand moving to an ear" : "One face, looking at the paper";
          setWatch(label);
        }
      } catch {
        setWatch("Face watch is waiting for the preview.");
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(tick, 500);
    return () => {
      stopped = true;
      clearInterval(timer);
      lookAwayRef.current = false;
      setLookAway(false);
    };
  }, [camera, models]);

  useEffect(() => {
    if (!lookAway || sync?.status !== "in_progress") return undefined;
    const kind = lookAway === "missing" ? "face-missing" : "head-away";
    api(`/api/sittings/${sittingId}/warning`, { method: "POST", body: JSON.stringify({ kind }) }).catch(() => {});
  }, [lookAway, sittingId, sync?.status]);

  useEffect(() => {
    if (!["submitted", "expired", "failed", "awaiting", "marked"].includes(sync?.status)) return undefined;
    api(`/api/sittings/${sittingId}/summary`, { method: "POST" }).catch(() => {});
  }, [sync?.status, sittingId]);

  useEffect(() => {
    if (!lookAway) return undefined;
    const blare = () => {
      alarm();
      const utterance = new SpeechSynthesisUtterance(lookAway === "missing" ? "Face the paper." : "Look at the paper.");
      utterance.rate = 1.05;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    };
    blare();
    const timer = setInterval(blare, 2200);
    return () => {
      clearInterval(timer);
      window.speechSynthesis.cancel();
    };
  }, [lookAway]);

  useEffect(() => {
    if (camera !== "live" || models === "loading") return undefined;
    const canvas = document.createElement("canvas");
    let sending = false;
    let pending = false;
    const send = () => {
      if (sending) {
        pending = true;
        return;
      }
      sending = true;
      canvas.toBlob((blob) => {
        const done = () => {
          sending = false;
          if (pending) {
            pending = false;
            send();
          }
        };
        if (!blob) {
          done();
          return;
        }
        fetch(`/api/sittings/${sittingId}/frame`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "image/jpeg" },
          body: blob
        }).then(done, done);
      }, "image/jpeg", 0.4);
    };
    let timer = 0;
    const begin = window.setTimeout(() => {
      timer = window.setInterval(() => {
        const video = videoRef.current;
        if (!video || video.videoWidth === 0) return;
        const width = 320;
        const height = Math.max(1, Math.round(video.videoHeight * (width / video.videoWidth)));
        if (canvas.width !== width) {
          canvas.width = width;
          canvas.height = height;
        }
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) return;
        context.drawImage(video, 0, 0, width, height);
        send();
      }, 40);
    }, models === "ready" ? 600 : 0);
    return () => {
      window.clearTimeout(begin);
      window.clearInterval(timer);
    };
  }, [camera, models, sittingId]);

  useEffect(() => {
    answerViewerRef.current = (viewerId, sdp) => {
      const stream = streamRef.current;
      const connection = hubRef.current;
      if (camera !== "live" || !stream || !connection) {
        pendingOffers.current.set(viewerId, sdp);
        return;
      }
      viewerPeers.current.get(viewerId)?.close();
      const queued = earlyIce.current.get(viewerId) || [];
      earlyIce.current.delete(viewerId);
      const publisher = openPublisher(connection, sittingId, viewerId, stream, queued);
      viewerPeers.current.set(viewerId, publisher);
      publisher.start(sdp).catch(() => {});
    };
    if (camera === "live") {
      const waiting = [...pendingOffers.current.entries()];
      pendingOffers.current.clear();
      for (const [viewerId, sdp] of waiting) answerViewerRef.current(viewerId, sdp);
    }
  }, [camera, sittingId]);

  async function allowCamera() {
    setCameraError("");
    try {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      const stream = await openCamera();
      stream.getVideoTracks().forEach((track) => {
        track.onended = () => {
          setCamera("lost");
          reportRef.current("camera-interrupted");
        };
      });
      streamRef.current = stream;
      setCamera("live");
    } catch (err) {
      setCameraError(cameraFailure(err));
    }
  }

  async function save(questionId, response) {
    const body = await api(`/api/sittings/${sittingId}/answers`, {
      method: "PUT",
      body: JSON.stringify({ questionId, response })
    });
    setSync({ ...body, receivedAt: Date.now() });
  }

  async function askSubmit() {
    try {
      for (const question of sync.questions) {
        await api(`/api/sittings/${sittingId}/answers`, {
          method: "PUT",
          body: JSON.stringify({ questionId: question.id, response: question.response || "" })
        });
      }
      setConfirm(await api(`/api/sittings/${sittingId}/preview`));
    } catch (err) {
      setError(err.message);
    }
  }

  async function submit() {
    setConfirm(null);
    try {
      const body = await api(`/api/sittings/${sittingId}/submit`, { method: "POST" });
      setSync({ ...body, receivedAt: Date.now() });
    } catch (err) {
      if (err.body?.status) {
        const body = await api(`/api/sittings/${sittingId}`);
        setSync({ ...body, receivedAt: Date.now() });
      }
      setError(err.message);
    }
  }

  async function raiseHand() {
    if (!hubRef.current) throw new Error("The desk is not connected yet.");
    await hubRef.current.invoke("RaiseHand", sittingId, note);
    setHand("up");
  }

  if (!sync) return <p className="grid min-h-screen place-items-center text-stone-500">Opening the paper…</p>;

  if (["expired", "submitted", "failed", "awaiting", "marked"].includes(sync.status)) {
    const heading = sync.status === "expired" ? "No marks"
      : sync.status === "failed" ? `${sync.sectionAScore} / ${sync.sectionAMax}`
      : sync.status === "awaiting" ? `${sync.sectionAScore} / ${sync.sectionAMax}`
      : `${sync.score} / ${sync.maxScore}`;
    const kicker = sync.status === "expired" ? "Time is up"
      : sync.status === "failed" ? "Fail"
      : sync.status === "awaiting" ? "Written answers saved"
      : sync.status === "marked" ? "Marked"
      : "Pass";
    const detail = sync.status === "expired"
      ? `The clock ended during Section A, so that section scores 0 of ${sync.sectionAMax}. The written paper stays closed.`
      : sync.status === "failed"
        ? `${sync.percent}% of Section A. The written paper opens at ${sync.neededPercent}%. Section B stays closed.`
        : sync.status === "awaiting"
          ? `${sync.percent}% opened Section B. The written answers are saved. An examiner will award those marks.`
          : sync.status === "marked"
            ? `Section A ${sync.sectionAScore} of ${sync.sectionAMax}. Section B ${sync.sectionBScore} of ${sync.sectionBMax}.`
            : `${sync.percent}% of Section A. This paper has no written section.`;
    return (
      <section className="grid min-h-screen place-items-center bg-[#fbfbfb] px-6">
        <div className="max-w-lg rounded-3xl bg-white p-8 shadow-xl">
          <p className="text-sm text-stone-500">{kicker}</p>
          <h1 className="mt-2 font-serif text-5xl">{heading}</h1>
          <p className="mt-3 text-stone-600">{detail} The marks are in the email to you.</p>
          <button className="mt-6 rounded-full bg-stone-950 px-5 py-2.5 text-sm font-medium text-stone-50" type="button" onClick={onLeave}>Back to papers</button>
        </div>
      </section>
    );
  }

  const clockTone = phase === "heavy" ? "text-red-700" : phase === "warm" ? "text-amber-700" : "text-stone-950";
  const alertCopy = {
    window: "Recorded: you left the exam window.",
    copy: "Recorded: a copy from this paper.",
    paste: "Recorded: a paste into this paper.",
    "face-missing": "Recorded: the face is missing.",
    "second-face": "Recorded: a second face is in the camera.",
    "head-away": "Recorded: the head stayed turned away.",
    "hand-ear": "Recorded: a hand stayed at an ear.",
    "camera-interrupted": "Recorded: the camera stopped.",
    "camera-off": "Recorded: the camera stayed off."
  };
  const questionsOpen = camera === "live" || camera === "without";

  return (
    <main className="min-h-screen bg-[#fbfbfb] text-stone-900">
      <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-4 border-b border-black/5 border-t-4 border-t-[#3b71ca] bg-white px-5 py-4 shadow-[0_2px_15px_-3px_rgba(0,0,0,0.07)]">
        <div>
          <div className="flex flex-wrap gap-2">
            <button className="rounded-full border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-800 shadow-sm hover:bg-stone-50" type="button" onClick={() => setHelp((open) => !open)}>{help ? "Hide help" : "Help"}</button>
            <button className="rounded-full border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-800 shadow-sm hover:bg-stone-50" type="button" onClick={() => setLeaveAsk(true)}>Leave exam</button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-stone-200 px-2.5 py-0.5 text-xs font-medium text-stone-800">{sync.title}</span>
            <span className="rounded-full bg-amber-200 px-2.5 py-0.5 text-xs font-medium text-amber-950">{sync.stage === "B" ? "Section B · Written" : "Section A · Objectives"}</span>
            {hand === "up" && <span className="rounded-full bg-red-600 px-2.5 py-0.5 text-xs font-medium text-white">Hand up</span>}
            {hand === "seen" && <span className="rounded-full bg-emerald-200 px-2.5 py-0.5 text-xs font-medium text-emerald-950">Hand seen</span>}
            {camera === "without" && <span className="rounded-full bg-amber-200 px-2.5 py-0.5 text-xs font-medium text-amber-950">Camera off</span>}
          </div>
          <div className={`font-serif text-5xl tabular-nums ${clockTone}`}>{formatClock(remaining)}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="rounded-full border border-stone-300 px-3 py-2 text-sm"
            placeholder="Optional note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            disabled={camera !== "live"}
          />
          <button className="rounded-full bg-red-700 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-40" type="button" disabled={camera !== "live" || hand === "up"} onClick={() => raiseHand().catch((err) => setError(err.message))}>Raise hand</button>
          <button className="rounded-full bg-stone-950 px-5 py-2.5 text-sm font-medium text-stone-50 shadow-sm transition hover:bg-stone-800" type="button" onClick={askSubmit}>{sync.stage === "B" ? "Submit written answers" : "Submit section A"}</button>
        </div>
      </div>
      {help && (
        <div className="border-b border-stone-200 bg-[#fbfbfb] px-5 py-6">
          <HelpGuide role="student" />
        </div>
      )}
      {sync.stage === "B" && (
        <div className="bg-emerald-50 px-5 py-3 text-emerald-950" role="status">
          Section A is {sync.sectionAScore} of {sync.sectionAMax} ({sync.percent}%). That is at least 70%, so this written section is open. The system does not mark it.
        </div>
      )}
      {phase === "warm" && (
        <div className="bg-amber-100 px-5 py-3 text-amber-950" role="status">
          <strong>Less than twenty minutes remain.</strong> {sync.stage === "B" ? "Submit the written answers before the clock ends. They are saved for the examiner." : "Submit Section A before the clock ends. An unsubmitted Section A scores nothing."}
        </div>
      )}
      {phase === "heavy" && (
        <div className="bg-red-100 px-5 py-3 text-red-900" role="alert">
          <strong>Less than five minutes remain.</strong> {sync.stage === "B" ? "Submit the written answers now. At zero they are saved for the examiner." : "Submit Section A now. At zero this paper fails and the written section stays closed."}
        </div>
      )}
      {hand === "up" && <div className="bg-red-700 px-5 py-3 text-white" role="status">Your hand is up.</div>}
      {hand === "seen" && <div className="bg-emerald-700 px-5 py-3 text-white" role="status">The invigilator has seen your hand.</div>}
      {opened && <div className="bg-stone-950 px-5 py-3 text-stone-100" role="status">An invigilator has opened your camera.</div>}
      {localAlert && <div className="bg-amber-50 px-5 py-2 text-sm text-amber-950">{alertCopy[localAlert]}</div>}
      {error && <p className="px-5 py-2 text-sm text-red-700">{error}</p>}

      {questionsOpen && camera === "without" && (
        <div className="bg-amber-50 px-5 py-3 text-sm text-amber-950" role="status">The camera is off. This address is not secure, so the browser will not start it. The invigilator has no preview.</div>
      )}
      {!questionsOpen ? (
        <section className="mx-auto mt-10 max-w-xl rounded-3xl bg-white p-8 shadow-xl">
          <p className="text-xs tracking-[0.16em] text-amber-800">CAMERA</p>
          <h1 className="mt-2 font-serif text-4xl">{camera === "lost" ? "The camera stopped" : "Turn the camera on"}</h1>
          <p className="mt-3 text-stone-600">
            This sitting records leaving the window, copy, paste, and this camera. The invigilator sees the preview with your name. The microphone stays off. The questions open when the preview is live.
            {camera === "lost" ? " The clock is still running." : ""}
          </p>
          <p className="mt-3 text-sm text-stone-500">Face and posture models run in this browser. A missing face, a second face, a head turned away, or a hand at an ear is recorded after it holds. The first time each one holds, one still is kept. Short answers of 30 characters or more are compared on the server.</p>
          <p className="mt-3 text-sm font-medium text-stone-800">{models === "ready" ? "Face and posture models are ready." : models === "failed" ? "The camera models did not start. The preview can still go on." : "Loading face and posture models…"}</p>
          {(cameraError || cameraBlocked()) && <p className="mt-3 text-sm text-red-700">{cameraError || "This page is http, so the browser will not start the camera. Open the secure desk, accept the warning, then enter the paper again."}</p>}
          <div className="mt-6 flex flex-wrap gap-2">
            {cameraBlocked() && <a className="rounded-full bg-stone-950 px-5 py-2.5 text-sm font-medium text-stone-50 shadow-sm hover:bg-stone-800" href={`https://${window.location.hostname}:8443/`}>Open the secure desk</a>}
            <button className="rounded-full bg-stone-950 px-5 py-2.5 text-sm font-medium text-stone-50 shadow-sm hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-40" type="button" disabled={cameraBlocked()} onClick={allowCamera}>Allow camera</button>
            <button className="rounded-full border border-stone-300 px-5 py-2.5 text-sm font-medium text-stone-800 hover:bg-stone-50" type="button" onClick={() => { setCamera("without"); reportRef.current("camera-off"); }}>Open the questions</button>
          </div>
        </section>
      ) : (
        <div className="mx-auto max-w-3xl px-5 py-6">
          {sync.questions.map((question, index) => (
            <article className="mb-4 rounded-3xl bg-white p-5 shadow-sm" key={question.id}>
              <h2 className="font-serif text-2xl">{index + 1}. {question.prompt}</h2>
              <p className="mt-1 text-sm text-stone-500">{question.marks} mark{question.marks === 1 ? "" : "s"}</p>
              {question.type === "mcq" ? (
                <div className="mt-3 space-y-2">
                  {question.options.map((option, optionIndex) => {
                    const letter = String.fromCharCode(65 + optionIndex);
                    return (
                      <label className="flex items-center gap-3 rounded-2xl border border-stone-200 px-3 py-2" key={letter}>
                        <input
                          type="radio"
                          name={`q-${question.id}`}
                          checked={question.response === letter}
                          onChange={() => save(question.id, letter).catch((err) => setError(err.message))}
                        />
                        <span>{letter}. {option}</span>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <textarea
                  className="mt-3 w-full rounded-2xl border border-stone-300 px-3 py-2"
                  value={question.response}
                  onChange={(event) => {
                    const response = event.target.value;
                    setSync({
                      ...sync,
                      questions: sync.questions.map((item) => item.id === question.id ? { ...item, response } : item)
                    });
                  }}
                  onBlur={(event) => save(question.id, event.target.value).catch((err) => setError(err.message))}
                />
              )}
            </article>
          ))}
        </div>
      )}

      {lookAway && (
        <div className="pointer-events-none fixed inset-0 z-40 grid place-items-center bg-red-700 px-6 text-center text-white" role="alert">
          <div>
            <p className="text-sm font-medium tracking-[0.22em]">NOT LOOKING AT THE PAPER</p>
            <h2 className="mt-3 font-serif text-6xl leading-none">Look at the paper</h2>
            <p className="mx-auto mt-4 max-w-xl text-xl">
              {lookAway === "missing"
                ? "Your face is out of the camera. This is being recorded. The warning stops when your face is back."
                : "Your head is turned away. This is being recorded. The warning stops when you look back at the screen."}
            </p>
          </div>
        </div>
      )}
      {away && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-red-950/90 px-6" role="alertdialog" aria-modal="true" aria-labelledby="away-title">
          <div className="w-full max-w-lg rounded-3xl bg-white p-8 shadow-2xl">
            <p className="text-xs font-medium tracking-[0.16em] text-red-700">EXAM WINDOW</p>
            <h2 id="away-title" className="mt-2 font-serif text-4xl text-red-800">You left this window</h2>
            <p className="mt-3 text-stone-700">This is recorded. The invigilator can see that you left the exam. Stay in this window until you submit. The clock is still running, and an unsubmitted paper scores nothing.</p>
            <button
              className="mt-6 w-full rounded-full bg-red-700 px-5 py-3 text-sm font-medium text-white hover:bg-red-800"
              type="button"
              onClick={() => {
                awayRef.current = false;
                setAway(false);
              }}
            >
              I am back. Continue the exam
            </button>
          </div>
        </div>
      )}
      {confirm && (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-black/50 px-6" role="alertdialog" aria-modal="true" aria-labelledby="end-title">
          <div className="w-full max-w-lg rounded-lg bg-white p-8 shadow-[0_2px_15px_-3px_rgba(0,0,0,0.07),0_10px_20px_-2px_rgba(0,0,0,0.04)]">
            <p className={`text-xs font-medium tracking-[0.16em] ${confirm.stage === "A" && (!confirm.passed || confirm.unanswered > 0) ? "text-[#dc4c64]" : "text-[#e4a11b]"}`}>
              {confirm.stage === "B" ? "END THE EXAM" : "END SECTION A"}
            </p>
            <h2 id="end-title" className="mt-2 text-3xl font-medium text-[#332d2d]">
              {confirm.stage === "B" ? "You are about to end this exam" : "You are about to end the objectives"}
            </h2>
            {confirm.stage === "B" ? (
              <>
                <p className="mt-3 text-[#4f4f4f]">The written answers are saved for an examiner. The system does not mark them, and you cannot change them after this.</p>
                {confirm.unanswered > 0 && <p className="mt-3 font-medium text-[#dc4c64]">{confirm.unanswered} of {confirm.questionCount} written questions have no answer. An empty answer can only be awarded 0.</p>}
              </>
            ) : (
              <>
                <p className="mt-3 text-[#4f4f4f]">This ends Section A. You cannot change these answers afterwards.</p>
                {confirm.unanswered > 0 && <p className="mt-3 font-medium text-[#dc4c64]">{confirm.unanswered} of {confirm.questionCount} objectives have no answer. A blank scores 0.</p>}
                {!confirm.passed && <p className="mt-3 font-medium text-[#dc4c64]">The answers saved so far are {confirm.sectionAScore} of {confirm.sectionAMax} ({confirm.percent}%). That is below 70%, so the result is Fail and the written paper stays closed.</p>}
                {confirm.passed && confirm.unanswered === 0 && <p className="mt-3 text-[#4f4f4f]">Every objective has an answer, and these answers reach 70%. Ending Section A opens the written paper.</p>}
                {confirm.passed && confirm.unanswered > 0 && <p className="mt-3 text-[#4f4f4f]">The answered ones are {confirm.sectionAScore} of {confirm.sectionAMax} ({confirm.percent}%), which still reaches 70%. A blank you fill could change that.</p>}
              </>
            )}
            <div className="mt-6 flex flex-wrap gap-2">
              <button className="rounded bg-[#3b71ca] px-5 py-2.5 text-xs font-medium uppercase tracking-wider text-white" type="button" onClick={() => setConfirm(null)}>Go back</button>
              <button className="rounded border-2 border-[#dc4c64] px-5 py-2.5 text-xs font-medium uppercase tracking-wider text-[#dc4c64] hover:bg-[#dc4c64] hover:text-white" type="button" onClick={submit}>{confirm.stage === "B" ? "End the exam" : "End Section A"}</button>
            </div>
          </div>
        </div>
      )}
      {leaveAsk && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-stone-950/70 px-6" role="alertdialog" aria-modal="true" aria-labelledby="leave-title">
          <div className="w-full max-w-lg rounded-3xl bg-white p-8 shadow-2xl">
            <h2 id="leave-title" className="font-serif text-4xl">Leave this exam?</h2>
            <p className="mt-3 text-stone-700">The clock keeps running. Leaving the window is recorded, and a paper that is still open when the clock ends scores nothing.</p>
            <div className="mt-6 flex flex-wrap gap-2">
              <button className="rounded-full bg-stone-950 px-5 py-2.5 text-sm font-medium text-stone-50 hover:bg-stone-800" type="button" onClick={() => setLeaveAsk(false)}>Stay on the paper</button>
              <button className="rounded-full border border-red-300 px-5 py-2.5 text-sm font-medium text-red-800 hover:bg-red-50" type="button" onClick={onLeave}>Leave anyway</button>
            </div>
          </div>
        </div>
      )}

      {camera === "live" && (
        <div className="fixed bottom-4 right-4 w-64 overflow-hidden rounded-3xl bg-stone-950 shadow-2xl">
          <div className="relative">
            <video ref={videoRef} autoPlay muted playsInline className="aspect-video w-full object-cover" />
            <div className="absolute left-2 top-2 flex flex-wrap gap-1">
              <span className="rounded-full bg-emerald-200 px-2.5 py-0.5 text-[11px] font-medium text-emerald-950">On the desk</span>
            </div>
            <div className="absolute bottom-2 left-2 right-2">
              <span className={`inline-flex max-w-full rounded-full px-2.5 py-0.5 text-[11px] font-medium ${watchBadge(watch)}`}>{watch}</span>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
