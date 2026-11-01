# RMS — Recruitment Management System

Locked decision for the build. The sections below are the detail. Repository: [JASONMUKAMA/RMS](https://github.com/JASONMUKAMA/RMS.git).

## Final decision

RMS is a recruitment course plus a supervised paper for up to **1000 candidates at once**. Five roles: system admin, superadmin, teacher, student, invigilator. A teacher loads objectives and questions with answers. A student studies the track and sits one timed paper. An invigilator watches about **40 faces at once**, hears a spoken shout when a candidate raises a hand, and confirms or dismisses every malpractice flag. The score explains itself from stored signals. A person makes the decision. The score does not convict anyone on its own.

| Decision | Locked choice |
| --- | --- |
| API | ASP.NET Core on .NET 10 |
| Browser | One React app, TypeScript, Vite |
| Database | PostgreSQL with pgvector |
| Live desk | SignalR. At 1000 candidates, a few API nodes and a Redis backplane |
| Jobs | Hangfire, queue stored in PostgreSQL, extra workers when a paper ends together |
| Enlarged face | WebRTC, one candidate at a time |
| Brokers | No RabbitMQ. No Kafka |
| Short answers | BGE-M3, ONNX int8, on the server. Cosine **0.88** or higher, answers of at least 30 characters |
| Camera | MediaPipe Face Landmarker and Pose Landmarker, in the browser. Consent, visible preview, browser permission prompt |
| Camera wall | About 40 tiles per invigilator. Latest frame only, in memory, about 2 frames a second, about 320 pixels wide. Not a recording |
| Help | A Raise hand button. The invigilator and superadmin desks shout “Hand up. A candidate needs help.” until the call is acknowledged. The score does not change |
| Exam clock | Every paper has its own duration, set when that paper is created or uploaded. The clock starts on the server when the sitting starts. At 20 minutes left, a warm warning. At 5 minutes left, a heavy warning. At zero, the paper closes. If it was not submitted, the score is 0 |
| Malpractice | Window leave, copy, paste, answering too fast, shared wrong answers, similar short answers, face missing, second face, head turned away, hand at ear, camera interrupted. One still when a camera posture holds. Deleted 30 days after the flag is decided |
| Left out | Microphone, a stored video of the paper, a chat model, a vision-chat model, RabbitMQ, Kafka |

Cohorts, not one giant wall, are how 1000 faces are watched: about 25 invigilators, about 40 candidates each. Candidates never see each other’s cameras. Teachers do not see the wall. They see flags and stills on their own tracks.

## 1. Purpose

RMS runs a recruitment programme as a course of study plus a supervised assessment.

Staff publish learning objectives and a question bank. Candidates study the objectives and sit the assessment. An invigilator watches each sitting. An explainable integrity check raises malpractice flags from the sitting itself. A person confirms or dismisses every flag. The system does not convict a candidate on a score alone.

## 2. Roles

Five roles. A person has one role. The manager can also put a teacher on a particular exam as its invigilator without changing that person's role.

| Role | Who they are | Main job |
| --- | --- | --- |
| System admin | Account owner | People, roles, candidate email sheet, address list, outbound mail |
| Superadmin | Manager | Assign any teacher as invigilator of any exam, every track, audit history |
| Teacher | Examiner for a track | Objectives, questions and answers, assessments, enrolments. When assigned, invigilate that exam |
| Student | Candidate on a track | Read objectives, sit the assessment, see the result |
| Invigilator | Proctor | Live sittings, flag queue, confirm or dismiss malpractice |

### Who manages people

The system admin creates staff, sets roles, and switches accounts off. Candidates are not typed in one by one. The system admin uploads their emails on an Excel sheet. A person on that sheet then completes a wizard: given name, family name, phone number, email, NIN, an address from the list the system admin publishes, and date of birth. They choose a password. The address list stays empty until those addresses are added.

Signing up keeps a welcome message. Closing a paper keeps the score message. Both are sent when `RMS_SMTP_HOST` is set. Both stay in the system admin outbox either way.

On this desk, creating people and changing roles belong to the system admin. The manager assigns teachers to exams. A teacher assigned to an exam hears the check shout for that paper and reads its summary.

Naming in the product:

- A **track** is the recruitment course.
- A **candidate** is a user whose role is student.
- A **sitting** is one candidate’s attempt at one assessment.

## 3. What each role may do

| Action | Superadmin | Teacher | Student | Invigilator |
| --- | --- | --- | --- | --- |
| Create, deactivate, and assign roles | Yes | No | No | No |
| Read the audit log | Yes | No | No | No |
| Create a track and assign its teacher | Yes | Create own track | No | No |
| Edit a track they do not own | Yes | No | No | No |
| Add and upload objectives | Yes | Own tracks | No | No |
| Add and upload questions and answers | Yes | Own tracks | No | No |
| Build and publish an assessment | Yes | Own tracks | No | No |
| Enrol a student on a track | Yes | Own tracks | No | No |
| Read objectives on an enrolled track | Yes | Own tracks | Enrolled tracks | Read-only, for review |
| Start or resume a sitting | No | No | Enrolled, published assessment, one open sitting | No |
| See the answer key during a sitting | No | After submission | No | After submission, on the review screen |
| See live sittings and event timeline | Yes | Own tracks | Own sitting only | Yes |
| See a still taken when a camera signal fires | Yes | Own tracks | No | Yes |
| Watch the camera wall for an assigned cohort of open sittings | Yes | No | Own preview only | Yes |
| Raise a hand during an open sitting | No | No | Own sitting | No |
| Hear the hand-up shout and acknowledge it | Yes | On-screen notice only | Sees that it was seen | Yes |
| Confirm or dismiss a malpractice flag | Yes | Own tracks, recommend | No | Yes, decision stands |
| Change own password | Yes | Yes | Yes | Yes |

A teacher sees answer keys for tracks they manage. A student receives prompts and choices only. Grading happens on the server.

## 4. Platform

The first build is three running parts.

| Part | Choice | Job |
| --- | --- | --- |
| API | ASP.NET Core on .NET 10 | Roles, tracks, uploads, sittings, grading, integrity score |
| Browser | React with TypeScript (Vite) | One app. Screens and route guards follow the role table |
| Live channel | SignalR | Invigilator desk, score changes, forced submit when time runs out |
| Jobs | Hangfire | Expired sittings, rescoring, answer embeddings, similarity |
| Database | PostgreSQL with pgvector | Application data, Hangfire storage, and answer vectors in one server |
| Answer model | [BGE-M3](https://huggingface.co/BAAI/bge-m3), ONNX int8, in the API process | Semantic similarity of short answers. See section 8 |
| Camera model | MediaPipe Face Landmarker and Pose Landmarker, in the browser | Face count, head pose, and body posture during the sitting. See section 8 |

React talks to the API over HTTPS. The exam page sends answers and integrity events with ordinary requests, so a dropped socket does not lose an answer. SignalR is the fan-out: after the API stores an event, it tells the open desks. Hangfire does the work that must survive a restart and must not block the request.

Layout in the repository:

```text
backend/     ASP.NET Core solution: API, domain, Hangfire jobs, SignalR hub
frontend/    React application
docker-compose.yml
SYSTEM.md
```

In development the Vite server proxies `/api` and `/hubs` to the API. In production the API serves the built React app from the same origin, so the session cookie covers both REST and SignalR.

### SignalR

Hub path: `/hubs/desk`.

| Group | Who joins | Messages pushed |
| --- | --- | --- |
| `desk` | Invigilator, superadmin | Sitting started, score changed, flag opened, sitting submitted, hand raised, hand acknowledged |
| `track:{id}` | Owning teacher, superadmin | The same messages, limited to that track. A hand raise is an on-screen notice. This group does not play the shout |
| `sitting:{id}` | The candidate in that sitting | Time remaining, forced submit, hand acknowledged |

The candidate does not join `desk`. The desk does not receive keystrokes or a raw video frame. It receives the event kind, the time, and the current score.

The invigilator desk is a **camera wall**. The invigilator sees a cohort of open sittings at the same time, about 40 tiles: the candidate’s name, the track, and a small live picture of their face. A thousand candidates sitting together are split across those cohorts, so several invigilators are on duty. A superadmin can open any cohort. A teacher does not see the wall. Candidates never see one another’s cameras.

Each exam page sends that tile itself, about two frames a second, about 320 pixels wide, while its cohort is open on a desk. Only the latest frame is kept, in memory, and it is dropped when the sitting ends. Those frames are not written to PostgreSQL. The wall is not a recording. SignalR tells the desk which tile has a new frame. The malpractice stills in section 8 are the pictures that are kept for review.

The desk can be filtered to one track inside the cohort.

Choosing a tile opens that one candidate larger. The larger picture uses WebRTC. The hub carries only the call setup (offer, answer, network candidates). The exam page already shows **Your camera is on the invigilator desk** for the whole paper, because the wall is continuous. Opening the large view adds **An invigilator has opened your camera**, and that line goes away when the large view closes. The teacher still sees only the stills attached to flags on their own tracks.

### Hangfire

SQL storage is the same PostgreSQL database. The dashboard is available to superadmin only.

| Job | When | What it does |
| --- | --- | --- |
| Close expired sittings | Every minute | Submits a sitting whose duration plus grace has passed, then grades it |
| Score sitting | After a batch of events, and on submit | Recomputes the 0–100 score and opens or updates the flag |
| Embed answer | After a short answer is saved | Runs BGE-M3 and stores the vector |
| Compare short answers | After an embedding, and on submit | Cosine similarity against other answers to the same question |

Scoring is debounced (about five seconds of quiet) so a burst of focus events becomes one job, not one job per event.

### Messaging

RabbitMQ and Kafka are not part of this system, including a sitting of **1000 candidates at once**.

Hangfire is the durable queue: scoring, embeddings, similarity, and expiry sit in PostgreSQL and survive a restart. SignalR is the live fan-out: the desk, the camera-wall refresh, the hand-up shout, and forced submit. WebRTC carries one enlarged face. The API stores answers, events, and hand calls first, then notifies. A broker would sit on that path and add a service to run. The load at 1000 is the camera tiles and the number of API nodes, and a broker does not display a wall or score a paper.

What 1000 at once does require:

| Pressure | What carries it |
| --- | --- |
| Answers, hand calls, focus events | PostgreSQL. A thousand people saving answers is ordinary database work |
| Score, embed, and compare when a paper ends together | More Hangfire workers, still using PostgreSQL as the queue. Gesture checks stay in each browser |
| Live desk across more than one API process | A few API nodes behind a load balancer, and a Redis backplane so SignalR reaches every desk |
| Seeing the faces | Cohorts of about 40 tiles per invigilator. Wall frames stay in memory on the API, latest only |

Kafka earns a place only if a later system must keep a replayable copy of every sitting event for other products to consume on their own. RabbitMQ earns a place only if those Hangfire jobs have to leave PostgreSQL because the queue itself is too slow. Neither is required to run the thousand-person sitting.

## 5. Modules

Build these modules in this order. Later modules depend on earlier ones.

1. **Access.** Sign-in, sign-out, role checks, password change, audit of sensitive actions.
2. **People.** Superadmin creates users and can deactivate them. Deactivated users cannot sign in.
3. **Tracks.** Title, code, description, owning teacher, status (draft or open).
4. **Objectives.** Ordered learning objectives on a track. Single entry and bulk upload.
5. **Question bank.** Questions linked to a track and, when possible, to an objective. Single entry and bulk upload. Types in the first build: multiple choice (one correct option) and short written answer.
6. **Assessments.** A titled paper drawn from the bank, with a duration and a status of draft or published.
7. **Enrolment.** Students attached to a track. Only enrolled students can sit that track’s assessments.
8. **Sittings.** Consent, timed paper, save answers, submit, server-side grade, and a hand-up call for help.
9. **Integrity.** Exam-page events, consented camera signals, Hangfire scoring, BGE-M3 similarity, written reasons, flag queue.
10. **Review.** Invigilator (and the track’s teacher, and superadmin) read the timeline and set the flag to confirmed or dismissed, with a note. The live desk updates through SignalR.

## 6. Objectives, questions, and answers

### Objectives

Each objective has a short title, a description of what the candidate should be able to do, and an order on the track.

Bulk upload is plain text, one objective per line:

```text
Read a scenario and name the decision the role must make | Given a short case, the candidate states the decision and who is affected.
Apply numerical reasoning to simple budget figures | The candidate computes a total, a difference, or a percentage from given numbers.
```

The title and the description are separated by `|`. A line without `|` is stored as a title only.

### Questions

A question belongs to one track. It may point at one objective. Fields:

- type: `mcq` or `short`
- prompt
- for `mcq`: four options labelled A–D, and the correct letter
- for `short`: a model answer used for automatic marking
- marks (default 1)

Bulk upload is CSV:

```csv
type,objective,prompt,a,b,c,d,answer,marks
mcq,Numerical reasoning,A campaign budget is 400 and spend is 250. What remains?,"150","650","250","400",A,1
short,Professional conduct,Describe a conflict of interest in recruitment.,,,,A conflict exists when a personal interest could bias a hiring decision.,2
```

`objective` matches an existing objective title on that track. Unknown titles are reported on that row and the rest of the file still imports. The upload screen shows accepted rows and rejected rows.

Automatic marking:

- Multiple choice is correct only when the chosen letter matches the key.
- A short answer is correct when it matches the model answer after lower-casing and collapsing spaces, or when the meaningful words overlap enough with the model answer (words longer than three characters, overlap at least 60 percent).
- The teacher can override marks after submission.

## 7. Sitting flow

1. The student opens a published assessment on an enrolled track.
2. The screen states what the sitting records: leaving the exam window, copy, paste, time spent on each item, and the camera view. It says the invigilator sees this camera on a wall together with the other candidates who are sitting at the same time, with this candidate’s name on the tile. It names the gestures that raise a signal (face missing, a second face, head turned away, hand at the ear). The microphone is not requested. Keystrokes outside the paper are not recorded. The camera cannot start unless the browser shows its own permission prompt and the candidate allows it.
3. The student accepts that notice, then sees their own camera preview, a camera-on mark, and **Your camera is on the invigilator desk**. Those stay for the whole paper. The acceptance time is stored. Without acceptance and a live camera, the paper does not open. If the camera stops mid-paper, answering locks, the clock keeps running, and a camera-interrupted signal is stored. Answering resumes when the preview is live again.
4. The clock is fixed from the server start time plus the duration set on that paper. A refresh does not reset it. When 20 minutes remain, the paper shows a warm warning and keeps it on screen. When 5 minutes remain, the warm warning is replaced by a heavy warning. A paper shorter than 20 minutes never shows the warm warning. A paper that starts with 5 minutes or less opens in the heavy warning.
5. Answers save as the student moves through the paper.
6. Submit before the clock ends locks the sitting and awards the marks earned. When the clock reaches zero, the paper closes. If it was not submitted, the score is 0 and the candidate is out. Saved answers stay on the record and do not earn marks. SignalR tells that exam page to close.
7. One sitting exists per student per assessment. An unfinished sitting can be resumed. A submitted sitting cannot be retaken in this version.
8. The student then sees the score, and whether the sitting is clear or under review. The student does not see detection weights or other candidates’ answers.

### Hand up

The exam page keeps a **Raise hand** control on screen for the whole paper. The candidate uses it for anything: a question, illness, a technical problem, or something they cannot name. An optional one-line note can follow. The call does not wait for the note.

Raising a hand does not change the malpractice score. The camera does not treat a lifted arm as this call. Only the button starts it.

What happens:

1. The API stores the call and SignalR tells the open desks.
2. Every invigilator and superadmin desk that has joined `desk` plays a spoken shout: “Hand up. A candidate needs help.” The clip lives at `frontend/public/alerts/hand-up.mp3`. It repeats about every four seconds, at the player’s full volume, until someone acknowledges that call.
3. The same desks show a banner with the candidate, the track, and the note. That candidate’s tile flashes and moves to the front of the camera wall. Several hands at once share one repeating shout, a list on the banner, and a flashed tile each.
4. The owning teacher sees the banner on the track and does not hear the shout.
5. The candidate sees “Your hand is up.” When an invigilator or superadmin acknowledges, the shout stops and the candidate sees “The invigilator has seen your hand.”
6. The candidate can lower the hand before that. Lowering also stops the shout.

Browsers will not play sound until the desk has been clicked. Opening the live desk asks the invigilator to turn alert sound on. Until that click, the banner still appears, and the page keeps asking for the sound. The shout is the duty alert. It is not played on the candidate’s machine.

## 8. Malpractice review

The integrity check is an explainable score from 0 to 100 plus a list of reasons in plain language. Hangfire recomputes it after events settle, and again on submit. Each reason is a sentence produced from a stored signal. The text cannot add an allegation that has no row behind it.

### Models

Two models. Each does one job. Neither one decides that malpractice happened.

**Short answers: BGE-M3** ([BAAI/bge-m3](https://huggingface.co/BAAI/bge-m3)), run locally as ONNX int8 inside the .NET worker.

It is an embedding model: it turns a short answer into a vector. Hangfire then measures cosine similarity against other candidates’ answers to the same question. A close vector means the wording is semantically the same, including paraphrases that a word-overlap check would miss. That similarity is one signal in the score. It is not a verdict.

BGE-M3 is the right model here for four reasons:

- The hard detection problem in this product is “did two candidates give the same short answer,” including paraphrases. An embedding model is built for that. A chat model would write a fluent opinion and could invent a similarity that is not in the text.
- Candidate answers stay on this server. The ONNX file is loaded in-process through ONNX Runtime. Nothing is sent to a model vendor during a sitting.
- It covers many languages with one set of weights, which matters if a paper is not English-only. Published comparisons put it level with or ahead of hosted embedding APIs on multilingual retrieval, at a cost of a few points on English-only benchmarks ([memsearch embedding evaluation](https://zilliztech.github.io/memsearch/home/embedding-evaluation/), [local embedding notes](https://www.runlocalai.co/tasks/embeddings)).
- The int8 ONNX build is about 560 MB and runs on CPU. A recruitment desk does not need a GPU.

Starting rule, to be checked against the seed paper before a real recruitment: answers of at least 30 characters with cosine similarity of **0.88 or higher** raise the “similar short answers” signal for both sittings. The stored row keeps both answer ids, the cosine, and the model id `bge-m3-onnx-int8`.

A chat model is not in this build. A vision chat model is not used on the camera. If a later version adds a written briefing, that briefing may only restate the stored reasons, and it may not change the score.

**Camera gestures: MediaPipe**, running in the exam page ([Face Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker) and [Pose Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker)). The task files are hosted with the React app. The browser samples about two frames a second. Video is not uploaded as a recording. The page turns landmarks into the signals below and posts those signals. A reason says what the landmarks did (“head turned away for 8 seconds”), not a guess about why (“reading notes”).

MediaPipe’s named hand gestures (thumbs up, open palm, and similar) are not used. They are not malpractice gestures. Posture comes from face and body landmarks.

Starting rules, to be checked on the seed paper before a real recruitment. A signal fires only after the posture holds; a glance or a blink does not count.

| Posture | Starting rule |
| --- | --- |
| Face missing | No face for 5 seconds |
| Second face | Two or more faces for 3 seconds |
| Head turned away | Head yaw past about 30 degrees, or a strong pitch away from the screen, for 5 seconds |
| Hand at ear | A wrist stays beside an ear for 3 seconds |
| Camera interrupted | The preview stops or the permission is revoked |

The first time an episode meets a rule, the page stores one still, at most 640 pixels wide. The same posture cannot store another still for 60 seconds. Stills are kept for the review and deleted 30 days after the flag is confirmed or dismissed. The candidate is told, before the paper starts, that a still is kept when a camera signal fires.

### Signals

| Signal | What it means | Where it is computed |
| --- | --- | --- |
| Window leave | The exam window was hidden or blurred | API, from consented exam-page events |
| Paste | Content was pasted into an answer | API, from consented exam-page events |
| Copy | Content was copied from the paper | API, from consented exam-page events |
| Too fast | A multiple-choice item was answered in a few seconds, weighted more when the answer is also wrong | Hangfire, from saved timings |
| Shared wrong answers | Several wrong multiple-choice answers match another submitted sitting on the same paper | Hangfire, exact match on wrong keys |
| Similar short answers | BGE-M3 cosine similarity meets the threshold on a long short answer | Hangfire, pgvector |
| Face missing | No face in frame for the hold time | Exam page, MediaPipe Face Landmarker |
| Second face | More than one face for the hold time | Exam page, MediaPipe Face Landmarker |
| Head turned away | Head pose stays off the screen for the hold time | Exam page, Face Landmarker pose |
| Hand at ear | Wrist stays beside an ear for the hold time | Exam page, MediaPipe Pose Landmarker |
| Camera interrupted | The preview stopped or permission was revoked | Exam page |

Suggested bands:

| Score | Band | Flag |
| --- | --- | --- |
| 0–24 | Clear | No open flag |
| 25–49 | Watch | Open flag, low severity |
| 50–74 | Review | Open flag, medium severity |
| 75–100 | High | Open flag, high severity |

The invigilator sees the live desk (sittings in progress, current score, latest events) and the review screen (answers, key, timeline, reasons). Actions are **confirm** and **dismiss**, each with a note. Superadmin can take the same actions. The teacher sees flags on their own tracks and can add a note; the invigilator’s confirm or dismiss is the recorded decision.

Confirmed malpractice does not silently delete the score. The result stays visible with the decision beside it.

These signals are records of an exam the candidate consented to, with the camera preview visible to them for the whole paper. The microphone is not used. Nothing is captured outside the exam page, and the camera cannot be started without the browser permission prompt.

## 9. Records

PostgreSQL holds application data, Hangfire’s job tables, and answer vectors (`pgvector`).

- **User** — name, email, password hash, role, active, created time
- **Track** — title, code, description, teacher, status
- **Objective** — track, title, description, order
- **Question** — track, objective, type, prompt, options, answer key, marks, author
- **Assessment** — track, title, instructions, duration, status, author
- **Assessment item** — assessment, question, order
- **Enrolment** — track, student, time
- **Sitting** — assessment, student, start, consent time, camera consent time, submit time, score, max score, status, risk score, summary
- **Answer** — sitting, question, response, correct, marks awarded, seconds spent
- **Event** — sitting, kind, detail, time
- **Camera still** — sitting, event, image, captured time, delete-after time
- **Flag** — sitting, score, severity, reasons, status (`open`, `confirmed`, `dismissed`), reviewer, note
- **Answer vector** — answer, model id `bge-m3-onnx-int8`, vector, time
- **Similarity** — the two answers, cosine, model id, time
- **Hand call** — sitting, raised time, note, lowered time, acknowledged by, acknowledged time. This row is not an integrity event and does not feed the score
- **Audit** — actor, action, detail, time

Password storage is a salted hash (ASP.NET Core Identity). The browser holds an HTTP-only session cookie. State-changing requests carry the antiforgery token. SignalR uses the same cookie.

## 10. Screens

| Screen | Who |
| --- | --- |
| Sign in | Everyone |
| Overview | Each role sees its own summary |
| People | Superadmin |
| Audit | Superadmin |
| Track list and track page | Superadmin and teacher (edit); student (study); invigilator (read) |
| Objective and question upload | Superadmin and owning teacher |
| Assessment builder | Superadmin and owning teacher |
| Exam | Student, after consent, with their own camera preview and a Raise hand control |
| Result | Student (own); teacher and superadmin (track); invigilator (when reviewing) |
| Live desk | Invigilator and superadmin: camera wall of the assigned cohort, plus the hand-up shout. Owning teacher sees the hand notice and no cameras |
| Large camera | Invigilator and superadmin, one tile opened from the wall, with the candidate told on screen |
| Flag review | Invigilator, superadmin, owning teacher |
| Password | Signed-in user |

## 11. First build boundaries

Included:

- The four roles and the permission table above
- Tracks, objectives, question bank, CSV and line upload
- Published timed assessment, one sitting, server-side marking, teacher mark override
- Consent-based integrity score, with BGE-M3 as the similarity model
- Consented camera, MediaPipe posture signals, one still per episode, and a live camera wall of the invigilator’s cohort (about 40 faces)
- SignalR live desk, Hangfire scoring and expiry, confirm and dismiss
- Candidate hand-up, with a repeating spoken shout on the invigilator desk until the call is acknowledged

Left for a later version:

- Several papers per candidate with retakes
- Question types beyond multiple choice and short answer
- Email invitations and password reset by mail
- File storage for CVs or portfolios
- Microphone, room audio, or a stored video of the whole paper
- A chat or vision-chat model that restates the stored reasons. It must not replace BGE-M3, MediaPipe, or the score
- A single API process once 1000 candidates sit together. That size uses a few API nodes, a Redis backplane for SignalR, and extra Hangfire workers. RabbitMQ and Kafka stay out

## 12. Seed data for review

The first run creates one track, **Graduate Analyst Assessment**, with objectives, a short question bank, one published assessment, and these signed-in people (passwords are for the local demo and are changed after review):

| Role | Email | Password |
| --- | --- | --- |
| Superadmin | ada.okello@rms.local | Harbor-Admin-19 |
| Teacher | leila.nansubuga@rms.local | Harbor-Teach-19 |
| Invigilator | samuel.kato@rms.local | Harbor-Watch-19 |
| Student | jamal.ssebunya@rms.local | Harbor-Study-19 |
| Student | noor.akello@rms.local | Harbor-Study-19 |

Both students are enrolled on the sample track.

## 13. Acceptance for this specification

The specification is accepted when these statements are still true:

1. There are exactly four roles: superadmin, teacher, student, invigilator.
2. Teachers can load objectives and questions with answers, one by one and by upload.
3. Students on a track can read objectives and sit a published assessment.
4. A sitting records only the exam-page signals in section 8, and only after the student accepts the notice and the camera preview is live.
5. Short-answer similarity uses BGE-M3 locally. Camera posture uses MediaPipe in the browser. The score and the written reasons stay explainable from stored rows. A reason describes the posture, not a guessed motive.
6. An invigilator sees their cohort, about 40 open sittings, on a camera wall at once, can open one face larger, and can confirm or dismiss a flag, with a note. A thousand candidates are split across cohorts. Candidates do not see each other’s cameras.
7. A candidate can raise a hand during a sitting. Invigilator and superadmin desks play the spoken shout until the call is acknowledged. The call does not change the malpractice score.
8. Each paper has its own duration. At 20 minutes left the candidate sees a warm warning, at 5 minutes left a heavy warning, and at zero an unsubmitted paper scores 0.
9. Superadmins can manage people and read the audit log.
10. No role can open another role’s forbidden records from section 3.

## 14. Next step

The decision above is locked. Implement the modules in section 5 against it: ASP.NET Core API, React app, SignalR hub, the camera wall, WebRTC for one enlarged face, Hangfire jobs, PostgreSQL with pgvector, BGE-M3, and MediaPipe in the exam page. Check each role in the browser, including the camera consent screen, the candidate preview, the invigilator watching badge, and a hand-up that plays the spoken shout until it is acknowledged.
