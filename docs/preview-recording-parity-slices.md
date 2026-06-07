# Smooth Preview + Correct Recording — Execution Slices

Execution tracker for the remaining work on the shared-compositor preview/recording path.
Real goal (per the 2026-06-07 pivot): **a smooth live preview and a correct recording**.
OBS side-by-side parity is no longer the goal — it survives only as an optional comparison
tool. Perceptual items are judged **by eye on a moving clip**, not by fps/latency numbers
alone (those metrics are blind to judder).

The originating plan (`~/Documents/Obsidian Vault/plans/planned/2026-06-07 - Videorc Real
Time Preview Recording Parity Plan.md`) is ~85% implemented already; these slices cut only
the remaining work.

## Status

| # | Slice | Status | Gate |
|---|---|---|---|
| 1 | Native preview is the confirmed live default | ✅ already wired as default | on-device eye-check (user) |
| 2 | Hardware VideoToolbox zero-copy = default recorder | ⏳ prepared, default-flip needs decision | regression risk + on-device (user) |
| 3 | "Preparing recording…" UX + copyable preflight report | ⬜ todo | deterministic + smoke |
| 4 | Studio health badge + degraded indicator | ✅ done | deterministic (vitest + typecheck + build) |
| 5 | Developer-only synthetic camera source (selectable) | ⬜ todo | deterministic (cargo test) |
| 6 | ProgramFrame contract + parity check (hardening) | ⬜ todo | deterministic (test:scripts) |
| 7 | Visual/timing parity fixtures (hardening) | ⬜ todo | deterministic (test:scripts) |
| 8 | Real-camera product acceptance (closes plan) | ⬜ todo | real-camera by-eye (user) |

Legend: ✅ done · ⏳ in progress / blocked · ⬜ todo.

## Verification policy for this run

- **Deterministic, non-intrusive gates run by the agent:** `pnpm typecheck`, `pnpm build`,
  `cargo test -p videorc-backend`, `cargo clippy -p videorc-backend -- -D warnings`,
  `pnpm test:scripts`.
- **Intrusive / on-device gates deferred to the operator:** the app-launching smokes
  (`pnpm smoke:*`), the real-source baselines (`pnpm baseline:real-source --gate`), and every
  by-eye check. The agent does not autonomously launch Electron windows, trigger capture
  permission prompts, or record files on the live desktop.

## Slice 1 — Native preview is the confirmed live default ✅

No code change required. `ensureNativePreviewRealSurfaceDriver()`
(`apps/desktop/src/main/index.ts:1465`) already makes the native CAMetalLayer preview the
default on macOS with **no env flags**: it auto-spawns the Rust `native_preview_host_helper`
(dev: `cargo run … --bin native_preview_host_helper`; packaged: bundled binary). PNG frame
polling runs only as bootstrap/fallback and is suppressed
(`setNativePreviewSurfaceFramePollingSuppressed(true)`) once the native surface presents.

**Operator gate (by eye):**

1. `pnpm dev`, open Studio with a real camera.
2. Diagnostics tab: confirm `previewTransport = native-surface`,
   `previewSurfaceBacking = cametal-layer`, and `previewImagePollCounts` flat at **0** in
   steady state.
3. Wave a hand fast — preview keeps up, no rubber-banding — both idle and while recording.

## Slice 2 — Hardware VideoToolbox zero-copy = default recorder ⏳

The flip point is one branch in `parse_encoder_bridge_video_output`
(`crates/videorc-backend/src/recording.rs:3201`): with no env set it returns
`RawYuv420p` (CPU FFmpeg). The proven-on-device hardware path is
`VIDEORC_ENCODER_BRIDGE_VIDEO_OUTPUT=videotoolbox-h264-mpegts`.

**Why this isn't a blind one-liner:** in any VideoToolbox mode the compositor sets
`publish_yuv_frames: false` (`recording.rs:506`) and publishes Metal-target-only frames.
The GPU compositor falls back to CPU for **uncached image sources** (the Screens overlay
library is a shipped feature). A naive default-flip could therefore starve the encoder on
image-overlay scenes and produce a broken recording — exactly the class of regression the
plan reserves for on-device validation.

Decision pending with the operator (see chat). Options: safe-conditional flip (VT only when
the scene/hardware guarantee Metal targets, auto-fallback to raw otherwise), unconditional
flip + revert-if-bad, or operator flips after their own real-camera gate.

**Operator gate:** `pnpm baseline:real-source --gate` passes with
`encode backend = hardware-videotoolbox`, `zero-copy > 0`, `raw/Metal copied = 0`, startup
PASS, final-file PASS, encoder speed ≥ 0.98×; plus a by-eye smooth 60s playback that
includes an image-overlay scene.

## Slice 4 — Studio health badge ✅

Added a compact preview-health badge to the Studio action bar plus a degraded strip. The
derivation is extracted to `apps/desktop/src/renderer/src/lib/studio-health.ts` and
unit-tested (`studio-health.test.ts`, 9 cases). Degraded **"Preview may not match
recording"** triggers on compositor CPU fallback (`compositorBackend === 'cpu-fallback'`, or
fallback frames mid-recording); warns on preview present latency over the live budget
(p95 75 ms / p99 150 ms) or an HTTP image-polling transport; otherwise Live/Ready. Verified
deterministically: `pnpm --filter @videorc/desktop test` (40 pass), `pnpm typecheck`,
`pnpm build`. Operator visual check: `VIDEORC_METAL_COMPOSITOR=0 pnpm dev` → badge reads
**Degraded** with the strip.

## Slice 8 — Real-camera product acceptance

Run `pnpm baseline:real-source --gate` at 1080p30 / 1440p30 + a 10-min endurance run, then
the manual by-eye pass (hand-wave idle + recording, scroll text, move the camera overlay
mid-recording, clap once; confirm the file matches the preview and mouth/voice sync). Record
the outcome in a dated note under `docs/acceptance/`. Only the operator can close this.
