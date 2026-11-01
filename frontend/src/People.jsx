import { useEffect, useRef, useState } from "react";
import DataTable from "datatables.net-dt";
import "datatables.net-dt/css/dataTables.dataTables.css";
import { api } from "./api";

const field = "mt-1 w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 outline-none transition focus:border-stone-900 focus:ring-2 focus:ring-stone-900/10";
const primary = "inline-flex items-center justify-center gap-2 rounded-full bg-stone-950 px-5 py-2.5 text-sm font-medium text-stone-50 shadow-sm transition hover:bg-stone-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-950 disabled:cursor-not-allowed disabled:bg-stone-300 disabled:text-stone-500";
const ghost = "inline-flex items-center justify-center gap-2 rounded-full border border-stone-300 bg-white px-5 py-2.5 text-sm font-medium text-stone-800 shadow-sm transition hover:border-stone-400 hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-400 disabled:cursor-not-allowed disabled:opacity-50";

const roleOptions = [
  ["student", "Candidate"],
  ["teacher", "Teacher"],
  ["invigilator", "Invigilator"],
  ["superadmin", "Manager"],
  ["systemadmin", "System admin"]
];

export function roleLabel(role) {
  return roleOptions.find(([value]) => value === role)?.[1] || role;
}

export function useExamChecks(desk) {
  const [checks, setChecks] = useState([]);

  useEffect(() => {
    const connection = desk.hub.current;
    if (!desk.ready || !connection) return undefined;
    const onCheck = (call) => setChecks((current) => [call, ...current.filter((item) => item.sittingId !== call.sittingId)]);
    connection.on("checkCandidate", onCheck);
    api("/api/checks").then(setChecks).catch(() => {});
    return () => connection.off("checkCandidate", onCheck);
  }, [desk.ready]);

  useEffect(() => {
    if (!desk.sound || checks.length === 0) return undefined;
    const blare = () => {
      const utterance = new SpeechSynthesisUtterance("Check this candidate. They have been warned more than four times.");
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    };
    blare();
    const timer = setInterval(blare, 4000);
    return () => {
      clearInterval(timer);
      window.speechSynthesis.cancel();
    };
  }, [desk.sound, checks.length]);

  async function seen(sittingId) {
    await api(`/api/checks/${sittingId}/seen`, { method: "POST" });
    setChecks((current) => current.filter((item) => item.sittingId !== sittingId));
  }

  return { checks, seen };
}

export function CheckBanners({ checks, sound, onSound, onSeen, onOpen }) {
  if (checks.length === 0) return null;
  return (
    <div className="mb-5 space-y-3">
      {checks.map((check) => (
        <div key={check.sittingId} className="rounded-3xl bg-red-700 px-5 py-4 text-white shadow-lg" role="alert">
          <p className="text-xs font-medium tracking-[0.16em] text-red-100">CHECK THIS CANDIDATE</p>
          <p className="mt-1 font-serif text-3xl">{check.studentName}</p>
          <p className="mt-1 text-red-50">{check.paper}. Warned {check.warnings} times, more than four. Open the sitting and check them out.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {!sound && <button className="rounded-full bg-white px-4 py-2 text-sm font-medium text-red-800" type="button" onClick={onSound}>Turn the check shout on</button>}
            <button className="rounded-full border border-white/40 px-4 py-2 text-sm font-medium" type="button" onClick={onOpen}>Open summary</button>
            <button className="rounded-full bg-white px-4 py-2 text-sm font-medium text-red-800" type="button" onClick={() => onSeen(check.sittingId)}>I have checked them</button>
          </div>
        </div>
      ))}
    </div>
  );
}

export function JoinWizard({ onDone, onBack }) {
  const [step, setStep] = useState(0);
  const [addresses, setAddresses] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    email: "",
    givenName: "",
    familyName: "",
    phone: "",
    nin: "",
    address: "",
    dateOfBirth: "",
    password: ""
  });

  useEffect(() => {
    api("/api/join/addresses").then(setAddresses).catch(() => setAddresses([]));
  }, []);

  function set(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function next(event) {
    event.preventDefault();
    setError("");
    if (step === 0) {
      setBusy(true);
      try {
        await api("/api/join/check", { method: "POST", body: JSON.stringify({ email: form.email }) });
        setStep(1);
      } catch (err) {
        setError(err.message);
      } finally {
        setBusy(false);
      }
      return;
    }
    if (step < 6) {
      setStep(step + 1);
      return;
    }
    setBusy(true);
    try {
      const account = await api("/api/join", { method: "POST", body: JSON.stringify(form) });
      onDone(account);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const titles = [
    "Email on the sheet",
    "Your name",
    "Phone number",
    "National ID",
    "Address",
    "Date of birth",
    "Choose a password"
  ];
  const today = new Date();
  const oldest = new Date(today.getFullYear() - 100, today.getMonth(), today.getDate()).toISOString().slice(0, 10);
  const youngest = new Date(today.getFullYear() - 16, today.getMonth(), today.getDate()).toISOString().slice(0, 10);

  return (
    <main className="min-h-screen bg-stone-100 px-4 py-10">
      <form className="mx-auto w-full max-w-lg rounded-3xl bg-white p-6 shadow-xl shadow-stone-200" onSubmit={next}>
        <p className="text-xs tracking-[0.22em] text-amber-700">RMS · Candidate record</p>
        <p className="mt-3 text-sm text-stone-500">Step {step + 1} of 7</p>
        <div className="mt-3 flex gap-1" aria-hidden="true">
          {titles.map((title, index) => (
            <span key={title} className={`h-1.5 flex-1 rounded-full ${index <= step ? "bg-stone-950" : "bg-stone-200"}`} />
          ))}
        </div>
        <h1 className="mt-5 font-serif text-4xl">{titles[step]}</h1>
        {step === 0 && (
          <label className="mt-5 block text-sm">Email
            <input className={field} type="email" autoComplete="email" required value={form.email} onChange={(event) => set("email", event.target.value)} />
            <span className="mt-2 block text-stone-500">Use the email the system admin uploaded. The rest of this form is for the record.</span>
          </label>
        )}
        {step === 1 && (
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">Given name
              <input className={field} required minLength={2} value={form.givenName} onChange={(event) => set("givenName", event.target.value)} />
            </label>
            <label className="block text-sm">Family name
              <input className={field} required minLength={2} value={form.familyName} onChange={(event) => set("familyName", event.target.value)} />
            </label>
          </div>
        )}
        {step === 2 && (
          <label className="mt-5 block text-sm">Phone number
            <input className={field} type="tel" required value={form.phone} onChange={(event) => set("phone", event.target.value)} />
          </label>
        )}
        {step === 3 && (
          <label className="mt-5 block text-sm">NIN
            <input className={field} required minLength={14} maxLength={14} value={form.nin} onChange={(event) => set("nin", event.target.value)} />
            <span className="mt-2 block text-stone-500">14 letters and numbers.</span>
          </label>
        )}
        {step === 4 && (
          addresses.length === 0 ? (
            <p className="mt-5 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-950">The system admin has not published addresses yet. You can continue once that list is on the desk.</p>
          ) : (
            <label className="mt-5 block text-sm">Address
              <select className={field} required value={form.address} onChange={(event) => set("address", event.target.value)}>
                <option value="">Choose an address</option>
                {addresses.map((address) => <option key={address} value={address}>{address}</option>)}
              </select>
            </label>
          )
        )}
        {step === 5 && (
          <label className="mt-5 block text-sm">Date of birth
            <input className={field} type="date" required min={oldest} max={youngest} value={form.dateOfBirth} onChange={(event) => set("dateOfBirth", event.target.value)} />
          </label>
        )}
        {step === 6 && (
          <label className="mt-5 block text-sm">Password
            <input className={field} type="password" required minLength={8} autoComplete="new-password" value={form.password} onChange={(event) => set("password", event.target.value)} />
            <span className="mt-2 block text-stone-500">At least 8 characters. A welcome message is kept for {form.email || "this email"}.</span>
          </label>
        )}
        {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
        <div className="mt-6 flex flex-wrap gap-2">
          <button className={ghost} type="button" onClick={() => step === 0 ? onBack() : setStep(step - 1)}>Back</button>
          <button className={primary} type="submit" disabled={busy || (step === 4 && addresses.length === 0)}>
            {step === 6 ? "Create account" : "Continue"}
          </button>
        </div>
      </form>
    </main>
  );
}

function DeskShell({ me, onLogout, nav, note, children }) {
  return (
    <div className="min-h-screen bg-stone-100 text-stone-900 md:grid md:grid-cols-[260px_1fr]">
      <aside className="flex flex-col gap-6 bg-stone-950 px-4 py-5 text-stone-100 md:sticky md:top-0 md:h-screen">
        <div>
          <p className="text-xs tracking-[0.22em] text-amber-200">RMS</p>
          <strong className="mt-3 block font-serif text-2xl font-medium">{me.fullName}</strong>
          <em className="mt-1 block text-sm text-stone-400 not-italic">System admin</em>
        </div>
        <nav className="flex flex-col gap-1">{nav}</nav>
        <p className="mt-auto text-xs leading-5 text-stone-400">{note}</p>
        <button className="rounded-full border border-white/15 px-4 py-2 text-sm text-stone-200 hover:bg-white/10" type="button" onClick={onLogout}>Sign out</button>
      </aside>
      <main className="min-w-0 px-5 py-6 md:px-8 md:py-8">{children}</main>
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

function useToasts() {
  const [toasts, setToasts] = useState([]);
  function push(toast) {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, ...toast }]);
    setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 5600);
  }
  function dismiss(id) {
    setToasts((current) => current.filter((item) => item.id !== id));
  }
  return { toasts, push, dismiss };
}

function Toaster({ toasts, onDismiss }) {
  return (
    <div className="pointer-events-none fixed right-4 top-4 z-50 flex w-80 flex-col gap-2">
      {toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          className={`pointer-events-auto rounded-2xl px-4 py-3 text-left text-sm text-white shadow-lg ${toast.tone === "error" ? "bg-red-700" : "bg-stone-950"}`}
          onClick={() => onDismiss(toast.id)}
        >
          <strong className="block">{toast.title}</strong>
          <span className="mt-1 block text-white/80">{toast.body}</span>
        </button>
      ))}
    </div>
  );
}

function mailLine(mail) {
  if (!mail) return "The message is in the outbox.";
  if (mail.status === "sent") return "The message was sent.";
  if (mail.status === "failed") return mail.detail || "The mail server rejected the message. It is still in the outbox.";
  return "No mail server is configured, so the message is kept in the outbox.";
}

export function SystemAdmin({ me, onLogout }) {
  const [page, setPage] = useState("people");
  const toasts = useToasts();

  const nav = (
    <>
      <NavButton active={page === "people"} onClick={() => setPage("people")}>People</NavButton>
      <NavButton active={page === "invites"} onClick={() => setPage("invites")}>Email sheet</NavButton>
      <NavButton active={page === "addresses"} onClick={() => setPage("addresses")}>Addresses</NavButton>
      <NavButton active={page === "mail"} onClick={() => setPage("mail")}>Outbox</NavButton>
    </>
  );

  return (
    <DeskShell
      me={me}
      onLogout={onLogout}
      nav={nav}
      note="Upload candidate emails, publish addresses, and set each person's role. The manager assigns a teacher to invigilate an exam."
    >
      {page === "people" && <PeoplePage me={me} push={toasts.push} />}
      {page === "invites" && <InvitePage push={toasts.push} />}
      {page === "addresses" && <AddressPage push={toasts.push} />}
      {page === "mail" && <MailPage />}
      <Toaster toasts={toasts.toasts} onDismiss={toasts.dismiss} />
    </DeskShell>
  );
}

function PeoplePage({ me, push }) {
  const [tick, setTick] = useState(0);
  return (
    <>
      <header className="mb-6">
        <h1 className="font-serif text-4xl">People</h1>
        <p className="mt-1 max-w-2xl text-stone-500">Create staff here. Candidates join only after their email is on the sheet.</p>
      </header>
      <StaffForm push={push} onCreated={() => setTick((value) => value + 1)} />
      <PeopleTable key={tick} me={me} push={push} />
    </>
  );
}

function StaffForm({ push, onCreated }) {
  const [form, setForm] = useState({ givenName: "", familyName: "", email: "", role: "teacher", password: "" });
  const [busy, setBusy] = useState(false);

  async function create(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const saved = await api("/api/people", { method: "POST", body: JSON.stringify(form) });
      push({ tone: "success", title: "Staff account created", body: `${saved.fullName} is a ${roleLabel(saved.role)}. ${mailLine(saved.mail)}` });
      setForm({ givenName: "", familyName: "", email: "", role: form.role, password: "" });
      onCreated();
    } catch (err) {
      push({ tone: "error", title: "Account not created", body: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="mb-6 grid gap-3 rounded-3xl bg-white p-5 shadow-sm md:grid-cols-2" onSubmit={create}>
      <label className="text-sm">Given name<input className={field} required value={form.givenName} onChange={(event) => setForm({ ...form, givenName: event.target.value })} /></label>
      <label className="text-sm">Family name<input className={field} required value={form.familyName} onChange={(event) => setForm({ ...form, familyName: event.target.value })} /></label>
      <label className="text-sm">Email<input className={field} type="email" required value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
      <label className="text-sm">Role
        <select className={field} value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>
          <option value="teacher">Teacher</option>
          <option value="invigilator">Invigilator</option>
          <option value="superadmin">Manager</option>
          <option value="systemadmin">System admin</option>
        </select>
      </label>
      <label className="text-sm md:col-span-2">Temporary password
        <input className={field} type="text" required minLength={8} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
      </label>
      <div className="md:col-span-2">
        <button className={primary} type="submit" disabled={busy}>Create staff account</button>
      </div>
    </form>
  );
}

function PeopleTable({ me, push }) {
  const hostRef = useRef(null);
  const pushRef = useRef(push);
  pushRef.current = push;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const table = document.createElement("table");
    table.className = "display";
    table.style.width = "100%";
    table.innerHTML = "<thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Account</th></tr></thead>";
    host.appendChild(table);
    let dt;
    let cancelled = false;
    const onChange = async (event) => {
      const select = event.target.closest("[data-role]");
      if (!select || !dt) return;
      try {
        await api(`/api/people/${select.dataset.role}/role`, { method: "POST", body: JSON.stringify({ role: select.value }) });
        pushRef.current({ tone: "success", title: "Role saved", body: "They should sign in again for the new role." });
      } catch (err) {
        pushRef.current({ tone: "error", title: "Role not saved", body: err.message });
      }
      dt.ajax.reload(null, false);
    };
    const onClick = async (event) => {
      const button = event.target.closest("[data-active]");
      if (!button || !dt) return;
      try {
        await api(`/api/people/${button.dataset.active}/active`, { method: "POST", body: JSON.stringify({ active: button.dataset.on === "1" }) });
        pushRef.current({ tone: "success", title: button.dataset.on === "1" ? "Account switched on" : "Account switched off", body: "A switched-off account cannot sign in." });
      } catch (err) {
        pushRef.current({ tone: "error", title: "Account not changed", body: err.message });
      }
      dt.ajax.reload(null, false);
    };
    host.addEventListener("change", onChange);
    host.addEventListener("click", onClick);
    const frame = requestAnimationFrame(() => {
      if (cancelled) return;
      dt = new DataTable(table, {
        serverSide: true,
        processing: false,
        autoWidth: false,
        pageLength: 8,
        lengthMenu: [8, 10, 25, 50],
        order: [[0, "asc"]],
        ajax: { url: "/api/people" },
        columns: [
          { data: "fullName", title: "Name" },
          { data: "email", title: "Email" },
          {
            data: null,
            title: "Role",
            render: (_data, _type, row) => {
              if (Number(row.id) === me.id) return roleLabel(row.role);
              return `<select data-role="${row.id}" class="rounded-lg border border-stone-300 bg-white px-2 py-1 text-sm">${roleOptions.map(([value, label]) => `<option value="${value}"${value === row.role ? " selected" : ""}>${label}</option>`).join("")}</select>`;
            }
          },
          {
            data: null,
            title: "Account",
            orderable: false,
            render: (_data, _type, row) => {
              const on = Number(row.active) === 1;
              if (Number(row.id) === me.id) return on ? "On" : "Off";
              return `<button type="button" class="rounded-full border border-stone-300 px-3 py-1 text-xs font-medium" data-active="${row.id}" data-on="${on ? 0 : 1}">${on ? "Switch off" : "Switch on"}</button>`;
            }
          }
        ],
        language: { emptyTable: "No accounts yet.", zeroRecords: "No matches.", search: "Search:", lengthMenu: "Show _MENU_", info: "Showing _START_ to _END_ of _TOTAL_" }
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      host.removeEventListener("change", onChange);
      host.removeEventListener("click", onClick);
      try { dt?.destroy(); } catch { /* The page already left. */ }
      host.replaceChildren();
    };
  }, [me.id]);

  return <div ref={hostRef} />;
}

function InvitePage({ push }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);

  async function upload(event) {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    try {
      const data = new FormData();
      data.append("file", file);
      const response = await fetch("/api/invites/file", { method: "POST", body: data, credentials: "include" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "The sheet was not accepted.");
      const invalid = body.invalidCount ? ` ${body.invalidCount} row${body.invalidCount === 1 ? "" : "s"} were not emails.` : "";
      push({ tone: "success", title: "Emails uploaded", body: `${body.added} added. ${body.already} already on the desk.${invalid}` });
      setFile(null);
      setTick((value) => value + 1);
    } catch (err) {
      push({ tone: "error", title: "Upload stopped", body: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="mb-6">
        <h1 className="font-serif text-4xl">Email sheet</h1>
        <p className="mt-1 max-w-2xl text-stone-500">Upload .xlsx or .csv with a column named email. Those people can then open the candidate wizard.</p>
      </header>
      <form className="mb-6 rounded-3xl bg-white p-5 shadow-sm" onSubmit={upload}>
        <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-6 py-8 text-center">
          <span className="font-medium">{file ? file.name : "Drop the email sheet, or choose a file"}</span>
          <span className="mt-1 text-sm text-stone-500">One column: email</span>
          <input className="sr-only" type="file" accept=".xlsx,.csv,text/csv" onChange={(event) => setFile(event.target.files?.[0] || null)} />
        </label>
        <button className={`${primary} mt-4`} type="submit" disabled={busy || !file}>Upload emails</button>
      </form>
      <InviteTable key={tick} />
    </>
  );
}

function InviteTable() {
  const hostRef = useRef(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const table = document.createElement("table");
    table.className = "display";
    table.style.width = "100%";
    table.innerHTML = "<thead><tr><th>Email</th><th>Uploaded</th><th>Wizard</th></tr></thead>";
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
        order: [[1, "desc"]],
        ajax: { url: "/api/invites" },
        columns: [
          { data: "email", title: "Email" },
          { data: "createdAt", title: "Uploaded", render: (value) => value ? new Date(value).toLocaleString() : "" },
          { data: "usedAt", title: "Wizard", render: (value) => value ? "Joined" : "Waiting" }
        ],
        language: { emptyTable: "No emails uploaded yet.", zeroRecords: "No matches.", search: "Search:", lengthMenu: "Show _MENU_", info: "Showing _START_ to _END_ of _TOTAL_" }
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      try { dt?.destroy(); } catch { /* The page already left. */ }
      host.replaceChildren();
    };
  }, []);
  return <div ref={hostRef} />;
}

function AddressPage({ push }) {
  const [rows, setRows] = useState([]);
  const [text, setText] = useState("");

  async function load() {
    setRows(await api("/api/addresses"));
  }

  useEffect(() => { load().catch((err) => push({ tone: "error", title: "Addresses did not load", body: err.message })); }, []);

  async function add(event) {
    event.preventDefault();
    const names = text.split("\n").map((line) => line.trim()).filter(Boolean);
    try {
      const saved = await api("/api/addresses", { method: "POST", body: JSON.stringify({ names }) });
      push({ tone: "success", title: "Addresses published", body: `${saved.added} added. Candidates choose from this list.` });
      setText("");
      await load();
    } catch (err) {
      push({ tone: "error", title: "Addresses not saved", body: err.message });
    }
  }

  async function remove(id) {
    try {
      await api(`/api/addresses/${id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      push({ tone: "error", title: "Address not removed", body: err.message });
    }
  }

  return (
    <>
      <header className="mb-6">
        <h1 className="font-serif text-4xl">Addresses</h1>
        <p className="mt-1 max-w-2xl text-stone-500">This list stays empty until you add the addresses candidates may choose. One address on each line.</p>
      </header>
      <form className="mb-6 rounded-3xl bg-white p-5 shadow-sm" onSubmit={add}>
        <label className="block text-sm">Addresses
          <textarea className={`${field} min-h-32`} value={text} onChange={(event) => setText(event.target.value)} placeholder={"One address on each line"} />
        </label>
        <button className={`${primary} mt-4`} type="submit" disabled={!text.trim()}>Publish addresses</button>
      </form>
      <div className="overflow-hidden rounded-3xl bg-white shadow-sm">
        {rows.length === 0 && <p className="px-4 py-6 text-stone-500">No addresses yet.</p>}
        {rows.map((row) => (
          <div key={row.id} className="flex items-center justify-between gap-3 border-b border-stone-200 px-4 py-3 last:border-0">
            <span>{row.name}</span>
            <button className={ghost} type="button" onClick={() => remove(row.id)}>Remove</button>
          </div>
        ))}
      </div>
    </>
  );
}

function MailPage() {
  const [open, setOpen] = useState(null);
  return (
    <>
      <header className="mb-6">
        <h1 className="font-serif text-4xl">Outbox</h1>
        <p className="mt-1 max-w-2xl text-stone-500">Welcome messages and exam results are kept here. They are sent when RMS_SMTP_HOST is set on the server. Until then the status stays held.</p>
      </header>
      <MailTable onOpen={setOpen} />
      {open && <MailDetail id={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function MailTable({ onOpen }) {
  const hostRef = useRef(null);
  const openRef = useRef(onOpen);
  openRef.current = onOpen;
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const table = document.createElement("table");
    table.className = "display";
    table.style.width = "100%";
    table.innerHTML = "<thead><tr><th>To</th><th>Subject</th><th>Kind</th><th>Status</th><th>When</th><th></th></tr></thead>";
    host.appendChild(table);
    let dt;
    let cancelled = false;
    const onClick = (event) => {
      const button = event.target.closest("[data-mail]");
      if (button) openRef.current(Number(button.dataset.mail));
    };
    host.addEventListener("click", onClick);
    const frame = requestAnimationFrame(() => {
      if (cancelled) return;
      dt = new DataTable(table, {
        serverSide: true,
        processing: false,
        autoWidth: false,
        pageLength: 8,
        order: [[4, "desc"]],
        ajax: { url: "/api/mail" },
        columns: [
          { data: "toEmail", title: "To" },
          { data: "subject", title: "Subject" },
          { data: "kind", title: "Kind" },
          { data: "status", title: "Status" },
          { data: "createdAt", title: "When", render: (value) => value ? new Date(value).toLocaleString() : "" },
          {
            data: "id",
            orderable: false,
            searchable: false,
            render: (id) => `<button type="button" class="rounded-full bg-stone-950 px-3 py-1 text-xs font-medium text-white" data-mail="${id}">Read</button>`
          }
        ],
        language: { emptyTable: "No messages yet.", zeroRecords: "No matches.", search: "Search:", lengthMenu: "Show _MENU_", info: "Showing _START_ to _END_ of _TOTAL_" }
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      host.removeEventListener("click", onClick);
      try { dt?.destroy(); } catch { /* The page already left. */ }
      host.replaceChildren();
    };
  }, []);
  return <div ref={hostRef} />;
}

function MailDetail({ id, onClose }) {
  const [mail, setMail] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api(`/api/mail/${id}`).then(setMail).catch((err) => setError(err.message));
  }, [id]);
  return (
    <section className="mt-6 rounded-3xl bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-serif text-2xl">{mail?.subject || "Message"}</h2>
        <button className={ghost} type="button" onClick={onClose}>Close</button>
      </div>
      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      {mail && (
        <>
          <p className="mt-2 text-sm text-stone-500">{mail.to} · {mail.status}{mail.detail ? ` · ${mail.detail}` : ""}</p>
          <pre className="mt-4 whitespace-pre-wrap font-sans text-sm leading-6">{mail.body}</pre>
        </>
      )}
    </section>
  );
}
