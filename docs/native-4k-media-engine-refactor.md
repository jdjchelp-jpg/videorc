# Native 4K Media Engine Refactor

Status: active media-engine plan.

The active product direction is the native 4K OBS-class media engine refactor described in the Obsidian plan:

```text
/Users/orcdev/Documents/Obsidian Vault/plans/planned/2026-06-08 - Videorc Native 4K OBS Class Media Engine Refactor Plan.md
```

The execution slices live in:

```text
/Users/orcdev/Documents/Obsidian Vault/plans/planned/2026-06-08 - Videorc Native 4K OBS Class Media Engine Refactor Slices.md
```

## Locked Product Target

- 4K30 local recording is required.
- Livestreaming is platform-safe 1080p for v1.
- 4K recording plus 1080p streaming must work simultaneously through separate Metal output targets and separate VideoToolbox encoders.
- Preview optimizes for currentness: p95 source-to-present under 50 ms and p99 under 100 ms.
- No user-facing legacy media fallback.
- Custom engine only; do not use libobs or fork OBS.
- macOS is first; Windows is planned but not blocking.
- Final acceptance requires dev build, packaged clean-machine build, automated gates, and user by-eye OBS comparison.

## Feature Freeze

Non-media feature work is frozen while this plan is active. Work should either:

- prove the current media path,
- diagnose a media-path failure,
- move the product toward the native media engine target, or
- explicitly port or cut a committed v1 feature from the new engine surface.

## Legacy Fallback Policy

Raw-YUV, image-polling, FFmpeg-filter, and other legacy media paths may remain only as developer/debug fallbacks while the refactor is underway. They must not remain normal user-facing product paths after the new engine is accepted.

## First Internal Gate

The first internal checkpoint is:

```text
4K30 screen + camera + mic
  -> Metal compositor
  -> native CAMetalLayer preview
  -> VideoToolbox H.264 encode
  -> local MKV recording
  -> optional MP4 remux
```

Passing that checkpoint is not product completion. The product is not fixed until the full committed v1 proof passes.
