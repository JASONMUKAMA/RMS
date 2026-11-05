const paths = {
  streams: (
    <>
      <rect x="2.5" y="5.5" width="10" height="9" rx="1.5" />
      <path d="m12.5 8.5 4.2-2.1a.7.7 0 0 1 1 .6v6a.7.7 0 0 1-1 .6l-4.2-2.1" />
    </>
  ),
  exams: (
    <>
      <path d="M6 3.5h5.2L15 7.2V16.5H6z" />
      <path d="M11.2 3.6V7.2H15" />
    </>
  ),
  clock: (
    <>
      <circle cx="10" cy="10" r="6.5" />
      <path d="M10 6.8V10l2.4 1.5" />
    </>
  ),
  check: (
    <>
      <circle cx="10" cy="10" r="6.5" />
      <path d="m7 10.2 2 2L13.2 8" />
    </>
  ),
  write: <path d="m12.4 3.6 3 3L8.2 13.8 4.6 15.4l1.5-3.6z" />,
  upload: (
    <>
      <path d="M10 13.2V4.2" />
      <path d="m6.4 7.6 3.6-3.6 3.6 3.6" />
      <path d="M4.5 16.2h11" />
    </>
  ),
  mark: (
    <>
      <path d="M3.5 5.5h8" />
      <path d="M3.5 9h6" />
      <path d="M3.5 12.5h4" />
      <path d="m12.2 11.2 3.2-3.2 1.4 1.4-3.2 3.2H12.2z" />
    </>
  ),
  summary: (
    <>
      <path d="M4 5.5h12" />
      <path d="M4 10h12" />
      <path d="M4 14.5h7" />
    </>
  ),
  assign: (
    <>
      <circle cx="8" cy="7" r="2.1" />
      <path d="M3.6 15.4c.4-2.3 2.1-3.4 4.4-3.4s4 1.1 4.4 3.4" />
      <path d="M15 7.2v3.6" />
      <path d="M13.2 9h3.6" />
    </>
  ),
  audit: (
    <>
      <rect x="5" y="3.2" width="10" height="13.6" rx="1.5" />
      <path d="M8 3.2h4v2.2H8z" />
      <path d="M8 9h4" />
      <path d="M8 12h3" />
    </>
  ),
  help: (
    <>
      <circle cx="10" cy="10" r="6.5" />
      <path d="M8 8.1a2 2 0 0 1 3.7 1c0 1.2-1.2 1.4-1.7 2.1" />
      <circle cx="10" cy="14.2" r="0.6" fill="currentColor" stroke="none" />
    </>
  ),
  candidates: (
    <>
      <circle cx="7.2" cy="7.2" r="2" />
      <circle cx="13.2" cy="8" r="1.5" />
      <path d="M3.4 15.2c.4-2.2 1.9-3.2 3.8-3.2s3.4 1 3.8 3.2" />
      <path d="M12 12.4c.7-.3 1.5-.4 2.2-.2 1.3.4 2 1.5 2.3 2.9" />
    </>
  ),
  take: (
    <>
      <rect x="5" y="3.5" width="10" height="13" rx="1.5" />
      <path d="M8 8h4" />
      <path d="M8 11.5h4" />
    </>
  ),
  done: (
    <>
      <path d="M5 16.5V4h8.2l-1.6 2.6 1.6 2.6H5" />
    </>
  ),
  staff: (
    <>
      <circle cx="8" cy="7" r="2.1" />
      <path d="M3.6 15.4c.4-2.3 2.1-3.4 4.4-3.4s4 1.1 4.4 3.4" />
      <path d="M15 6.6v4" />
      <path d="M13 8.6h4" />
    </>
  ),
  roles: (
    <>
      <rect x="3.2" y="5" width="13.6" height="10" rx="2" />
      <circle cx="7.6" cy="10" r="1.5" />
      <path d="M11 8.6h3.6" />
      <path d="M11 11.4h2.4" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="14" height="10" rx="1.5" />
      <path d="m3.6 6.2 6.4 4.6 6.4-4.6" />
    </>
  ),
  inbox: (
    <>
      <path d="M3.2 11.5 6.2 6h7.6l3 5.5" />
      <path d="M3.2 11.5h4.2l.8 1.6h3.6l.8-1.6h4.2V16H3.2z" />
    </>
  ),
  pin: (
    <>
      <path d="M10 17.4s4.8-4 4.8-7.6a4.8 4.8 0 1 0-9.6 0c0 3.6 4.8 7.6 4.8 7.6z" />
      <circle cx="10" cy="9.6" r="1.5" />
    </>
  ),
  out: (
    <>
      <path d="M8 4h6.2v12H8" />
      <path d="M3.8 10h7" />
      <path d="m8.2 7.4 2.6 2.6-2.6 2.6" />
    </>
  )
};

export function NavIcon({ name }) {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}
