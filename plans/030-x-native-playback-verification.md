# Plan 030: X native playback verification + source health

> **Executor instructions**: This plan hardens the native X Livestream path
> against the failure observed on 2026-07-08: the whole Videorc pipeline
> worked (OAuth, prepare, create, publish, tweet, RTMP push at 6 Mbps for
> 108 s, END), X reported the broadcast `RUNNING` with a viewer attached —
> and that viewer saw an infinite spinner. X's transcoder produced no
> playable output and later measured the source's stream attributes as all
> zeros. Videorc gave the broadcaster no signal that anything was wrong.
>
> We cannot fix X's transcoder. What we CAN fix: **detect unwatchable
> broadcasts within seconds**, **stop trusting broken sources**, and **make
> every X lifecycle step observable** so the next support bundle answers
> these questions on its own.
>
> **Incident evidence (all via signed X API reads, 2026-07-08)**:
> - Source `pb3wpieksw1x` ("Videorc Primary Encoder", eu-west-3, created by
>   Videorc's `POST /sources`): `stream_attributes` measured all zeros after
>   two healthy ~6 Mbps pushes; `recommended_configuration` anomalously low
>   (960x540 @ 800 kbps vs the normal 1280x720 @ 4 Mbps); broadcasts bound
>   to it spin forever for viewers; `available_for_replay: false`.
> - Source `df82…` ("Videorc", same region): received the SAME encoder
>   output at 08:39Z the same day → X measured it healthy (5.98 Mbps, 1080p,
>   29.98 fps, 2.0 s GOP, warnings only), broadcast watchable,
>   `available_for_replay: true`.
> - Conclusion: identical bytes, different source objects, opposite
>   outcomes. Encoding is NOT the problem; the API-created source object is.
> - `available_for_replay` is an OUTCOME (X transcoded something), not a
>   request parameter. Do not chase a "replay flag".
>
> **Drift check (run first)**: `git status --short --branch`; inspect
> `crates/videorc-backend/src/x_live.rs`, `src/x_oauth1.rs`, `src/main.rs`
> (x handlers ~line 1690+), `src/live_chat.rs`,
> `apps/desktop/src/renderer/src/hooks/use-studio.tsx`
> (`activatePreparedXBroadcasts`, `prepareOauthTargetsForGoLive`),
> `apps/desktop/src/renderer/src/components/tabs/streaming-tab.tsx`, and
> `docs/live-chat-live-smoke-checklist.md`. Baseline commit `eef5cb0c`.

## Status

- **Priority**: P0 — native X live ships in 0.9.20 and silently streams to
  nobody when X's transcode fails; the flagship partnership feature looks
  broken to every affected user.
- **Effort**: M-L.
- **Risk**: MEDIUM — new X API calls and lifecycle logging are additive;
  the source-selection change touches the go-live path and needs the
  full recording-studio gates.
- **Depends on**: Plans 028/029 (shipped in 0.9.20). Plan 026 (A/V desync)
  is INDEPENDENT — do not conflate; desync exists even on watchable
  broadcasts.
- **Category**: provider integration, diagnostics, go-live UX.
- **Planned at**: commit `eef5cb0c`, 2026-07-08.

## Goal

A Videorc user going live on X either (a) is verifiably watchable within
~30 seconds of publish, or (b) gets told loudly, in-session, that viewers
cannot see them — with the failing source automatically retired so the next
Go Live uses a fresh one. Every X lifecycle step lands in the session log
and support bundle.

## Non-goals

- Fixing X-side provisioning (partner-manager escalation is an owner
  action, fed by the evidence this plan produces).
- Same-session automatic re-publish onto a new source (ffmpeg is already
  pushing to the bound ingest; restarting the leg mid-session is its own
  risky project — v1 alerts and repairs for the NEXT session).
- Plan 026's encoder-bridge timeline fix.

## Slices

### S1 — X lifecycle events in session logs (observability foundation)

The 10:20Z incident bundle contained ZERO X lifecycle information: the
backend logs nothing for prepare/create/publish/end, and FFmpeg progress
lines (logged at `warn`) flushed the 200-entry ring buffer in ~60 s.

- Backend: emit session log entries (same store the bundle exports) for
  every X lifecycle step, success AND failure:
  `x-source-prepared` (source id, region, reused-vs-created),
  `x-broadcast-created` (broadcast id), `x-broadcast-published` (share URL,
  tweet outcome), `x-broadcast-ended`, and `x-*-failed` with the API error
  detail. The publish/prepare/end handlers in `main.rs` currently return
  errors only over the websocket — hook the session-log writer there.
- Demote FFmpeg progress lines out of the ring buffer: progress/stat lines
  (`frame=`, `bitrate=`, `out_time=`, `speed=`, `progress=`…) go to `debug`
  tracing only; real FFmpeg warnings/errors keep `warn`. The ring buffer
  must survive a 2-hour session with its useful content intact.
- Renderer: `activatePreparedXBroadcasts` failure currently = transient
  toast only. Keep the toast, but the durable record now exists backend-side.

**Done when**: a record+stream X session's support bundle shows the full X
lifecycle (or its failure) in `sessions[].sessionLogs`, and a 5-minute
session no longer evicts non-FFmpeg entries from `logs`.

### S2 — Post-publish watchability probe

The create/publish responses include `video_access.hls_url`. A broadcast
that X is actually transcoding serves an HLS playlist with media segments
within seconds; the broken one serves nothing usable — that is exactly what
viewers' spinners meant.

- Backend: after a successful publish, spawn a bounded probe task: poll the
  HLS playlist (follow one level to a media playlist if master) every ~5 s
  for up to ~45 s, looking for at least one media segment. No video
  download, playlist text only.
- Outcome events (session log + health event + renderer event):
  - success → `x-playback-verified` ("Viewers can watch your X broadcast."),
    target status message gains the share URL, state stays `live`.
  - failure → `x-playback-unavailable` at ERROR level: "X is not producing
    playback for this broadcast — viewers see a loading spinner. Your local
    recording is unaffected." Target status → `warning`; toast with the same
    message; the source is marked unhealthy (S3).
- Record the probe result in session `finalDiagnostics`
  (`xPlaybackVerified: bool`, `xPlaybackProbeMs`).
- Respect shutdown: probe aborts when the session stops first.

**Done when**: unit tests cover playlist-parse/verdict logic with stub HLS
servers (healthy, empty-playlist, 4xx); a live session against the broken
source shape produces the ERROR event within 60 s of publish.

### S3 — Source health model + selection

`prepare_x_stream_source` currently trusts name+region match or creates a
new source, and stores only the stream key. It reused `pb3wpieksw1x`
forever, ruining every subsequent session.

- Persist per-source health in the backend DB (new small table or the
  existing settings store): `source_id`, `region`, `last_playback_ok_at`,
  `consecutive_failures`, `retired: bool`.
- S2's probe outcome updates it: success resets failures; failure
  increments; at 1 failure the source is `retired` (aggressive on purpose —
  a source that spun viewers once is not worth a second 2-minute funeral).
- `prepare_x_stream_source` selection order becomes:
  1. env override (`VIDEORC_X_LIVESTREAM_SOURCE_ID`) — unchanged, smoke rig;
  2. any non-retired source owned by the user in the target region whose
     X-side `stream_attributes` show a real prior stream (nonzero
     `video_bitrate`), preferring the most recently verified — this makes
     Videorc adopt known-good sources like `df82…` even if it didn't
     create them;
  3. any non-retired name+region match (today's behavior);
  4. create a fresh source. Never a retired one.
- When a retired source would have been reused, DELETE it on X
  (`DELETE /sources/:id`, only when not bound to an active broadcast) and
  log `x-source-retired` with the reason. Deleting keeps the per-user
  source quota clean.
- Surface X's `compatibility_info` errors/warnings for the chosen source as
  a session log entry after ingest starts (first `is_stream_active` poll
  already fetches the source — reuse that response).

**Done when**: unit tests cover the selection ladder (env, healthy-adopt,
name-match, create, retired-delete) with injected source lists; a session
whose probe fails causes the NEXT prepare to delete that source and pick or
create another, visible in session logs.

### S4 — In-session UX for an unwatchable broadcast

- Streaming tab X target row: while live, show the share URL (click to
  open) once published; if S2 reports failure, flip the row to a warning
  state with the plain-language message and a "details" pointer to the
  session log entry.
- Go Live confirmation copy unchanged; this slice is strictly the live
  status surface. shadcn components only; follow
  `.claude/skills/videorc-design/SKILL.md`.

**Done when**: desktop unit tests cover the new status rendering states;
by-eye on a stub-backed session shows share-URL chip and the warning flip.

### S5 — Owner remediation + escalation run (external, owner-driven)

Not code — the live experiment this plan's code makes safe to run:

1. On a build with S1–S3, run a real X session. Expected: prepare retires
   `pb3wpieksw1x` (its probe failure will be recorded on the first S2 run —
   or pre-seed it as retired via the health store), adopts `df82…` or
   creates a fresh source, and S2 verifies playback from a second account.
2. If a FRESHLY created source also fails the probe → the problem is
   X-side provisioning of API-created sources for this app/account. Send
   the partner manager: source ids (`pb3wpieksw1x` + the fresh one),
   broadcast ids, timestamps, and the zeros-vs-healthy `stream_attributes`
   contrast. Videorc's fallback until resolved: adopt Producer-created
   sources (selection rung 2 already does this).
3. Close plan 026's real-stream A/V check on the same session if watchable.

## Verification

- `cargo fmt --check --all`, `cargo clippy -p videorc-backend -- -D warnings`,
  `cargo test -p videorc-backend` (new: probe verdicts, selection ladder,
  lifecycle logging).
- `pnpm typecheck`, `pnpm lint`, `pnpm --filter @videorc/desktop test`.
- Recording-studio gate: `pnpm smoke:recording-studio` (go-live path
  touched); `pnpm smoke:oauth-guards` (X capability/preflight shapes).
- Support-bundle proof: generate a bundle after a stub-backed X session and
  assert the lifecycle entries exist (extend the existing support-bundle
  test if one covers session logs).
- Live acceptance: S5 with a second account watching — the ONLY test that
  proves the actual outcome this plan exists for.

## Open questions (do not block S1–S4)

- Why did X provision `pb3wpieksw1x` with a 960x540/800 kbps recommended
  configuration and no working transcode? Partner-manager question (S5).
- Should stream settings offer an "X-recommended (720p/4 Mbps)" preset?
  X only WARNS at 1080p/6 Mbps and `df82…` proved it transcodes fine, so
  this is a nice-to-have, not part of the fix.
