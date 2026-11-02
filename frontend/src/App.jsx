import { useEffect, useRef, useState } from "react";
import { HubConnectionBuilder } from "@microsoft/signalr";
import DataTable from "datatables.net-dt";
import "datatables.net-dt/css/dataTables.dataTables.css";
import { api } from "./api";
import ExamRoom from "./ExamRoom";
import { openViewer } from "./liveDesk";
import { CheckBanners, JoinWizard, SearchSelect, SystemAdmin, pill, roleLabel, useExamChecks } from "./People";

const blankQuestion = () => ({ type: "mcq", prompt: "", a: "", b: "", c: "", d: "", answer: "A", marks: 1 });
const field = "mt-1 w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 outline-none transition focus:border-stone-900 focus:ring-2 focus:ring-stone-900/10";
const primary = "inline-flex items-center justify-center gap-2 rounded-full bg-stone-950 px-5 py-2.5 text-sm font-medium text-stone-50 shadow-sm transition hover:bg-stone-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-950 disabled:cursor-not-allowed disabled:bg-stone-300 disabled:text-stone-500";
const ghost = "inline-flex items-center justify-center gap-2 rounded-full border border-stone-300 bg-white px-5 py-2.5 text-sm font-medium text-stone-800 shadow-sm transition hover:border-stone-400 hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-400 disabled:cursor-not-allowed disabled:opacity-50";

export default function App() {
  const [me, setMe] = useState(undefined);
  const [sittingId, setSittingId] = useState(null);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    api("/api/me").then(setMe).catch(() => setMe(null));
  }, []);

  if (me === undefined) {
    return <p className="grid min-h-screen place-items-center text-stone-500">Loading…</p>;
  }
  if (!me && joining) return <JoinWizard onDone={setMe} onBack={() => setJoining(false)} />;
  if (!me) return <Login onDone={setMe} onJoin={() => setJoining(true)} />;
  if (sittingId) return <ExamRoom sittingId={sittingId} onLeave={() => setSittingId(null)} />;
  if (me.role === "systemadmin") return <SystemAdmin me={me} onLogout={() => logout(setMe, setSittingId)} />;
  if (me.role === "invigilator") {
    return <Invigilator me={me} onLogout={() => logout(setMe, setSittingId)} />;
  }
  if (me.role === "teacher" || me.role === "superadmin") {
    return <Teacher me={me} onLogout={() => logout(setMe, setSittingId)} />;
  }
  return <Student me={me} onStart={setSittingId} onLogout={() => logout(setMe, setSittingId)} />;
}

function Desk({ me, onLogout, nav, alerts, note, children }) {
  return (
    <div className="min-h-screen bg-stone-100 text-stone-900 md:grid md:grid-cols-[260px_1fr]">
      <aside className="flex flex-col gap-6 bg-stone-950 px-4 py-5 text-stone-100 md:sticky md:top-0 md:h-screen">
        <div>
          <p className="text-xs tracking-[0.22em] text-amber-200">RMS</p>
          <strong className="mt-3 block font-serif text-2xl font-medium">{me.fullName}</strong>
          <em className="mt-1 block text-sm text-stone-400 not-italic">{roleLabel(me.role)}</em>
        </div>
        <nav className="flex flex-col gap-1">{nav}</nav>
        <p className="mt-auto text-xs leading-5 text-stone-400">
          {note || "Face and posture run in the exam page. Short answers of 30 characters or more are compared on this server. A raised hand is still a button, not a camera gesture."}
        </p>
        <button className="rounded-full border border-white/15 px-4 py-2 text-sm text-stone-200 hover:bg-white/10" type="button" onClick={onLogout}>Sign out</button>
      </aside>
      <main className="min-w-0 px-5 py-6 md:px-8 md:py-8">
        {alerts}
        {children}
      </main>
    </div>
  );
}

function NavButton({ active, onClick, children }) {
  return (
    <button
      className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm ${active ? "bg-white text-stone-950" : "text-stone-200 hover:bg-white/10"}`}
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

async function logout(setMe, setSittingId) {
  await api("/api/logout", { method: "POST" });
  setSittingId(null);
  setMe(null);
}

function Login({ onDone, onJoin }) {
  const [email, setEmail] = useState("leila.nansubuga@rms.local");
  const [password, setPassword] = useState("Harbor-Teach-19");
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    try {
      onDone(await api("/api/login", { method: "POST", body: JSON.stringify({ email, password }) }));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="min-h-screen bg-stone-100 lg:grid lg:grid-cols-2">
      <section className="flex flex-col justify-between bg-stone-950 px-8 py-10 text-stone-100">
        <p className="text-xs tracking-[0.22em] text-amber-200">RMS</p>
        <div className="max-w-md">
          <h1 className="font-serif text-5xl font-medium leading-tight">The exam desk</h1>
          <p className="mt-4 text-stone-300">Each paper keeps its own clock. The camera asks before it starts. A raised hand shows up here as an alert.</p>
        </div>
        <p className="text-sm text-stone-500">Twenty minutes left is a warm warning. Five minutes left is heavy. At zero, an unsubmitted paper scores nothing.</p>
      </section>
      <section className="flex items-center justify-center px-6 py-12">
        <form className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl shadow-stone-200" onSubmit={submit}>
          <h2 className="font-serif text-3xl">Sign in</h2>
          <label className="mt-5 block text-sm">Email<input className={field} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label className="mt-4 block text-sm">Password<input className={field} type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
          <button className={`${primary} mt-5 w-full`} type="submit">Sign in</button>
          <button className={`${ghost} mt-3 w-full`} type="button" onClick={onJoin}>I have an invitation</button>
          <div className="mt-5 space-y-1 text-xs text-stone-500">
            <div>Teacher: leila.nansubuga@rms.local / Harbor-Teach-19</div>
            <div>Student: jamal.ssebunya@rms.local / Harbor-Study-19</div>
            <div>Invigilator: samuel.kato@rms.local / Harbor-Watch-19</div>
            <div>Manager: ada.okello@rms.local / Harbor-Admin-19</div>
            <div>System admin: system.admin@rms.local / Harbor-System-19</div>
          </div>
        </form>
      </section>
    </main>
  );
}

function useStaffDesk() {
  const [hands, setHands] = useState([]);
  const [signals, setSignals] = useState([]);
  const [sound, setSound] = useState(false);
  const [ready, setReady] = useState(false);
  const hub = useRef(null);
  const audio = useRef(null);

  useEffect(() => {
    const connection = new HubConnectionBuilder().withUrl("/hubs/desk").withAutomaticReconnect().build();
    hub.current = connection;
    connection.on("hand", (call) => setHands((current) => [call, ...current.filter((item) => item.sittingId !== call.sittingId)]));
    connection.on("handClear", (sittingId) => setHands((current) => current.filter((item) => item.sittingId !== sittingId)));
    connection.on("signal", (signal) => setSignals((current) => [signal, ...current].slice(0, 12)));
    let alive = true;
    connection.start()
      .then(() => connection.invoke("JoinStaff"))
      .then(() => connection.invoke("OpenHands"))
      .then((rows) => {
        if (!alive) return;
        setReady(true);
        setHands((current) => {
          const byId = new Map(current.map((item) => [item.sittingId, item]));
          for (const row of rows || []) byId.set(row.sittingId, row);
          return [...byId.values()];
        });
      })
      .catch(() => {});
    return () => {
      alive = false;
      hub.current = null;
      connection.stop();
    };
  }, []);

  useEffect(() => {
    if (!sound || hands.length === 0) return undefined;
    const blare = () => {
      const context = audio.current;
      if (context) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "square";
        oscillator.frequency.value = 880;
        gain.gain.value = 0.05;
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start();
        oscillator.stop(context.currentTime + 0.18);
      }
      const utterance = new SpeechSynthesisUtterance("Hand up. A candidate needs help.");
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    };
    blare();
    const timer = setInterval(blare, 4000);
    return () => {
      clearInterval(timer);
      window.speechSynthesis.cancel();
    };
  }, [sound, hands.length]);

  function enableSound() {
    const context = audio.current || new AudioContext();
    audio.current = context;
    context.resume();
    setSound(true);
  }

  async function acknowledge(sittingId) {
    await hub.current?.invoke("AcknowledgeHand", sittingId);
  }

  return { hands, signals, sound, ready, hub, enableSound, acknowledge };
}

function StaffAlerts({ desk, quiet }) {
  if (quiet && desk.hands.length === 0 && desk.signals.length === 0) return null;
  return (
    <div className="mb-5 space-y-3">
      {!quiet && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-stone-200 bg-white px-4 py-3">
          <p className="text-sm text-stone-600">Hand-up alerts land here. Turn the sound on once so the shout can play.</p>
          <button className={desk.sound ? ghost : primary} type="button" onClick={desk.enableSound}>{desk.sound ? "Alert sound on" : "Turn alert sound on"}</button>
        </div>
      )}
      {desk.hands.map((hand) => (
        <div key={hand.sittingId} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-red-700 px-4 py-3 text-white" role="alert">
          <p>
            <strong>Hand up.</strong> {hand.studentName} needs help on {hand.paper}.
            {hand.note ? ` ${hand.note}` : ""}
          </p>
          <button className="rounded-full bg-white px-4 py-2 text-sm font-medium text-red-800" type="button" onClick={() => desk.acknowledge(hand.sittingId)}>Seen</button>
        </div>
      ))}
      {desk.signals.length > 0 && (
        <ul className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          {desk.signals.map((signal) => (
            <li key={`${signal.sittingId}-${signal.kind}-${signal.at}`}>{signal.studentName} · {signal.paper} · {signal.detail}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function useToasts() {
  const [toasts, setToasts] = useState([]);
  const push = (toast) => {
    const id = crypto.randomUUID();
    setToasts((current) => [...current, { id, ...toast }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 5600);
  };
  const dismiss = (id) => setToasts((current) => current.filter((item) => item.id !== id));
  return { toasts, push, dismiss };
}

function Toaster({ toasts, onDismiss }) {
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed right-4 top-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast-in pointer-events-auto flex items-start gap-3 rounded-2xl px-4 py-3 text-white shadow-2xl ${toast.tone === "error" ? "bg-red-700" : "bg-stone-950"}`}
          role={toast.tone === "error" ? "alert" : "status"}
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{toast.title}</p>
            {toast.body && <p className="mt-1 text-sm text-white/80">{toast.body}</p>}
          </div>
          <button className="rounded-full px-2 py-1 text-xs text-white/80 hover:bg-white/10 hover:text-white" type="button" onClick={() => onDismiss(toast.id)}>Close</button>
        </div>
      ))}
    </div>
  );
}

function ExamFileDrop({ file, onFile }) {
  const [over, setOver] = useState(false);
  const inputRef = useRef(null);

  function take(next) {
    if (!next) return;
    const name = next.name.toLowerCase();
    const allowed = name.endsWith(".xlsx") || name.endsWith(".docx") || name.endsWith(".csv");
    if (!allowed) {
      onFile(null, "Choose an Excel workbook (.xlsx), a Word document (.docx), or a CSV file.");
      return;
    }
    if (next.size > 5 * 1024 * 1024) {
      onFile(null, "That file is larger than 5 MB.");
      return;
    }
    onFile(next, "");
  }

  return (
    <div
      className={`rounded-3xl border-2 border-dashed px-6 py-10 text-center transition ${over ? "border-amber-500 bg-amber-50" : file ? "border-emerald-500 bg-emerald-50" : "border-stone-300 bg-stone-50 hover:border-stone-500 hover:bg-white"}`}
      onDragEnter={(event) => { event.preventDefault(); setOver(true); }}
      onDragOver={(event) => { event.preventDefault(); setOver(true); }}
      onDragLeave={(event) => { event.preventDefault(); setOver(false); }}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        take(event.dataTransfer.files?.[0]);
      }}
    >
      <input
        ref={inputRef}
        className="sr-only"
        type="file"
        accept=".xlsx,.docx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/csv"
        onChange={(event) => {
          take(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <p className="text-xs font-medium tracking-[0.16em] text-stone-500">{file ? "FILE READY" : "DROP THE PAPER"}</p>
      <p className="mt-2 font-serif text-3xl">{file ? file.name : "Excel, Word, or CSV"}</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-stone-500">
        {file ? `${Math.max(1, Math.round(file.size / 1024))} KB ready to upload.` : "Drag the file here, or browse. The questions and answers are read from the file. Nothing is typed on this page."}
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        <button className={primary} type="button" onClick={() => inputRef.current?.click()}>{file ? "Choose a different file" : "Browse files"}</button>
        {file && <button className={ghost} type="button" onClick={() => onFile(null, "")}>Remove file</button>}
      </div>
    </div>
  );
}

function WriteExam({ onSaved, onError }) {
  const [title, setTitle] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("");
  const [questions, setQuestions] = useState([blankQuestion()]);
  const [saving, setSaving] = useState(false);

  async function create(event) {
    event.preventDefault();
    const filled = questions.filter((question) => question.prompt.trim());
    if (filled.length === 0) {
      onError("Write at least one question before saving.");
      return;
    }
    setSaving(true);
    try {
      await api("/api/assessments", {
        method: "POST",
        body: JSON.stringify({
          title,
          durationMinutes: Number(durationMinutes),
          csv: null,
          questions: filled.map((question) => ({
            type: "mcq",
            prompt: question.prompt,
            options: [question.a, question.b, question.c, question.d],
            answer: question.answer,
            marks: Number(question.marks) || 1
          }))
        })
      });
      setTitle("");
      setDurationMinutes("");
      setQuestions([blankQuestion()]);
      onSaved(title);
    } catch (err) {
      onError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium tracking-[0.16em] text-amber-800">WRITE</p>
          <h1 className="mt-1 font-serif text-4xl">Write an exam</h1>
          <p className="mt-1 max-w-2xl text-stone-500">Type each question here. A file upload is a separate page, so this paper is only what you enter.</p>
        </div>
      </header>
      <form className="max-w-3xl rounded-3xl bg-white p-6 shadow-sm" onSubmit={create}>
        <div className="grid gap-4 sm:grid-cols-[1fr_11rem]">
          <label className="text-sm font-medium">Paper title<input className={field} value={title} onChange={(event) => setTitle(event.target.value)} required /></label>
          <label className="text-sm font-medium">Minutes<input className={field} type="number" min="1" max="300" value={durationMinutes} onChange={(event) => setDurationMinutes(event.target.value)} required /></label>
        </div>
        {questions.map((question, index) => (
          <fieldset className="mt-4 rounded-2xl border border-stone-200 p-4" key={index}>
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium">Question {index + 1}</p>
              {questions.length > 1 && (
                <button className="text-sm font-medium text-red-700 hover:underline" type="button" onClick={() => setQuestions(questions.filter((_, item) => item !== index))}>Remove</button>
              )}
            </div>
            <label className="mt-3 block text-sm">Prompt<input className={field} value={question.prompt} onChange={(event) => update(setQuestions, index, { prompt: event.target.value })} required /></label>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-sm">A<input className={field} value={question.a} onChange={(event) => update(setQuestions, index, { a: event.target.value })} required /></label>
              <label className="text-sm">B<input className={field} value={question.b} onChange={(event) => update(setQuestions, index, { b: event.target.value })} required /></label>
              <label className="text-sm">C<input className={field} value={question.c} onChange={(event) => update(setQuestions, index, { c: event.target.value })} required /></label>
              <label className="text-sm">D<input className={field} value={question.d} onChange={(event) => update(setQuestions, index, { d: event.target.value })} required /></label>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-sm">Correct letter
                <select className={field} value={question.answer} onChange={(event) => update(setQuestions, index, { answer: event.target.value })}>
                  <option>A</option><option>B</option><option>C</option><option>D</option>
                </select>
              </label>
              <label className="text-sm">Marks<input className={field} type="number" min="1" max="100" value={question.marks} onChange={(event) => update(setQuestions, index, { marks: event.target.value })} /></label>
            </div>
          </fieldset>
        ))}
        <div className="mt-5 flex flex-wrap gap-2">
          <button className={ghost} type="button" onClick={() => setQuestions([...questions, blankQuestion()])}>Add question</button>
          <button className={primary} type="submit" disabled={saving}>{saving ? "Saving…" : "Save exam"}</button>
        </div>
      </form>
    </>
  );
}

function UploadExam({ onSaved, onError }) {
  const [title, setTitle] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("");
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);

  async function create(event) {
    event.preventDefault();
    if (!file) {
      onError("Choose an Excel, Word, or CSV file first.");
      return;
    }
    setSaving(true);
    try {
      const data = new FormData();
      data.append("title", title);
      data.append("durationMinutes", String(durationMinutes));
      data.append("file", file);
      const response = await fetch("/api/assessments/file", { method: "POST", credentials: "include", body: data });
      const uploaded = await response.json().catch(() => null);
      if (!response.ok) throw new Error(uploaded?.error || "The file could not be read.");
      setTitle("");
      setDurationMinutes("");
      setFile(null);
      onSaved(title, uploaded?.questionCount);
    } catch (err) {
      onError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <header className="mb-6">
        <p className="text-xs font-medium tracking-[0.16em] text-amber-800">UPLOAD</p>
        <h1 className="mt-1 font-serif text-4xl">Upload an exam</h1>
        <p className="mt-1 max-w-2xl text-stone-500">The questions and answers come from the file. Writing a paper by hand is a separate page.</p>
      </header>
      <form className="max-w-3xl space-y-4" onSubmit={create}>
        <div className="grid gap-4 rounded-3xl bg-white p-6 shadow-sm sm:grid-cols-[1fr_11rem]">
          <label className="text-sm font-medium">Paper title<input className={field} value={title} onChange={(event) => setTitle(event.target.value)} required /></label>
          <label className="text-sm font-medium">Minutes<input className={field} type="number" min="1" max="300" value={durationMinutes} onChange={(event) => setDurationMinutes(event.target.value)} required /></label>
        </div>
        <ExamFileDrop file={file} onFile={(next, problem) => { setFile(next); if (problem) onError(problem); }} />
        <div className="grid gap-3 sm:grid-cols-2">
          <article className="rounded-3xl border border-stone-200 bg-white p-5">
            <h2 className="font-serif text-2xl">Excel or CSV</h2>
            <p className="mt-2 text-sm leading-6 text-stone-600">Header row: prompt, a, b, c, d, answer, marks. The answer is A, B, C, or D. Leave a–d empty and put the model answer in answer for a short question.</p>
          </article>
          <article className="rounded-3xl border border-stone-200 bg-white p-5">
            <h2 className="font-serif text-2xl">Word</h2>
            <p className="mt-2 text-sm leading-6 text-stone-600">Use that same table, or a list: the question, then A. to D., then Answer: and Marks:. A short question is the prompt, then Answer: and Marks:.</p>
          </article>
        </div>
        <button className={primary} type="submit" disabled={saving || !file}>{saving ? "Uploading…" : "Upload exam"}</button>
      </form>
    </>
  );
}

function Teacher({ me, onLogout }) {
  const [page, setPage] = useState("wall");
  const [papers, setPapers] = useState([]);
  const [counts, setCounts] = useState({ undertaking: 0, submitted: 0 });
  const toasts = useToasts();
  const desk = useStaffDesk();
  const examChecks = useExamChecks(desk);

  async function load() {
    const [nextPapers, summary] = await Promise.all([
      api("/api/assessments"),
      api("/api/sittings?status=submitted&draw=1&start=0&length=1")
    ]);
    setPapers(nextPapers);
    setCounts({ undertaking: summary.undertakingTotal, submitted: summary.submittedTotal });
  }

  useEffect(() => {
    load().catch((err) => toasts.push({ tone: "error", title: "The desk did not load", body: err.message }));
  }, []);

  function saved(title, questionCount) {
    toasts.push({
      tone: "success",
      title: "Exam saved",
      body: questionCount ? `${title} is on the desk with ${questionCount} question${questionCount === 1 ? "" : "s"}.` : `${title} is on the desk with its own clock.`
    });
    setPage("papers");
    load().catch((err) => toasts.push({ tone: "error", title: "The list did not refresh", body: err.message }));
  }

  const nav = (
    <>
      <NavButton active={page === "wall"} onClick={() => setPage("wall")}>Streams</NavButton>
      <NavButton active={page === "papers"} onClick={() => setPage("papers")}>Exams</NavButton>
      <NavButton active={page === "undertaking"} onClick={() => setPage("undertaking")}>
        Undertaking <em className="rounded-full bg-amber-200 px-2 py-0.5 text-xs text-stone-950 not-italic">{counts.undertaking}</em>
      </NavButton>
      <NavButton active={page === "submitted"} onClick={() => setPage("submitted")}>
        Submitted <em className="rounded-full bg-emerald-200 px-2 py-0.5 text-xs text-stone-950 not-italic">{counts.submitted}</em>
      </NavButton>
      <NavButton active={page === "write"} onClick={() => setPage("write")}>Write exam</NavButton>
      <NavButton active={page === "upload"} onClick={() => setPage("upload")}>Upload exam</NavButton>
      <NavButton active={page === "summary"} onClick={() => setPage("summary")}>
        Summary {examChecks.checks.length > 0 && <em className="rounded-full bg-red-500 px-2 py-0.5 text-xs text-white not-italic">{examChecks.checks.length}</em>}
      </NavButton>
      {me.role === "superadmin" && <NavButton active={page === "assign"} onClick={() => setPage("assign")}>Assign</NavButton>}
    </>
  );

  const alerts = page === "wall" ? <StaffAlerts desk={desk} quiet /> : <StaffAlerts desk={desk} />;

  const body = page === "summary" ? (
    <SummaryDesk />
  ) : page === "assign" ? (
    <AssignDesk />
  ) : page === "wall" ? (
    <LiveWall desk={desk} empty="No candidate is in a paper right now." />
  ) : page === "papers" ? (
    <>
      <header className="mb-6">
        <h1 className="font-serif text-4xl">Exams</h1>
        <p className="mt-1 text-stone-500">{papers.length} paper{papers.length === 1 ? "" : "s"} on the desk.</p>
      </header>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {papers.map((paper) => (
          <article className="flex flex-col justify-between rounded-3xl border border-stone-200 bg-white p-5 shadow-sm" key={paper.id}>
            <div>
              <span className={`rounded-full px-2 py-1 text-xs font-medium ${paper.invigilating ? "bg-red-100 text-red-900" : "bg-emerald-100 text-emerald-900"}`}>{paper.invigilating ? "You invigilate this paper" : "Ready"}</span>
              <h2 className="mt-3 font-serif text-2xl">{paper.title}</h2>
              <p className="mt-1 text-sm text-stone-500">{paper.questionCount} question{paper.questionCount === 1 ? "" : "s"} · {paper.maxScore} mark{paper.maxScore === 1 ? "" : "s"}</p>
            </div>
            <p className="mt-6 text-lg font-medium">{paper.durationMinutes} min</p>
          </article>
        ))}
      </div>
      {papers.length === 0 && (
        <div className="rounded-3xl border border-dashed border-stone-300 bg-white p-8">
          <p className="font-serif text-2xl">No exam yet</p>
          <p className="mt-2 text-sm text-stone-500">Write the questions yourself, or upload an Excel, Word, or CSV file.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button className={primary} type="button" onClick={() => setPage("write")}>Write exam</button>
            <button className={ghost} type="button" onClick={() => setPage("upload")}>Upload exam</button>
          </div>
        </div>
      )}
    </>
  ) : page === "undertaking" || page === "submitted" ? (
    <SittingPage
      key={page}
      status={page === "undertaking" ? "in_progress" : "submitted"}
      title={page === "undertaking" ? "Undertaking" : "Submitted"}
      onOpen={setPage}
      onCounts={setCounts}
    />
  ) : page === "upload" ? (
    <UploadExam onSaved={saved} onError={(message) => toasts.push({ tone: "error", title: "Upload stopped", body: message })} />
  ) : (
    <WriteExam onSaved={saved} onError={(message) => toasts.push({ tone: "error", title: "Exam not saved", body: message })} />
  );

  return (
    <Desk me={me} onLogout={onLogout} nav={nav} alerts={alerts}>
      <CheckBanners checks={examChecks.checks} sound={desk.sound} onSound={desk.enableSound} onSeen={examChecks.seen} onOpen={() => setPage("summary")} />
      {body}
      <Toaster toasts={toasts.toasts} onDismiss={toasts.dismiss} />
    </Desk>
  );
}

function SittingPage({ status, title, onOpen, onCounts }) {
  const hostRef = useRef(null);
  const onCountsRef = useRef(onCounts);
  onCountsRef.current = onCounts;
  const other = status === "in_progress" ? "submitted" : "undertaking";

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const table = document.createElement("table");
    table.className = "display";
    table.style.width = "100%";
    table.innerHTML = `<thead><tr><th>Student</th><th>Email</th><th>Paper</th><th>${status === "in_progress" ? "Time left" : "Marks"}</th></tr></thead>`;
    host.appendChild(table);
    let dt;
    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      if (cancelled) return;
      dt = new DataTable(table, {
        serverSide: true,
        processing: false,
        autoWidth: false,
        pageLength: 8,
        lengthMenu: [8, 10, 25, 50],
        order: [[0, "asc"]],
        ajax: {
          url: "/api/sittings",
          data: (params) => { params.status = status; },
          dataSrc: (json) => {
            onCountsRef.current({ undertaking: json.undertakingTotal, submitted: json.submittedTotal });
            return json.data;
          }
        },
        columns: [
          { data: "studentName", title: "Student" },
          { data: "email", title: "Email" },
          { data: "paper", title: "Paper" },
          {
            data: null,
            title: status === "in_progress" ? "Time left" : "Marks",
            render: (_data, type, row) => {
              if (status === "in_progress") {
                const label = `${formatRemaining(row.remainingSeconds)} left`;
                return type === "display" ? pill(label, "amber") : row.remainingSeconds;
              }
              const label = `${row.score} / ${row.maxScore}`;
              return type === "display" ? pill(label, row.score > 0 ? "emerald" : "stone") : row.score;
            }
          }
        ],
        language: {
          search: "Search:",
          lengthMenu: "Show _MENU_",
          info: "Showing _START_ to _END_ of _TOTAL_",
          emptyTable: status === "in_progress" ? "No one is in a paper." : "No paper has been submitted.",
          zeroRecords: "No matches."
        }
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      try { dt?.destroy(); } catch { /* React already removed the page. */ }
      host.replaceChildren();
    };
  }, [status]);

  return (
    <>
      <header className="mb-4">
        <h1 className="font-serif text-4xl">{title}</h1>
        <p className="mt-1 text-stone-500">
          {status === "in_progress" ? "Candidates in a paper right now." : "Candidates who have handed a paper in."}
          {" "}
          <button className="text-sm font-medium text-amber-800 underline" type="button" onClick={() => onOpen(other)}>{other === "submitted" ? "Submitted list" : "Undertaking list"}</button>
        </p>
      </header>
      <div ref={hostRef} />
    </>
  );
}

function formatRemaining(seconds) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function update(setQuestions, index, patch) {
  setQuestions((current) => current.map((question, item) => item === index ? { ...question, ...patch } : question));
}

function Invigilator({ me, onLogout }) {
  const desk = useStaffDesk();
  const examChecks = useExamChecks(desk);
  const [page, setPage] = useState("candidates");
  const [count, setCount] = useState(0);
  const [assigned, setAssigned] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = () => api("/api/wall").then((rows) => { if (alive) setCount(rows.length); }).catch(() => {});
    load();
    const timer = setInterval(load, 5000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  return (
    <Desk
      me={me}
      onLogout={onLogout}
      note="Candidates lists everyone the manager assigned to you. Streams shows the ones who are in a paper."
      alerts={<StaffAlerts desk={desk} quiet />}
      nav={
        <>
          <NavButton active={page === "candidates"} onClick={() => setPage("candidates")}>
            Candidates <em className="rounded-full bg-amber-200 px-2 py-0.5 text-xs text-stone-950 not-italic">{assigned}</em>
          </NavButton>
          <NavButton active={page === "wall"} onClick={() => setPage("wall")}>
            Streams <em className="rounded-full bg-emerald-200 px-2 py-0.5 text-xs text-stone-950 not-italic">{count}</em>
          </NavButton>
          <NavButton active={page === "summary"} onClick={() => setPage("summary")}>
            Summary {examChecks.checks.length > 0 && <em className="rounded-full bg-red-500 px-2 py-0.5 text-xs text-white not-italic">{examChecks.checks.length}</em>}
          </NavButton>
        </>
      }
    >
      <CheckBanners checks={examChecks.checks} sound={desk.sound} onSound={desk.enableSound} onSeen={examChecks.seen} onOpen={() => setPage("summary")} />
      {page === "summary" ? <SummaryDesk /> : page === "wall" ? <LiveWall desk={desk} empty="No assigned candidate is in a paper right now." onCount={setCount} /> : <WatchList onCount={setAssigned} />}
    </Desk>
  );
}

function WatchList({ onCount }) {
  const hostRef = useRef(null);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api("/api/watch").then(setRows).catch((err) => setError(err.message));
  }, []);

  useEffect(() => { if (rows) onCount(rows.length); }, [rows]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !rows) return undefined;
    host.replaceChildren();
    const table = document.createElement("table");
    table.className = "display";
    table.style.width = "100%";
    host.appendChild(table);
    const dt = new DataTable(table, {
      data: rows,
      columns: [
        { data: "fullName", title: "Candidate" },
        { data: "email", title: "Email" },
        { data: "exams", title: "Exam", render: (value, type) => type === "display" ? pill(value || "No exam", value ? "stone" : "amber") : value },
        { data: "status", title: "Status", render: (value, type) => type === "display" ? pill(value, String(value).startsWith("In ") ? "emerald" : "amber") : value }
      ],
      pageLength: 8,
      lengthMenu: [8, 25, 50, 100],
      order: [[0, "asc"]],
      language: { emptyTable: "No candidate is assigned to you yet.", zeroRecords: "No matches.", search: "Search:", lengthMenu: "Show _MENU_", info: "Showing _START_ to _END_ of _TOTAL_" }
    });
    return () => {
      try { dt.destroy(); } catch { /* The page already left. */ }
      host.replaceChildren();
    };
  }, [rows]);

  return (
    <>
      <header className="mb-6">
        <h1 className="font-serif text-4xl">Your candidates</h1>
        <p className="mt-1 max-w-2xl text-stone-500">Everyone the manager assigned to you, and the exam they were mapped to. Streams opens when one of them starts a paper.</p>
      </header>
      {error && <p className="mb-4 text-sm text-red-700">{error}</p>}
      {!rows && !error && <p className="text-stone-500">Loading candidates…</p>}
      <div ref={hostRef} className="rounded-3xl bg-white p-4 shadow-sm" />
    </>
  );
}

function SummaryDesk() {
  const hostRef = useRef(null);
  const [openId, setOpenId] = useState(null);
  const openRef = useRef(setOpenId);
  openRef.current = setOpenId;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const table = document.createElement("table");
    table.className = "display";
    table.style.width = "100%";
    table.innerHTML = "<thead><tr><th>Student</th><th>Paper</th><th>Ended</th><th>Warnings</th><th>Screenshots</th><th>Result</th><th></th></tr></thead>";
    host.appendChild(table);
    let dt;
    let cancelled = false;
    const onClick = (event) => {
      const button = event.target.closest("[data-summary]");
      if (button) openRef.current(Number(button.dataset.summary));
    };
    host.addEventListener("click", onClick);
    const frame = requestAnimationFrame(() => {
      if (cancelled) return;
      dt = new DataTable(table, {
        serverSide: true,
        processing: false,
        autoWidth: false,
        pageLength: 8,
        lengthMenu: [8, 10, 25, 50],
        order: [[3, "desc"]],
        ajax: { url: "/api/summaries" },
        columns: [
          { data: "studentName", title: "Student" },
          { data: "paper", title: "Paper" },
          {
            data: "ended",
            title: "Ended",
            render: (value, type, row) => {
              const label = row.status === "expired" ? "Time up" : "Submitted";
              if (type !== "display") return `${label} ${value}`;
              return `${pill(label, row.status === "expired" ? "red" : "emerald")} <span class="ml-2 text-stone-500">${new Date(value).toLocaleString()}</span>`;
            }
          },
          {
            data: "warnings",
            title: "Warnings",
            render: (value, type) => type === "display" ? pill(value > 4 ? `${value} · check` : String(value), value > 4 ? "red" : "stone") : value
          },
          { data: "screenshots", title: "Screenshots" },
          {
            data: null,
            title: "Result",
            render: (_data, type, row) => type === "display" ? pill(`${row.score} / ${row.maxScore}`, row.score > 0 ? "emerald" : "stone") : row.score
          },
          {
            data: "id",
            orderable: false,
            searchable: false,
            render: (id) => `<button type="button" class="rounded-full bg-stone-950 px-3 py-1 text-xs font-medium text-white" data-summary="${id}">Open</button>`
          }
        ],
        createdRow: (row, data) => {
          if (data.warnings > 4) row.classList.add("summary-check");
        },
        language: {
          search: "Search:",
          lengthMenu: "Show _MENU_",
          info: "Showing _START_ to _END_ of _TOTAL_",
          emptyTable: "No finished paper has uploaded a summary yet.",
          zeroRecords: "No matches."
        }
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      host.removeEventListener("click", onClick);
      try { dt?.destroy(); } catch { /* React already removed the page. */ }
      host.replaceChildren();
    };
  }, []);

  return (
    <>
      <header className="mb-4">
        <h1 className="font-serif text-4xl">Summary</h1>
        <p className="mt-1 max-w-2xl text-stone-500">Each row is uploaded when a paper ends. It lists what was recorded and the screenshots from those events. More than four warnings means you should check that candidate.</p>
      </header>
      <div ref={hostRef} />
      {openId && <SummaryDetail sittingId={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

function SummaryDetail({ sittingId, onClose }) {
  const [body, setBody] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api(`/api/summaries/${sittingId}`).then(setBody).catch((err) => setError(err.message));
  }, [sittingId]);

  return (
    <section className="mt-6 rounded-3xl bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-serif text-2xl">Recorded events</h2>
        <button className={ghost} type="button" onClick={onClose}>Close</button>
      </div>
      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      {!body && !error && <p className="mt-3 text-sm text-stone-500">Loading the record…</p>}
      {body && (
        <>
          <ul className="mt-4 space-y-2">
            {body.events.length === 0 && <li className="text-sm text-stone-500">Nothing was recorded on this paper.</li>}
            {body.events.map((item, index) => (
              <li key={`${item.at}-${index}`} className={`rounded-2xl px-3 py-2 text-sm ${item.warning ? "bg-red-50 text-red-950" : "bg-stone-50"}`}>
                <span className="font-medium">{item.detail}</span>
                <span className="mt-1 block text-xs text-stone-500">{new Date(item.at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
          {body.stills.length > 0 && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {body.stills.map((still) => (
                <figure key={still.id} className="overflow-hidden rounded-2xl border border-stone-200">
                  <img src={`/api/summaries/stills/${still.id}`} alt={still.kind} className="aspect-video w-full object-cover" />
                  <figcaption className="px-3 py-2 text-xs text-stone-600">{still.kind} · {new Date(still.at).toLocaleString()}</figcaption>
                </figure>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function LiveWall({ desk, title, detail, empty, onCount }) {
  const [students, setStudents] = useState([]);
  const [feeds, setFeeds] = useState(() => new Map());
  const [openId, setOpenId] = useState(null);
  const [error, setError] = useState("");
  const studentsRef = useRef(students);
  studentsRef.current = students;

  useEffect(() => {
    let alive = true;
    const load = () => api("/api/wall")
      .then((rows) => { if (alive) setStudents(rows); })
      .catch((err) => { if (alive) setError(err.message); });
    load();
    const timer = setInterval(load, 1000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  useEffect(() => { onCount?.(students.length); }, [students.length]);

  const ids = students.map((student) => student.id).join(",");

  useEffect(() => {
    const connection = desk.hub.current;
    if (!desk.ready || !connection) return undefined;
    const calls = new Map();
    let alive = true;
    const negotiate = (sittingId) => {
      const current = calls.get(sittingId);
      if (current?.live()) return;
      current?.close();
      const call = openViewer(connection, sittingId, (stream) => {
        if (!alive) return;
        setFeeds((prev) => new Map(prev).set(sittingId, stream));
      });
      calls.set(sittingId, call);
    };
    connection.on("candidateAnswer", (sittingId, sdp) => { calls.get(sittingId)?.acceptAnswer(sdp).catch(() => {}); });
    connection.on("candidateIce", (sittingId, raw) => { calls.get(sittingId)?.addIce(JSON.parse(raw)).catch(() => {}); });
    const tick = () => {
      const seen = new Set(studentsRef.current.map((student) => student.id));
      for (const student of studentsRef.current) negotiate(student.id);
      for (const [sittingId, call] of calls) {
        if (seen.has(sittingId)) continue;
        call.close();
        calls.delete(sittingId);
        setFeeds((prev) => {
          const next = new Map(prev);
          next.delete(sittingId);
          return next;
        });
      }
    };
    tick();
    const timer = setInterval(tick, 2000);
    return () => {
      alive = false;
      clearInterval(timer);
      connection.off("candidateAnswer");
      connection.off("candidateIce");
      for (const call of calls.values()) call.close();
    };
  }, [desk.ready, ids]);

  useEffect(() => {
    const connection = desk.hub.current;
    if (!openId || !connection || !desk.ready) return undefined;
    connection.invoke("Watch", openId).catch(() => {});
    return () => { connection.invoke("Unwatch", openId).catch(() => {}); };
  }, [openId, desk.ready]);

  const open = students.find((student) => student.id === openId);

  return (
    <>
      {title && (
        <header className="mb-6">
          <h1 className="font-serif text-4xl">{title}</h1>
          {detail && <p className="mt-1 max-w-2xl text-stone-500">{detail}</p>}
        </header>
      )}
      {error && <p className="mb-4 text-sm text-red-700">{error}</p>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {students.map((student) => {
          const raised = student.hand || desk.hands.some((hand) => hand.sittingId === student.id);
          return (
            <button key={student.id} className={`overflow-hidden rounded-3xl bg-stone-950 text-left text-stone-100 ${raised ? "ring-4 ring-red-500" : ""}`} type="button" onClick={() => setOpenId(student.id)}>
              <div className="relative">
                <LiveVideo stream={feeds.get(student.id)} sittingId={student.id} />
                {raised && <HandGesture />}
              </div>
              <div className="px-4 py-3">
                <p className="font-medium">{student.studentName}</p>
                <p className="text-sm text-stone-400">{student.paper}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  <span className="rounded-full bg-stone-800 px-2 py-0.5 text-xs font-medium text-stone-100">{formatRemaining(student.remainingSeconds)} left</span>
                  {raised && <span className="rounded-full bg-red-500 px-2 py-0.5 text-xs font-medium text-white">Hand up</span>}
                  {!student.camera && <span className="rounded-full bg-amber-200 px-2 py-0.5 text-xs font-medium text-amber-950">No camera</span>}
                  {student.camera && !raised && <span className="rounded-full bg-emerald-200 px-2 py-0.5 text-xs font-medium text-emerald-950">Live</span>}
                </div>
              </div>
            </button>
          );
        })}
      </div>
      {students.length === 0 && <p>{empty}</p>}
      {open && (
        <div className="fixed inset-0 z-30 grid place-items-center bg-stone-950/80 p-6" onClick={() => setOpenId(null)}>
          <div className="w-full max-w-3xl overflow-hidden rounded-3xl bg-stone-950 text-stone-100" onClick={(event) => event.stopPropagation()}>
            <div className="relative">
              <LiveVideo stream={feeds.get(open.id)} sittingId={open.id} large />
              {(open.hand || desk.hands.some((hand) => hand.sittingId === open.id)) && <HandGesture large />}
            </div>
            <div className="flex items-center justify-between gap-3 px-5 py-4">
              <div>
                <p className="font-serif text-2xl">{open.studentName}</p>
                <p className="text-sm text-stone-400">{open.paper} · {formatRemaining(open.remainingSeconds)} left</p>
              </div>
              <button className="rounded-full bg-white px-4 py-2 text-sm font-medium text-stone-950" type="button" onClick={() => setOpenId(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function HandGesture({ large }) {
  return (
    <div className={`absolute left-3 top-3 z-10 flex items-center gap-2 rounded-full bg-red-600 text-white shadow-lg ${large ? "px-4 py-3" : "px-3 py-2"}`} role="status">
      <svg className={`hand-wave ${large ? "h-10 w-10" : "h-7 w-7"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M8 11V5.5a1.5 1.5 0 0 1 3 0V11" />
        <path d="M11 10.5V4.5a1.5 1.5 0 0 1 3 0V11" />
        <path d="M14 11V6.5a1.5 1.5 0 0 1 3 0V13" />
        <path d="M8 11.5 6.2 9.2a1.4 1.4 0 0 0-2.2 1.7L7.2 16c.8 1.6 2.6 4 6.3 4 3.4 0 5.5-2.4 5.5-5.5V10a1.5 1.5 0 0 0-3 0" />
      </svg>
      <span className={large ? "text-base font-medium" : "text-sm font-medium"}>Hand up</span>
    </div>
  );
}

function LiveVideo({ stream, sittingId, large }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [seen, setSeen] = useState(false);
  const box = large ? "aspect-video" : "aspect-[4/3]";

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream || null;
  }, [stream]);

  useEffect(() => {
    if (stream || !sittingId) return undefined;
    let alive = true;
    let since = "0";
    const pull = async () => {
      while (alive) {
        let fresh = false;
        try {
          const response = await fetch(`/api/wall/${sittingId}/frame?since=${since}`, { cache: "no-store", credentials: "include" });
          const version = response.headers.get("X-Frame");
          if (version) since = version;
          if (response.status === 200 && canvasRef.current) {
            const bitmap = await createImageBitmap(await response.blob());
            const canvas = canvasRef.current;
            if (canvas.width !== bitmap.width) {
              canvas.width = bitmap.width;
              canvas.height = bitmap.height;
            }
            canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
            bitmap.close();
            fresh = true;
            setSeen(true);
          }
        } catch {
          /* keep the last frame */
        }
        if (!fresh) await new Promise((resolve) => setTimeout(resolve, 16));
      }
    };
    pull();
    return () => { alive = false; };
  }, [stream, sittingId]);

  if (stream) {
    return <video ref={videoRef} autoPlay muted playsInline className={`w-full object-cover ${box}`} />;
  }
  return (
    <div className={`relative overflow-hidden bg-stone-950 ${box}`}>
      <canvas ref={canvasRef} className={`h-full w-full object-cover ${seen ? "" : "invisible"}`} />
      {!seen && <div className="absolute inset-0 grid place-items-center px-4"><span className="rounded-full bg-amber-200 px-3 py-1 text-xs font-medium text-amber-950">Waiting for the live camera</span></div>}
    </div>
  );
}

function AssignDesk() {
  const [roster, setRoster] = useState(null);
  const [examId, setExamId] = useState("");
  const [invigilatorId, setInvigilatorId] = useState("");
  const [picked, setPicked] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const hostRef = useRef(null);
  const selectedRef = useRef(new Set());
  const tableRef = useRef(null);

  async function load() {
    setRoster(await api("/api/roster"));
  }

  useEffect(() => { load().catch((err) => setError(err.message)); }, []);

  const candidates = roster && examId
    ? roster.students.filter((student) => student.examIds.includes(Number(examId)))
    : [];
  const invigilator = roster?.invigilators.find((item) => String(item.id) === String(invigilatorId));

  useEffect(() => {
    selectedRef.current = new Set();
    setPicked(0);
    const host = hostRef.current;
    if (!host) return undefined;
    host.replaceChildren();
    if (!examId) return undefined;
    const table = document.createElement("table");
    table.className = "display";
    table.style.width = "100%";
    host.appendChild(table);
    const dt = new DataTable(table, {
      data: candidates,
      columns: [
        {
          data: "id",
          title: "",
          orderable: false,
          searchable: false,
          width: "36px",
          render: (id) => `<input type="checkbox" data-id="${id}" aria-label="Select candidate" ${selectedRef.current.has(id) ? "checked" : ""}>`
        },
        { data: "fullName", title: "Candidate" },
        { data: "email", title: "Email" },
        { data: "invigilatorName", title: "Invigilator", render: (value, type) => type === "display" ? pill(value || "Unassigned", value ? "emerald" : "amber") : (value || "Unassigned") }
      ],
      pageLength: 8,
      order: [[1, "asc"]],
      language: { emptyTable: "No candidate on this exam has joined yet.", zeroRecords: "No matches.", search: "Search:", lengthMenu: "Show _MENU_", info: "Showing _START_ to _END_ of _TOTAL_" }
    });
    tableRef.current = dt;
    function onChange(event) {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.type !== "checkbox") return;
      const id = Number(input.dataset.id);
      if (!id) return;
      const next = new Set(selectedRef.current);
      if (input.checked) next.add(id);
      else next.delete(id);
      selectedRef.current = next;
      setPicked(next.size);
    }
    host.addEventListener("change", onChange);
    return () => {
      host.removeEventListener("change", onChange);
      tableRef.current = null;
      try { dt.destroy(); } catch { /* The page already left. */ }
      host.replaceChildren();
    };
  }, [examId, roster]);

  function tickSearch() {
    const dt = tableRef.current;
    if (!dt) return;
    const visible = dt.rows({ search: "applied" }).data().toArray().map((row) => row.id);
    const next = new Set(selectedRef.current);
    const allOn = visible.length > 0 && visible.every((id) => next.has(id));
    visible.forEach((id) => { if (allOn) next.delete(id); else next.add(id); });
    selectedRef.current = next;
    setPicked(next.size);
    dt.draw(false);
  }

  function chosenIds(everyone) {
    if (everyone) return candidates.map((student) => student.id);
    return [...selectedRef.current].filter((id) => candidates.some((student) => student.id === id));
  }

  async function assign(everyone) {
    const studentIds = chosenIds(everyone);
    if (!invigilatorId || studentIds.length === 0) return;
    setBusy(true);
    setError("");
    try {
      await api("/api/roster/bulk", { method: "POST", body: JSON.stringify({ studentIds, invigilatorId: Number(invigilatorId) }) });
      selectedRef.current = new Set();
      setPicked(0);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!roster) return <p className="text-stone-500">Loading assignments…</p>;

  return (
    <>
      <header className="mb-6">
        <h1 className="font-serif text-4xl">Assign invigilators</h1>
        <p className="mt-1 max-w-2xl text-stone-500">Pick the exam, then the invigilator. The table lists candidates already mapped to that exam. Search it, tick rows, and assign them together.</p>
      </header>
      {error && <p className="mb-4 text-sm text-red-700">{error}</p>}
      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        <SearchSelect label="Exam" value={examId} options={roster.exams.map((exam) => ({ id: exam.id, name: exam.title }))} placeholder="Search exams" onChange={setExamId} />
        <SearchSelect label="Invigilator" value={invigilatorId} options={roster.invigilators.map((item) => ({ id: item.id, name: item.fullName, detail: item.email }))} placeholder="Search invigilators" onChange={setInvigilatorId} />
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <button className={ghost} type="button" disabled={!examId || candidates.length === 0} onClick={tickSearch}>Tick this search</button>
        <button className={primary} type="button" disabled={busy || !invigilator || picked === 0} onClick={() => assign(false)}>
          {picked > 0 && invigilator ? `Assign ${picked} to ${invigilator.fullName}` : "Assign selected"}
        </button>
        <button className={ghost} type="button" disabled={busy || !invigilator || !examId || candidates.length === 0} onClick={() => assign(true)}>
          {invigilator && examId ? `Assign everyone on this exam to ${invigilator.fullName}` : "Assign everyone on this exam"}
        </button>
      </div>
      {!examId && <p className="rounded-3xl bg-white px-4 py-6 text-stone-500">Choose an exam to see its candidates.</p>}
      <div ref={hostRef} className={examId ? "rounded-3xl bg-white p-4 shadow-sm" : "hidden"} />
    </>
  );
}

function Student({ me, onStart, onLogout }) {
  const [page, setPage] = useState("todo");
  const [papers, setPapers] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api("/api/assessments").then(setPapers).catch((err) => setError(err.message));
  }, []);

  async function start(assessmentId) {
    try {
      const sitting = await api("/api/sittings", { method: "POST", body: JSON.stringify({ assessmentId }) });
      onStart(sitting.id);
    } catch (err) {
      setError(err.message);
    }
  }

  const open = papers.filter((paper) => !paper.sitting || paper.sitting.status === "in_progress");
  const done = papers.filter((paper) => paper.sitting && paper.sitting.status !== "in_progress");
  const shown = page === "todo" ? open : done;

  const nav = (
    <>
      <NavButton active={page === "todo"} onClick={() => setPage("todo")}>
        To take <em className="rounded-full bg-amber-200 px-2 py-0.5 text-xs text-stone-950 not-italic">{open.length}</em>
      </NavButton>
      <NavButton active={page === "done"} onClick={() => setPage("done")}>
        Finished <em className="rounded-full bg-emerald-200 px-2 py-0.5 text-xs text-stone-950 not-italic">{done.length}</em>
      </NavButton>
    </>
  );

  const body = (
    <>
      <header className="mb-6">
        <h1 className="font-serif text-4xl">{page === "todo" ? "Exams to take" : "Finished exams"}</h1>
        <p className="mt-1 max-w-xl text-stone-500">{page === "todo" ? "Open a card to start. The camera asks before the questions, and the clock is already running." : "Submitted papers keep their marks. A paper that ran out scores nothing."}</p>
      </header>
      {error && <p className="mb-4 text-sm text-red-700">{error}</p>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((paper) => (
          <ExamCard key={paper.id} paper={paper} onOpen={() => start(paper.id)} />
        ))}
      </div>
      {shown.length === 0 && <p>{page === "todo" ? "No exam is assigned to you yet." : "No finished paper yet."}</p>}
    </>
  );

  return <Desk me={me} onLogout={onLogout} nav={nav}>{body}</Desk>;
}

function ExamCard({ paper, onOpen }) {
  const status = paper.sitting?.status;
  const label = status === "in_progress" ? "In progress" : status === "submitted" ? "Submitted" : status === "expired" ? "No marks" : "To take";
  const action = status === "in_progress" ? "Resume" : status ? "Open result" : "Start";
  const pill = status === "expired" ? "bg-red-100 text-red-900" : status === "submitted" ? "bg-emerald-100 text-emerald-900" : status === "in_progress" ? "bg-amber-100 text-amber-950" : "bg-stone-200 text-stone-800";
  return (
    <article className="flex flex-col justify-between rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
      <div>
        <span className={`rounded-full px-2 py-1 text-xs font-medium ${pill}`}>{label}</span>
        <h2 className="mt-3 font-serif text-2xl">{paper.title}</h2>
        <p className="mt-1 text-sm text-stone-500">{paper.questionCount} question{paper.questionCount === 1 ? "" : "s"} · {paper.maxScore} mark{paper.maxScore === 1 ? "" : "s"}</p>
        {(status === "submitted" || status === "expired") && <p className="mt-3 font-serif text-3xl">{paper.sitting.score} / {paper.sitting.maxScore}</p>}
      </div>
      <div className="mt-6 flex items-center justify-between">
        <strong>{paper.durationMinutes} min</strong>
        <button className={primary} type="button" onClick={onOpen}>{action}</button>
      </div>
    </article>
  );
}
