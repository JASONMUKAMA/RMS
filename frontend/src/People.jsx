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
    villageId: "",
    dateOfBirth: "",
    password: ""
  });
  const [places, setPlaces] = useState(null);
  const [counties, setCounties] = useState([]);
  const [subcounties, setSubcounties] = useState([]);
  const [parishes, setParishes] = useState([]);
  const [villages, setVillages] = useState([]);
  const [picked, setPicked] = useState({ district: "", county: "", subcounty: "", parish: "" });
  const [loadingPlace, setLoadingPlace] = useState("");

  useEffect(() => {
    api("/api/places/summary").then(async (summary) => {
      if (summary.villages > 0)
        summary.districts = await api("/api/places/districts");
      setPlaces(summary);
    }).catch(() => setPlaces({ villages: 0 }));
    api("/api/join/addresses").then(setAddresses).catch(() => setAddresses([]));
  }, []);

  function set(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function chooseDistrict(id) {
    setPicked({ district: id, county: "", subcounty: "", parish: "" });
    set("villageId", "");
    setSubcounties([]);
    setParishes([]);
    setVillages([]);
    if (!id) {
      setCounties([]);
      return;
    }
    setLoadingPlace("counties");
    try {
      setCounties(await api(`/api/places/counties?districtId=${id}`));
    } finally {
      setLoadingPlace("");
    }
  }

  async function chooseCounty(id) {
    setPicked((current) => ({ ...current, county: id, subcounty: "", parish: "" }));
    set("villageId", "");
    setParishes([]);
    setVillages([]);
    if (!id) {
      setSubcounties([]);
      return;
    }
    setLoadingPlace("subcounties");
    try {
      setSubcounties(await api(`/api/places/subcounties?countyId=${id}`));
    } finally {
      setLoadingPlace("");
    }
  }

  async function chooseSubcounty(id) {
    setPicked((current) => ({ ...current, subcounty: id, parish: "" }));
    set("villageId", "");
    setVillages([]);
    if (!id) {
      setParishes([]);
      return;
    }
    setLoadingPlace("parishes");
    try {
      setParishes(await api(`/api/places/parishes?subcountyId=${id}`));
    } finally {
      setLoadingPlace("");
    }
  }

  async function chooseParish(id) {
    setPicked((current) => ({ ...current, parish: id }));
    set("villageId", "");
    if (!id) {
      setVillages([]);
      return;
    }
    setLoadingPlace("villages");
    try {
      setVillages(await api(`/api/places/villages?parishId=${id}`));
    } finally {
      setLoadingPlace("");
    }
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
      if (step === 4 && places?.villages > 0 && !form.villageId) return;
      setStep(step + 1);
      return;
    }
    setBusy(true);
    try {
      const account = await api("/api/join", { method: "POST", body: JSON.stringify({ ...form, villageId: form.villageId ? Number(form.villageId) : null }) });
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
          places?.villages > 0 ? (
            <div className="mt-5 grid gap-4">
              <SearchSelect label="District" value={picked.district} options={places.districts || []} loading={!places.districts} placeholder="Search districts" onChange={chooseDistrict} />
              <SearchSelect label="County" value={picked.county} options={counties} disabled={!picked.district} loading={loadingPlace === "counties"} placeholder={picked.district ? "Search counties" : "Choose a district first"} onChange={chooseCounty} />
              <SearchSelect label="Subcounty" value={picked.subcounty} options={subcounties} disabled={!picked.county} loading={loadingPlace === "subcounties"} placeholder={picked.county ? "Search subcounties" : "Choose a county first"} onChange={chooseSubcounty} />
              <SearchSelect label="Parish" value={picked.parish} options={parishes} disabled={!picked.subcounty} loading={loadingPlace === "parishes"} placeholder={picked.subcounty ? "Search parishes" : "Choose a subcounty first"} onChange={chooseParish} />
              <SearchSelect label="Village" value={form.villageId} options={villages} disabled={!picked.parish} loading={loadingPlace === "villages"} placeholder={picked.parish ? "Search villages" : "Choose a parish first"} onChange={(id) => set("villageId", id)} />
            </div>
          ) : addresses.length === 0 ? (
            <p className="mt-5 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-950">Districts and villages are not loaded yet.</p>
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
          <button className={primary} type="submit" disabled={busy || (step === 4 && places?.villages > 0 && !form.villageId) || (step === 4 && !(places?.villages > 0) && addresses.length === 0)}>
            {step === 6 ? "Create account" : "Continue"}
          </button>
        </div>
      </form>
    </main>
  );
}

function SearchSelect({ label, value, options, onChange, placeholder = "Search", disabled = false, loading = false }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef(null);
  const list = useRef(null);
  const selected = options.find((item) => String(item.id) === String(value));
  const needle = query.trim().toLowerCase();
  const filtered = needle ? options.filter((item) => item.name.toLowerCase().includes(needle)) : options;

  useEffect(() => {
    function outside(event) {
      if (!root.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);

  useEffect(() => {
    if (!open) return;
    const chosen = filtered.findIndex((item) => String(item.id) === String(value));
    setActive(needle ? 0 : Math.max(chosen, 0));
  }, [needle, open]);

  useEffect(() => {
    list.current?.querySelector("[data-active='true']")?.scrollIntoView({ block: "nearest" });
  }, [active, open, filtered.length]);

  function pick(item) {
    onChange(String(item.id));
    setQuery("");
    setOpen(false);
  }

  function onKey(event) {
    if (disabled) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((index) => Math.min(index + 1, Math.max(filtered.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && open) {
      event.preventDefault();
      if (filtered[active]) pick(filtered[active]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={root} className={`relative text-sm ${open ? "z-40" : ""}`}>
      <span className="block" id={`${label}-label`}>{label}</span>
      <div className={`mt-1 flex items-center gap-1 rounded-xl border bg-white px-3 transition ${open ? "border-stone-900 ring-2 ring-stone-900/10" : "border-stone-300"} ${disabled ? "bg-stone-50" : ""}`}>
        <svg className="h-4 w-4 shrink-0 text-stone-400" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.6" />
          <path d="M12.5 12.5 17 17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <input
          className="w-full bg-transparent py-2.5 outline-none placeholder:text-stone-400 disabled:cursor-not-allowed"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-labelledby={`${label}-label`}
          autoComplete="off"
          disabled={disabled}
          placeholder={selected && !open ? selected.name : placeholder}
          value={open ? query : (selected?.name || "")}
          onFocus={() => {
            if (disabled) return;
            setQuery("");
            setOpen(true);
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={onKey}
        />
        {value && !disabled && (
          <button className="rounded-full px-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-800" type="button" aria-label={`Clear ${label}`} onClick={() => { onChange(""); setQuery(""); setOpen(false); }}>×</button>
        )}
        <button
          className="rounded-full p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-800 disabled:cursor-not-allowed"
          type="button"
          aria-label={`Open ${label}`}
          disabled={disabled}
          onClick={() => setOpen((current) => !current)}
        >
          <svg className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z" clipRule="evenodd" />
          </svg>
        </button>
      </div>
      {open && !disabled && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-xl shadow-stone-300/70">
          <ul ref={list} className="max-h-60 overflow-auto p-1" role="listbox" aria-label={label}>
            {loading && <li className="px-3 py-2 text-stone-500">Loading…</li>}
            {!loading && filtered.length === 0 && <li className="px-3 py-2 text-stone-500">{needle ? `Nothing matches “${query.trim()}”` : "Nothing in this list"}</li>}
            {!loading && filtered.map((item, index) => {
              const chosen = String(item.id) === String(value);
              const current = index === active;
              return (
                <li key={item.id} role="option" aria-selected={chosen}>
                  <button
                    className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left ${current ? "bg-stone-950 text-stone-50" : "text-stone-800 hover:bg-stone-100"}`}
                    type="button"
                    data-active={current}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => pick(item)}
                  >
                    <span>{markMatch(item.name, needle)}</span>
                    {chosen && <span className={current ? "text-amber-300" : "text-amber-700"}>✓</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="border-t border-stone-100 px-3 py-1.5 text-xs text-stone-400">
            {loading ? "Fetching the list" : `${filtered.length} of ${options.length}`}
          </p>
        </div>
      )}
    </div>
  );
}

function markMatch(name, needle) {
  if (!needle) return name;
  const index = name.toLowerCase().indexOf(needle);
  if (index < 0) return name;
  return (
    <>
      {name.slice(0, index)}
      <mark className="rounded bg-amber-200/90 px-0.5 text-inherit">{name.slice(index, index + needle.length)}</mark>
      {name.slice(index + needle.length)}
    </>
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

function NavLabel({ children }) {
  return <p className="px-3 pb-1 pt-4 text-[10px] font-medium tracking-[0.18em] text-stone-500 first:pt-0">{children}</p>;
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
  const [page, setPage] = useState("roles");
  const toasts = useToasts();

  const nav = (
    <>
      <NavLabel>Staff</NavLabel>
      <NavButton active={page === "staff"} onClick={() => setPage("staff")}>Create staff</NavButton>
      <NavButton active={page === "roles"} onClick={() => setPage("roles")}>Roles</NavButton>
      <NavLabel>Candidates</NavLabel>
      <NavButton active={page === "upload"} onClick={() => setPage("upload")}>Upload emails</NavButton>
      <NavButton active={page === "emails"} onClick={() => setPage("emails")}>Uploaded emails</NavButton>
      <NavLabel>Desk</NavLabel>
      <NavButton active={page === "addresses"} onClick={() => setPage("addresses")}>Places</NavButton>
      <NavButton active={page === "mail"} onClick={() => setPage("mail")}>Outbox</NavButton>
    </>
  );

  return (
    <DeskShell
      me={me}
      onLogout={onLogout}
      nav={nav}
      note="Create staff, then set roles on the next page. Upload candidate emails, then read the sheet on its own page. The manager assigns a teacher to invigilate an exam."
    >
      {page === "staff" && <StaffPage push={toasts.push} />}
      {page === "roles" && <RolesPage me={me} push={toasts.push} />}
      {page === "upload" && <UploadPage push={toasts.push} />}
      {page === "emails" && <EmailListPage />}
      {page === "addresses" && <AddressPage push={toasts.push} />}
      {page === "mail" && <MailPage />}
      <Toaster toasts={toasts.toasts} onDismiss={toasts.dismiss} />
    </DeskShell>
  );
}

function StaffPage({ push }) {
  return (
    <>
      <header className="mb-6">
        <h1 className="font-serif text-4xl">Create staff</h1>
        <p className="mt-1 max-w-2xl text-stone-500">Teachers, invigilators, managers, and other system admins are created here. Candidates are not. They join from an uploaded email.</p>
      </header>
      <StaffForm push={push} />
    </>
  );
}

function RolesPage({ me, push }) {
  return (
    <>
      <header className="mb-6">
        <h1 className="font-serif text-4xl">Roles</h1>
        <p className="mt-1 max-w-2xl text-stone-500">Everyone with an account is listed here. Change a role or switch an account off. A person should sign in again after a role change.</p>
      </header>
      <PeopleTable me={me} push={push} />
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
      push({ tone: "success", title: "Staff account created", body: `${saved.fullName} is a ${roleLabel(saved.role)}. ${mailLine(saved.mail)} Open Roles to change it later.` });
      setForm({ givenName: "", familyName: "", email: "", role: form.role, password: "" });
      onCreated?.();
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

function UploadPage({ push }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);

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
      const skipped = body.invalidCount ? ` ${body.invalidCount} row${body.invalidCount === 1 ? "" : "s"} skipped${body.invalid?.length ? `: ${body.invalid.join("; ")}` : ""}.` : "";
      push({ tone: "success", title: "Emails uploaded", body: `${body.added} added. ${body.already} already on the desk.${skipped} Open Uploaded emails to see the sheet.` });
      setFile(null);
    } catch (err) {
      push({ tone: "error", title: "Upload stopped", body: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="mb-6">
        <h1 className="font-serif text-4xl">Upload emails</h1>
        <p className="mt-1 max-w-2xl text-stone-500">Upload .xlsx or .csv with an email column and a test column. The test is the paper title. On login, that candidate sees only those papers.</p>
      </header>
      <form className="rounded-3xl bg-white p-5 shadow-sm" onSubmit={upload}>
        <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-6 py-8 text-center">
          <span className="font-medium">{file ? file.name : "Drop the email sheet, or choose a file"}</span>
          <span className="mt-1 text-sm text-stone-500">Columns: email, test</span>
          <input className="sr-only" type="file" accept=".xlsx,.csv,text/csv" onChange={(event) => setFile(event.target.files?.[0] || null)} />
        </label>
        <button className={`${primary} mt-4`} type="submit" disabled={busy || !file}>Upload emails</button>
      </form>
    </>
  );
}

function EmailListPage() {
  return (
    <>
      <header className="mb-6">
        <h1 className="font-serif text-4xl">Uploaded emails</h1>
        <p className="mt-1 max-w-2xl text-stone-500">Every email from the sheets, the test they will see after login, and whether they have finished the candidate wizard.</p>
      </header>
      <InviteTable />
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
    table.innerHTML = "<thead><tr><th>Email</th><th>Test</th><th>Uploaded</th><th>Wizard</th></tr></thead>";
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
        order: [[2, "desc"]],
        ajax: { url: "/api/invites" },
        columns: [
          { data: "email", title: "Email" },
          { data: "test", title: "Test", render: (value) => value || "Not set" },
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
  const [summary, setSummary] = useState(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState([]);

  useEffect(() => {
    api("/api/places/summary").then(setSummary).catch((err) => push({ tone: "error", title: "Places did not load", body: err.message }));
  }, []);

  async function search(event) {
    event.preventDefault();
    try {
      setHits(await api(`/api/places/search?q=${encodeURIComponent(query)}`));
    } catch (err) {
      push({ tone: "error", title: "Search failed", body: err.message });
    }
  }

  const counts = [
    ["Districts", summary?.districts],
    ["Counties", summary?.counties],
    ["Subcounties", summary?.subcounties],
    ["Parishes", summary?.parishes],
    ["Villages", summary?.villages]
  ];

  return (
    <>
      <header className="mb-6">
        <h1 className="font-serif text-4xl">Places</h1>
        <p className="mt-1 max-w-2xl text-stone-500">Candidates pick a district, then a county, subcounty, parish, and village. The list comes from the district file.</p>
      </header>
      <div className="mb-6 grid gap-3 sm:grid-cols-5">
        {counts.map(([label, count]) => (
          <div key={label} className="rounded-3xl bg-white px-4 py-4 shadow-sm">
            <p className="text-xs tracking-[0.16em] text-stone-500">{label}</p>
            <p className="mt-2 font-serif text-3xl">{count ?? "…"}</p>
          </div>
        ))}
      </div>
      <form className="mb-4 flex flex-wrap gap-2" onSubmit={search}>
        <input className={`${field} mt-0 min-w-64 flex-1`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search a village" />
        <button className={primary} type="submit" disabled={query.trim().length < 2}>Search</button>
      </form>
      <div className="overflow-hidden rounded-3xl bg-white shadow-sm">
        {hits.length === 0 && <p className="px-4 py-6 text-stone-500">Search finds a village and shows the parish, subcounty, county, and district above it.</p>}
        {hits.map((hit) => (
          <p key={`${hit.village}-${hit.parish}-${hit.subcounty}`} className="border-b border-stone-200 px-4 py-3 last:border-0">
            <strong>{hit.village}</strong>
            <span className="mt-1 block text-sm text-stone-500">{hit.parish}, {hit.subcounty}, {hit.county}, {hit.district}</span>
          </p>
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
