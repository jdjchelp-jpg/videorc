//! Live captions: taps microphone PCM off the native audio pipeline, slices it
//! into ~3s 16kHz mono WAV chunks, transcribes each through videorc-web
//! (`/api/ai/captions/chunks` → AI Gateway grok-stt) and broadcasts transcript
//! events to renderer clients. Chunked by design (P0 spike 2026-07-02: gateway
//! realtime tokens need a Gateway API key that is not provisioned); the session
//! loop is the transport seam where a streaming socket can replace chunking.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use anyhow::{Result, bail};
use serde::Serialize;
use tokio::sync::Mutex;
use tokio::sync::mpsc;

use crate::audio::AudioFrame;
use crate::state::AppState;
use crate::videorc_api::{CaptionChunkFailure, VideorcApiClient};

pub const CAPTION_SAMPLE_RATE: u32 = 16_000;
pub const CAPTION_CHUNK_SECONDS: f64 = 3.0;
/// Bounded frame queue between the realtime audio thread and the session task.
/// At ~93 CoreAudio callbacks/s, 256 frames ≈ 2.7s of cushion.
const TAP_CHANNEL_CAPACITY: usize = 256;
/// Consecutive transient upload failures before the session gives up.
const MAX_CONSECUTIVE_FAILURES: u32 = 5;

// ---------------------------------------------------------------------------
// Tap: the audio FIFO writer thread offers every mic frame here. Fast path is
// one relaxed atomic load when captions are off; when on, a non-blocking
// try_send that drops the frame rather than ever stalling the audio thread.
// ---------------------------------------------------------------------------

static TAP_ACTIVE: AtomicBool = AtomicBool::new(false);
static TAP: std::sync::Mutex<Option<mpsc::Sender<AudioFrame>>> = std::sync::Mutex::new(None);

pub fn offer_caption_frame(frame: &AudioFrame) {
    if !TAP_ACTIVE.load(Ordering::Relaxed) {
        return;
    }
    let Ok(guard) = TAP.try_lock() else {
        return;
    };
    if let Some(sender) = guard.as_ref() {
        let _ = sender.try_send(frame.clone());
    }
}

fn install_tap() -> mpsc::Receiver<AudioFrame> {
    let (sender, receiver) = mpsc::channel(TAP_CHANNEL_CAPACITY);
    *TAP.lock().expect("caption tap lock") = Some(sender);
    TAP_ACTIVE.store(true, Ordering::Relaxed);
    receiver
}

fn remove_tap() {
    TAP_ACTIVE.store(false, Ordering::Relaxed);
    *TAP.lock().expect("caption tap lock") = None;
}

// ---------------------------------------------------------------------------
// DSP: 48kHz interleaved f32 (mono or stereo) → 16kHz mono s16le.
// ---------------------------------------------------------------------------

/// Downmix interleaved samples to mono and decimate 3:1 (48kHz → 16kHz) with a
/// 3-sample boxcar average as a cheap anti-alias low-pass — speech-grade, which
/// is all a caption model needs. Returns an empty vec for unsupported input
/// (only 48kHz, 1–2 channels are produced by the native pipeline).
pub fn downmix_resample_to_16k_mono(samples: &[f32], channels: u16, sample_rate: u32) -> Vec<i16> {
    if sample_rate != 48_000 || !(1..=2).contains(&channels) {
        return Vec::new();
    }
    let channels = usize::from(channels);
    let mono: Vec<f32> = samples
        .chunks_exact(channels)
        .map(|frame| frame.iter().sum::<f32>() / channels as f32)
        .collect();
    mono.chunks_exact(3)
        .map(|window| {
            let value = (window[0] + window[1] + window[2]) / 3.0;
            (value.clamp(-1.0, 1.0) * f32::from(i16::MAX)) as i16
        })
        .collect()
}

/// Minimal 44-byte-header PCM WAV (16kHz mono s16le) — what the caption route
/// uploads as `audio/wav`.
pub fn encode_wav_16k_mono(samples: &[i16]) -> Vec<u8> {
    let data_len = (samples.len() * 2) as u32;
    let byte_rate = CAPTION_SAMPLE_RATE * 2;
    let mut wav = Vec::with_capacity(44 + samples.len() * 2);
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + data_len).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16_u32.to_le_bytes());
    wav.extend_from_slice(&1_u16.to_le_bytes()); // PCM
    wav.extend_from_slice(&1_u16.to_le_bytes()); // mono
    wav.extend_from_slice(&CAPTION_SAMPLE_RATE.to_le_bytes());
    wav.extend_from_slice(&byte_rate.to_le_bytes());
    wav.extend_from_slice(&2_u16.to_le_bytes()); // block align
    wav.extend_from_slice(&16_u16.to_le_bytes()); // bits per sample
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&data_len.to_le_bytes());
    for sample in samples {
        wav.extend_from_slice(&sample.to_le_bytes());
    }
    wav
}

// ---------------------------------------------------------------------------
// Burn-in overlay: a pre-rendered caption bar (RGBA) the compositor composites
// into the STREAM leg. Session-transient — set/cleared by the renderer as
// captions flow; never persisted, never part of scene config. Fail-safe per
// the background rule: bad image data is rejected and the previous overlay
// (if any) stays; a session is never touched by overlay errors.
// ---------------------------------------------------------------------------

/// Max decoded dimensions / encoded bytes for one caption bar. A 4K-width
/// two-line bar is ~3840×400; these caps leave headroom without letting the
/// RPC become an arbitrary-image firehose.
const OVERLAY_MAX_WIDTH: u32 = 4096;
const OVERLAY_MAX_HEIGHT: u32 = 2048;
const OVERLAY_MAX_ENCODED_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CaptionOverlayPosition {
    Top,
    Bottom,
}

#[derive(Clone)]
pub struct CaptionOverlay {
    pub rgba: Arc<Vec<u8>>,
    pub width: u32,
    pub height: u32,
    pub position: CaptionOverlayPosition,
    pub revision: u64,
}

pub type CaptionOverlaySlot = Arc<std::sync::Mutex<Option<CaptionOverlay>>>;

pub fn new_caption_overlay_slot() -> CaptionOverlaySlot {
    Arc::new(std::sync::Mutex::new(None))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptionOverlayInfo {
    pub active: bool,
    pub width: u32,
    pub height: u32,
    pub revision: u64,
}

/// Decode + validate a caption bar and install it in the overlay slot.
/// Rejects oversized or undecodable payloads without touching the current
/// overlay. Pure with respect to the slot — unit-tested directly.
pub fn install_caption_overlay(
    slot: &CaptionOverlaySlot,
    png_base64: &str,
    position: CaptionOverlayPosition,
) -> Result<CaptionOverlayInfo> {
    use base64::Engine as _;

    let encoded_len = png_base64.len();
    if encoded_len == 0 || encoded_len > (OVERLAY_MAX_ENCODED_BYTES / 3) * 4 + 4 {
        bail!("Caption overlay payload is empty or too large.");
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(png_base64.trim())
        .map_err(|_| anyhow::anyhow!("Caption overlay payload is not valid base64."))?;
    if bytes.len() > OVERLAY_MAX_ENCODED_BYTES {
        bail!("Caption overlay image is too large.");
    }
    let image = image::load_from_memory(&bytes)
        .map_err(|_| anyhow::anyhow!("Caption overlay image could not be decoded."))?
        .into_rgba8();
    let (width, height) = image.dimensions();
    if width == 0 || height == 0 || width > OVERLAY_MAX_WIDTH || height > OVERLAY_MAX_HEIGHT {
        bail!("Caption overlay dimensions are out of range ({width}x{height}).");
    }

    let mut guard = slot.lock().expect("caption overlay lock");
    let revision = guard.as_ref().map_or(1, |overlay| overlay.revision + 1);
    *guard = Some(CaptionOverlay {
        rgba: Arc::new(image.into_raw()),
        width,
        height,
        position,
        revision,
    });
    Ok(CaptionOverlayInfo {
        active: true,
        width,
        height,
        revision,
    })
}

pub fn clear_caption_overlay(slot: &CaptionOverlaySlot) -> CaptionOverlayInfo {
    let mut guard = slot.lock().expect("caption overlay lock");
    let revision = guard.as_ref().map_or(0, |overlay| overlay.revision);
    *guard = None;
    CaptionOverlayInfo {
        active: false,
        width: 0,
        height: 0,
        revision,
    }
}

pub fn current_caption_overlay(slot: &CaptionOverlaySlot) -> Option<CaptionOverlay> {
    slot.lock().expect("caption overlay lock").clone()
}

// ---------------------------------------------------------------------------
// Session state machine.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum CaptionsState {
    Idle,
    Live,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptionsStatus {
    pub state: CaptionsState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remaining_seconds: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_client_id: Option<String>,
}

impl CaptionsStatus {
    pub fn idle() -> Self {
        Self {
            state: CaptionsState::Idle,
            message: None,
            remaining_seconds: None,
            session_client_id: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptionsUpdate {
    pub session_client_id: String,
    pub seq: u64,
    pub text: String,
    pub chunk_seconds: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remaining_seconds: Option<u64>,
}

#[derive(Default)]
pub struct CaptionsCoordinator {
    task: Option<tokio::task::JoinHandle<()>>,
    stop: Option<Arc<AtomicBool>>,
    status: Option<CaptionsStatus>,
}

pub type CaptionsSlot = Arc<Mutex<CaptionsCoordinator>>;

pub fn new_captions_slot() -> CaptionsSlot {
    Arc::new(Mutex::new(CaptionsCoordinator::default()))
}

pub async fn captions_status(state: &AppState) -> CaptionsStatus {
    state
        .captions
        .lock()
        .await
        .status
        .clone()
        .unwrap_or_else(CaptionsStatus::idle)
}

fn set_status(state: &AppState, coordinator: &mut CaptionsCoordinator, status: CaptionsStatus) {
    coordinator.status = Some(status.clone());
    state.emit_event("captions.status", status);
}

/// Fire-and-forget status update from inside the session task (which cannot
/// hold the coordinator lock while the RPC handler might).
async fn publish_status(state: &AppState, status: CaptionsStatus) {
    let mut coordinator = state.captions.lock().await;
    coordinator.status = Some(status.clone());
    drop(coordinator);
    state.emit_event("captions.status", status);
}

pub async fn start_captions(state: &AppState, language: Option<String>) -> Result<CaptionsStatus> {
    let Some(bearer) = crate::account::stored_session_token() else {
        bail!("Sign in to use live captions.");
    };
    let client = VideorcApiClient::new()?;

    let mut coordinator = state.captions.lock().await;
    if let (Some(task), Some(status)) = (coordinator.task.as_ref(), coordinator.status.as_ref()) {
        if !task.is_finished() && status.state == CaptionsState::Live {
            return Ok(status.clone());
        }
    }
    if let Some(task) = coordinator.task.take() {
        task.abort();
    }
    remove_tap();

    let session_client_id = format!("captions-{}", uuid::Uuid::new_v4().simple());
    let stop = Arc::new(AtomicBool::new(false));
    let receiver = install_tap();
    let status = CaptionsStatus {
        state: CaptionsState::Live,
        message: None,
        remaining_seconds: None,
        session_client_id: Some(session_client_id.clone()),
    };
    set_status(state, &mut coordinator, status.clone());

    let task_state = state.clone();
    let task_stop = stop.clone();
    coordinator.task = Some(tokio::spawn(run_caption_session(CaptionSession {
        bearer,
        client,
        language,
        receiver,
        session_client_id,
        state: task_state,
        stop: task_stop,
    })));
    coordinator.stop = Some(stop);

    Ok(status)
}

pub async fn stop_captions(state: &AppState) -> CaptionsStatus {
    let mut coordinator = state.captions.lock().await;
    if let Some(stop) = coordinator.stop.take() {
        stop.store(true, Ordering::Relaxed);
    }
    if let Some(task) = coordinator.task.take() {
        task.abort();
    }
    remove_tap();
    let status = CaptionsStatus::idle();
    set_status(state, &mut coordinator, status.clone());
    status
}

struct CaptionSession {
    bearer: String,
    client: VideorcApiClient,
    language: Option<String>,
    receiver: mpsc::Receiver<AudioFrame>,
    session_client_id: String,
    state: AppState,
    stop: Arc<AtomicBool>,
}

async fn run_caption_session(mut session: CaptionSession) {
    let chunk_samples = (f64::from(CAPTION_SAMPLE_RATE) * CAPTION_CHUNK_SECONDS) as usize;
    let mut pcm: Vec<i16> = Vec::with_capacity(chunk_samples * 2);
    let mut seq = 0_u64;
    let mut consecutive_failures = 0_u32;

    loop {
        if session.stop.load(Ordering::Relaxed) {
            break;
        }
        let Some(frame) = session.receiver.recv().await else {
            break; // tap removed
        };
        pcm.extend(downmix_resample_to_16k_mono(
            &frame.samples,
            frame.channels,
            frame.sample_rate,
        ));
        if pcm.len() < chunk_samples {
            continue;
        }

        let chunk: Vec<i16> = pcm.drain(..chunk_samples).collect();
        let wav = encode_wav_16k_mono(&chunk);
        seq += 1;

        match session
            .client
            .transcribe_caption_chunk(
                &session.bearer,
                &session.session_client_id,
                wav,
                session.language.as_deref(),
            )
            .await
        {
            Ok(response) => {
                consecutive_failures = 0;
                if !response.text.trim().is_empty() {
                    session.state.emit_event(
                        "captions.update",
                        CaptionsUpdate {
                            session_client_id: session.session_client_id.clone(),
                            seq,
                            text: response.text.trim().to_string(),
                            chunk_seconds: response.chunk_seconds,
                            remaining_seconds: Some(response.remaining_seconds),
                        },
                    );
                }
            }
            Err(CaptionChunkFailure::Terminal { code, message }) => {
                tracing::warn!("Live captions stopped ({code}): {message}");
                remove_tap();
                publish_status(
                    &session.state,
                    CaptionsStatus {
                        state: CaptionsState::Error,
                        message: Some(message),
                        remaining_seconds: None,
                        session_client_id: Some(session.session_client_id.clone()),
                    },
                )
                .await;
                return;
            }
            Err(CaptionChunkFailure::Transient { message }) => {
                consecutive_failures += 1;
                tracing::warn!(
                    "Live caption chunk failed ({consecutive_failures}/{MAX_CONSECUTIVE_FAILURES}): {message}"
                );
                if consecutive_failures >= MAX_CONSECUTIVE_FAILURES {
                    remove_tap();
                    publish_status(
                        &session.state,
                        CaptionsStatus {
                            state: CaptionsState::Error,
                            message: Some(
                                "Live captions stopped after repeated upload failures.".to_string(),
                            ),
                            remaining_seconds: None,
                            session_client_id: Some(session.session_client_id.clone()),
                        },
                    )
                    .await;
                    return;
                }
            }
        }
    }

    remove_tap();
    publish_status(&session.state, CaptionsStatus::idle()).await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resample_decimates_48k_stereo_to_16k_mono() {
        // 6 stereo frames (12 samples) at 48kHz -> 2 mono samples at 16kHz.
        let samples: Vec<f32> = vec![
            0.3, 0.1, // frame 1 -> mono 0.2
            0.3, 0.1, // frame 2 -> mono 0.2
            0.3, 0.1, // frame 3 -> mono 0.2
            -0.6, -0.2, // frame 4 -> mono -0.4
            -0.6, -0.2, // frame 5 -> mono -0.4
            -0.6, -0.2, // frame 6 -> mono -0.4
        ];
        let output = downmix_resample_to_16k_mono(&samples, 2, 48_000);
        assert_eq!(output.len(), 2);
        assert!((f32::from(output[0]) / f32::from(i16::MAX) - 0.2).abs() < 0.001);
        assert!((f32::from(output[1]) / f32::from(i16::MAX) + 0.4).abs() < 0.001);
    }

    #[test]
    fn resample_handles_mono_input_and_clamps_overdrive() {
        let output = downmix_resample_to_16k_mono(&[2.0, 2.0, 2.0], 1, 48_000);
        assert_eq!(output, vec![i16::MAX]);
    }

    #[test]
    fn resample_rejects_unexpected_formats() {
        assert!(downmix_resample_to_16k_mono(&[0.0; 12], 2, 44_100).is_empty());
        assert!(downmix_resample_to_16k_mono(&[0.0; 12], 6, 48_000).is_empty());
    }

    #[test]
    fn wav_header_describes_16k_mono_s16le() {
        let wav = encode_wav_16k_mono(&[0, 1, -1]);
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..16], b"WAVEfmt ");
        assert_eq!(u16::from_le_bytes([wav[22], wav[23]]), 1); // channels
        assert_eq!(
            u32::from_le_bytes([wav[24], wav[25], wav[26], wav[27]]),
            16_000
        );
        assert_eq!(u16::from_le_bytes([wav[34], wav[35]]), 16); // bits/sample
        assert_eq!(u32::from_le_bytes([wav[40], wav[41], wav[42], wav[43]]), 6); // data bytes
        assert_eq!(wav.len(), 44 + 6);
    }

    fn encode_test_png(width: u32, height: u32) -> String {
        use base64::Engine as _;
        let mut png = Vec::new();
        let image = image::RgbaImage::from_pixel(width, height, image::Rgba([255, 0, 0, 128]));
        image::DynamicImage::ImageRgba8(image)
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .expect("test png encodes");
        base64::engine::general_purpose::STANDARD.encode(png)
    }

    #[test]
    fn overlay_installs_decodes_and_revs() {
        let slot = new_caption_overlay_slot();
        let info = install_caption_overlay(&slot, &encode_test_png(4, 2), CaptionOverlayPosition::Bottom)
            .expect("valid overlay installs");
        assert!(info.active);
        assert_eq!((info.width, info.height), (4, 2));
        assert_eq!(info.revision, 1);

        let overlay = current_caption_overlay(&slot).expect("overlay present");
        assert_eq!(overlay.rgba.len(), 4 * 2 * 4);
        assert_eq!(overlay.position, CaptionOverlayPosition::Bottom);

        let second =
            install_caption_overlay(&slot, &encode_test_png(6, 2), CaptionOverlayPosition::Top)
                .expect("replacement installs");
        assert_eq!(second.revision, 2);
    }

    #[test]
    fn overlay_rejects_garbage_and_keeps_previous() {
        let slot = new_caption_overlay_slot();
        install_caption_overlay(&slot, &encode_test_png(4, 2), CaptionOverlayPosition::Bottom)
            .expect("valid overlay installs");

        assert!(install_caption_overlay(&slot, "not base64!!!", CaptionOverlayPosition::Bottom).is_err());
        assert!(install_caption_overlay(&slot, "", CaptionOverlayPosition::Bottom).is_err());
        {
            use base64::Engine as _;
            let not_an_image = base64::engine::general_purpose::STANDARD.encode(b"plain bytes");
            assert!(
                install_caption_overlay(&slot, &not_an_image, CaptionOverlayPosition::Bottom)
                    .is_err()
            );
        }

        let survivor = current_caption_overlay(&slot).expect("previous overlay kept");
        assert_eq!((survivor.width, survivor.height), (4, 2));
        assert_eq!(survivor.revision, 1);
    }

    #[test]
    fn overlay_rejects_out_of_range_dimensions_and_clears() {
        let slot = new_caption_overlay_slot();
        assert!(
            install_caption_overlay(&slot, &encode_test_png(4200, 2), CaptionOverlayPosition::Top)
                .is_err()
        );

        install_caption_overlay(&slot, &encode_test_png(4, 2), CaptionOverlayPosition::Bottom)
            .expect("valid overlay installs");
        let cleared = clear_caption_overlay(&slot);
        assert!(!cleared.active);
        assert!(current_caption_overlay(&slot).is_none());
    }

    #[test]
    fn tap_offer_is_a_noop_when_inactive() {
        // Must never panic or block from the audio thread when captions are off.
        offer_caption_frame(&AudioFrame {
            timestamp_micros: 0,
            captured_at: std::time::Instant::now(),
            sample_rate: 48_000,
            channels: 2,
            samples: vec![0.0; 128],
        });
    }
}
