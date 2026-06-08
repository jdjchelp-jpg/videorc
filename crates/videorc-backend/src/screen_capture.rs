use std::sync::mpsc;
use std::time::Duration;

use crate::protocol::{Device, DeviceKind, DeviceStatus};

const SCREEN_CAPTUREKIT_PREFIX: &str = "screen:screencapturekit:";
const WINDOW_CAPTUREKIT_PREFIX: &str = "window:screencapturekit:";
const SCREEN_CAPTUREKIT_DISCOVERY_TIMEOUT: Duration = Duration::from_secs(12);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NativeCaptureSources {
    pub devices: Vec<Device>,
    pub warnings: Vec<String>,
}

pub fn parse_screencapturekit_display_id(id: &str) -> Option<u32> {
    id.strip_prefix(SCREEN_CAPTUREKIT_PREFIX)?.parse().ok()
}

pub fn parse_screencapturekit_window_id(id: &str) -> Option<u32> {
    id.strip_prefix(WINDOW_CAPTUREKIT_PREFIX)?.parse().ok()
}

#[cfg(target_os = "macos")]
pub fn list_native_capture_sources() -> NativeCaptureSources {
    macos::list_native_capture_sources()
}

#[cfg(not(target_os = "macos"))]
pub fn list_native_capture_sources() -> NativeCaptureSources {
    NativeCaptureSources {
        devices: Vec::new(),
        warnings: vec!["ScreenCaptureKit is only available on macOS.".to_string()],
    }
}

fn permission_or_unavailable(error: &str) -> DeviceStatus {
    let normalized = error.to_lowercase();
    if normalized.contains("permission")
        || normalized.contains("denied")
        || normalized.contains("not authorized")
        || normalized.contains("tcc")
    {
        DeviceStatus::PermissionRequired
    } else {
        DeviceStatus::Unavailable
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use super::*;
    use block2::RcBlock;
    use objc2_foundation::{NSError, NSString};
    use objc2_screen_capture_kit::{SCShareableContent, SCWindow};

    enum ShareableContentResult {
        Devices(Vec<Device>),
        Error(String),
    }

    pub fn list_native_capture_sources() -> NativeCaptureSources {
        let (tx, rx) = mpsc::channel();
        let handler = RcBlock::new(
            move |content: *mut SCShareableContent, error: *mut NSError| {
                let result = if !error.is_null() {
                    ShareableContentResult::Error(error_description(error))
                } else if content.is_null() {
                    ShareableContentResult::Error(
                        "ScreenCaptureKit returned no shareable content.".to_string(),
                    )
                } else {
                    // SAFETY: ScreenCaptureKit owns the content object for this callback. We copy the
                    // display/window metadata before the callback returns and do not retain references.
                    ShareableContentResult::Devices(unsafe {
                        devices_from_shareable_content(&*content)
                    })
                };
                let _ = tx.send(result);
            },
        );

        // SAFETY: The block stays alive while we wait for the completion callback below.
        unsafe {
            SCShareableContent::getShareableContentExcludingDesktopWindows_onScreenWindowsOnly_completionHandler(
                true, true, &handler,
            );
        }

        match rx.recv_timeout(SCREEN_CAPTUREKIT_DISCOVERY_TIMEOUT) {
            Ok(ShareableContentResult::Devices(devices)) => NativeCaptureSources {
                devices,
                warnings: Vec::new(),
            },
            Ok(ShareableContentResult::Error(error)) => {
                let status = permission_or_unavailable(&error);
                NativeCaptureSources {
                    devices: vec![
                        Device {
                            id: "screen:screencapturekit-unavailable".to_string(),
                            name: "Primary Display".to_string(),
                            kind: DeviceKind::Screen,
                            status: status.clone(),
                            detail: Some(format!(
                                "ScreenCaptureKit display discovery failed: {error}"
                            )),
                            width: None,
                            height: None,
                        },
                        Device {
                            id: "window:screencapturekit-unavailable".to_string(),
                            name: "Window Capture".to_string(),
                            kind: DeviceKind::Window,
                            status,
                            detail: Some(format!(
                                "ScreenCaptureKit window discovery failed: {error}"
                            )),
                            width: None,
                            height: None,
                        },
                    ],
                    warnings: vec![format!("ScreenCaptureKit source discovery failed: {error}")],
                }
            }
            Err(_) => NativeCaptureSources {
                devices: vec![
                    Device {
                        id: "screen:screencapturekit-timeout".to_string(),
                        name: "Primary Display".to_string(),
                        kind: DeviceKind::Screen,
                        status: DeviceStatus::Unavailable,
                        detail: Some("ScreenCaptureKit display discovery timed out.".to_string()),
                        width: None,
                        height: None,
                    },
                    Device {
                        id: "window:screencapturekit-timeout".to_string(),
                        name: "Window Capture".to_string(),
                        kind: DeviceKind::Window,
                        status: DeviceStatus::Unavailable,
                        detail: Some("ScreenCaptureKit window discovery timed out.".to_string()),
                        width: None,
                        height: None,
                    },
                ],
                warnings: vec!["ScreenCaptureKit source discovery timed out.".to_string()],
            },
        }
    }

    unsafe fn devices_from_shareable_content(content: &SCShareableContent) -> Vec<Device> {
        let mut devices = Vec::new();
        let displays = unsafe { content.displays() };
        for index in 0..displays.count() {
            let display = displays.objectAtIndex(index);
            let display_id = unsafe { display.displayID() };
            let width = unsafe { display.width() };
            let height = unsafe { display.height() };
            devices.push(Device {
                id: format!("{SCREEN_CAPTUREKIT_PREFIX}{display_id}"),
                name: format!("Display {}", index + 1),
                kind: DeviceKind::Screen,
                status: DeviceStatus::Available,
                detail: Some(format!(
                    "Native ScreenCaptureKit display {display_id} ({width}x{height}). Recording currently uses the FFmpeg fallback bridge."
                )),
                width: Some(positive_u32(width)),
                height: Some(positive_u32(height)),
            });
        }

        let windows = unsafe { content.windows() };
        for index in 0..windows.count() {
            let window = windows.objectAtIndex(index);
            if !include_window(&window) {
                continue;
            }
            let window_id = unsafe { window.windowID() };
            let frame = unsafe { window.frame() };
            let app_name = window_application_name(&window);
            let title = window_title(&window);
            let name = window_name(app_name.as_deref(), title.as_deref(), window_id, index);
            let detail = match app_name {
                Some(app_name) => format!(
                    "Native ScreenCaptureKit window {window_id} from {app_name}. Recording currently uses the FFmpeg fallback bridge."
                ),
                None => format!(
                    "Native ScreenCaptureKit window {window_id}. Recording currently uses the FFmpeg fallback bridge."
                ),
            };

            devices.push(Device {
                id: format!("{WINDOW_CAPTUREKIT_PREFIX}{window_id}"),
                name,
                kind: DeviceKind::Window,
                status: DeviceStatus::Available,
                detail: Some(detail),
                width: Some(frame.size.width.round().max(1.0) as u32),
                height: Some(frame.size.height.round().max(1.0) as u32),
            });
        }

        if !devices
            .iter()
            .any(|device| device.kind == DeviceKind::Screen)
        {
            devices.push(Device {
                id: "screen:screencapturekit-missing".to_string(),
                name: "Primary Display".to_string(),
                kind: DeviceKind::Screen,
                status: DeviceStatus::PermissionRequired,
                detail: Some(
                    "ScreenCaptureKit did not return a display. macOS Screen Recording permission may be missing."
                        .to_string(),
                ),
                width: None,
                height: None,
            });
        }

        if !devices
            .iter()
            .any(|device| device.kind == DeviceKind::Window)
        {
            devices.push(Device {
                id: "window:screencapturekit-missing".to_string(),
                name: "Window Capture".to_string(),
                kind: DeviceKind::Window,
                status: DeviceStatus::Unavailable,
                detail: Some("ScreenCaptureKit did not return any on-screen windows.".to_string()),
                width: None,
                height: None,
            });
        }

        devices
    }

    fn include_window(window: &SCWindow) -> bool {
        let is_on_screen = unsafe { window.isOnScreen() };
        let layer = unsafe { window.windowLayer() };
        let title = window_title(window);
        let app_name = window_application_name(window);

        is_on_screen
            && layer == 0
            && (title.as_deref().is_some_and(|value| !value.is_empty())
                || app_name.as_deref().is_some_and(|value| !value.is_empty()))
    }

    fn positive_u32(value: isize) -> u32 {
        u32::try_from(value.max(1)).unwrap_or(u32::MAX)
    }

    fn window_name(
        app_name: Option<&str>,
        title: Option<&str>,
        window_id: u32,
        index: usize,
    ) -> String {
        match (app_name, title) {
            (Some(app_name), Some(title)) if !app_name.is_empty() && !title.is_empty() => {
                format!("{app_name} - {title}")
            }
            (Some(app_name), _) if !app_name.is_empty() => app_name.to_string(),
            (_, Some(title)) if !title.is_empty() => title.to_string(),
            _ => format!("Window {} ({window_id})", index + 1),
        }
    }

    fn window_title(window: &SCWindow) -> Option<String> {
        let title = unsafe { window.title()? };
        ns_string_to_string(&title)
    }

    fn window_application_name(window: &SCWindow) -> Option<String> {
        let application = unsafe { window.owningApplication()? };
        let name = unsafe { application.applicationName() };
        ns_string_to_string(&name)
    }

    fn ns_string_to_string(value: &NSString) -> Option<String> {
        let value = value.to_string();
        let trimmed = value.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_string())
    }

    fn error_description(error: *mut NSError) -> String {
        // SAFETY: The NSError pointer is provided by ScreenCaptureKit for this callback.
        let description = unsafe { (&*error).localizedDescription() };
        let description = description.to_string();
        if description.trim().is_empty() {
            "Unknown ScreenCaptureKit error.".to_string()
        } else {
            description
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_screencapturekit_source_ids() {
        assert_eq!(
            parse_screencapturekit_display_id("screen:screencapturekit:2"),
            Some(2)
        );
        assert_eq!(
            parse_screencapturekit_window_id("window:screencapturekit:42"),
            Some(42)
        );
        assert_eq!(
            parse_screencapturekit_display_id("screen:avfoundation:2"),
            None
        );
        assert_eq!(
            parse_screencapturekit_window_id("screen:screencapturekit:2"),
            None
        );
    }

    #[test]
    fn maps_permission_like_errors_to_permission_status() {
        assert_eq!(
            permission_or_unavailable("User denied Screen Recording permission"),
            DeviceStatus::PermissionRequired
        );
        assert_eq!(
            permission_or_unavailable("Window server returned no content"),
            DeviceStatus::Unavailable
        );
    }
}
