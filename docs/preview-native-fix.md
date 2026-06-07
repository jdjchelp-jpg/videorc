# Native preview fix — render available sources (OBS-parity)

## Root cause (why the preview was laggy / permanently on PNG-polling)

The native CAMetalLayer preview can only display the compositor's GPU (IOSurface) frame. The
compositor only produced that frame when **every** visible source had a frame ready: in
`try_gpu_compose` (`crates/videorc-backend/src/compositor.rs`), each source did
`frame.ok_or_else(|| missing_source_reason)?`, so a **single** missing camera/screen frame
aborted the whole GPU compose to the CPU path. The CPU path produces **no IOSurface target** →
the preview handoff is **absent** → the native CAMetalLayer preview can never engage → it falls
back to **PNG-polling** (laggy, low-resolution). Confirmed by the preview-motion smoke logging
`Native preview falling back to image polling: … metalTargetIosurfaceId=absent`.

This is the exact OBS mismatch: **OBS always renders whatever sources are available; Videorc
discarded the whole frame if one source wasn't ready.** The native present path itself is fully
implemented and works — it was simply never being handed a GPU frame.

## The fix

`try_gpu_compose` now **skips** a source whose frame (or placement) isn't ready — rendering the
sources that *are* — and composes the (TV-black) background even when all are missing, so the
IOSurface target, and therefore the native-preview handoff, **always** flow. This matches OBS,
which keeps presenting the last good scene.

Guarded by deterministic Metal tests (`cargo test -p videorc-backend metal_compose`):

- `metal_compose_renders_available_sources_when_one_frame_is_missing` — camera + screen scene
  with a missing screen frame still composes on Metal and produces an IOSurface target.
- `metal_compose_produces_target_even_when_all_source_frames_missing` — even with no source
  frames, a black frame with an IOSurface target is produced.

Verified: `cargo test -p videorc-backend` (466 pass), `cargo clippy -D warnings`.

## On-device validation (operator)

`pnpm dev`, preview a real camera + screen:

- Studio badge should flip **Fallback → Live**.
- Preview should be **full-resolution** and **real-time** (no rubber-banding), idle and while
  recording.
- ⌘K → Diagnostics: `previewTransport = native-surface`, `previewSurfaceBacking = cametal-layer`,
  `compositorBackend = metal`, image-poll count flat at 0.

If a *specific* source shows black (its frames never reach the compositor), that is a separate
source-feed wiring issue to chase next — but the native preview will now **engage** regardless,
which it never did before.
