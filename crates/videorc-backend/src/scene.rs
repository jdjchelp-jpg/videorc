use crate::protocol::{
    CameraCorner, CameraFit, CameraShape, CameraSize, Scene, SceneConfigParams, SceneOutput,
    SceneOutputKind, SceneSource, SceneSourceKind, SceneSourceOrderParams, SceneSourceParams,
    SceneTransform, SceneTransformPatch, SceneTransformUpdateParams, SourceSelection,
};

const DEFAULT_SCENE_ID: &str = "scene:default";
const BASE_SOURCE_ID: &str = "source:base";
const CAMERA_SOURCE_ID: &str = "source:camera";
const TEST_PATTERN_SOURCE_ID: &str = "source:test-pattern";
const SNAP_THRESHOLD: f64 = 0.015;

pub fn default_scene() -> Scene {
    Scene {
        id: DEFAULT_SCENE_ID.to_string(),
        name: "Default Scene".to_string(),
        sources: Vec::new(),
        outputs: vec![SceneOutput {
            id: "output:preview".to_string(),
            kind: SceneOutputKind::Preview,
            width: 1280,
            height: 720,
            fps: 30,
        }],
    }
}

pub fn scene_from_capture_config(params: SceneConfigParams) -> Scene {
    let (output_width, output_height, fps) = params
        .video
        .as_ref()
        .map(|video| (video.width, video.height, video.fps))
        .unwrap_or((1280, 720, 30));
    let mut scene = Scene {
        id: DEFAULT_SCENE_ID.to_string(),
        name: "Default Scene".to_string(),
        sources: Vec::new(),
        outputs: vec![
            SceneOutput {
                id: "output:preview".to_string(),
                kind: SceneOutputKind::Preview,
                width: output_width.min(1280),
                height: output_height.min(720),
                fps: fps.min(30),
            },
            SceneOutput {
                id: "output:recording".to_string(),
                kind: SceneOutputKind::Recording,
                width: output_width,
                height: output_height,
                fps,
            },
        ],
    };

    scene.sources.push(base_source(&params.sources));
    if let Some(camera_id) = params.sources.camera_id.clone() {
        scene.sources.push(camera_source(
            camera_id,
            &params.layout,
            output_width,
            output_height,
        ));
    }

    scene
}

pub fn update_source_transform(
    scene: &mut Scene,
    params: SceneTransformUpdateParams,
) -> Result<Scene, String> {
    let source = find_source_mut(scene, &params.source_id)?;
    source.transform = sanitize_transform(apply_transform_patch(
        source.transform.clone(),
        params.transform,
    ));
    Ok(scene.clone())
}

pub fn reset_source_transform(
    scene: &mut Scene,
    params: SceneSourceParams,
) -> Result<Scene, String> {
    let source = find_source_mut(scene, &params.source_id)?;
    source.transform = source.default_transform.clone();
    Ok(scene.clone())
}

pub fn reorder_sources(scene: &mut Scene, params: SceneSourceOrderParams) -> Result<Scene, String> {
    if params.source_ids.len() != scene.sources.len() {
        return Err("sourceIds must include every source exactly once".to_string());
    }

    let mut reordered = Vec::with_capacity(scene.sources.len());
    for source_id in params.source_ids {
        let Some(index) = scene
            .sources
            .iter()
            .position(|source| source.id == source_id)
        else {
            return Err(format!("Unknown source id: {source_id}"));
        };
        reordered.push(scene.sources.remove(index));
    }
    scene.sources = reordered;
    Ok(scene.clone())
}

pub fn nudge_source(
    scene: &mut Scene,
    source_id: &str,
    direction_x: f64,
    direction_y: f64,
    large: bool,
) -> Result<Scene, String> {
    let step = if large { 0.025 } else { 0.005 };
    let source = find_source_mut(scene, source_id)?;
    source.transform = sanitize_transform(SceneTransform {
        x: source.transform.x + direction_x * step,
        y: source.transform.y + direction_y * step,
        ..source.transform.clone()
    });
    Ok(scene.clone())
}

pub fn snap_transform(mut transform: SceneTransform) -> SceneTransform {
    transform.x = snap_position(transform.x, transform.width);
    transform.y = snap_position(transform.y, transform.height);
    transform
}

pub fn crop_for_zoom(zoom: u32, offset: i32) -> (f64, f64) {
    let zoom = zoom.clamp(100, 200);
    if zoom == 100 {
        return (0.0, 0.0);
    }

    let total_crop = 1.0 - (100.0 / f64::from(zoom));
    let offset = (f64::from(offset.clamp(-100, 100)) / 200.0) * total_crop;
    normalize_crop_pair((total_crop / 2.0) + offset, (total_crop / 2.0) - offset)
}

fn base_source(sources: &SourceSelection) -> SceneSource {
    let (id, name, kind, device_id) = if sources.test_pattern {
        (
            TEST_PATTERN_SOURCE_ID,
            "Test pattern",
            SceneSourceKind::TestPattern,
            None,
        )
    } else if let Some(window_id) = sources.window_id.clone() {
        (
            BASE_SOURCE_ID,
            "Window capture",
            SceneSourceKind::Window,
            Some(window_id),
        )
    } else {
        (
            BASE_SOURCE_ID,
            "Screen capture",
            SceneSourceKind::Screen,
            sources.screen_id.clone(),
        )
    };
    let transform = full_frame_transform();

    SceneSource {
        id: id.to_string(),
        name: name.to_string(),
        kind,
        device_id,
        transform: transform.clone(),
        default_transform: transform,
        visible: true,
        locked: false,
    }
}

fn camera_source(
    camera_id: String,
    layout: &crate::protocol::LayoutSettings,
    output_width: u32,
    output_height: u32,
) -> SceneSource {
    let transform = camera_transform(layout, output_width, output_height);
    SceneSource {
        id: CAMERA_SOURCE_ID.to_string(),
        name: "Camera".to_string(),
        kind: SceneSourceKind::Camera,
        device_id: Some(camera_id),
        transform: transform.clone(),
        default_transform: transform,
        visible: true,
        locked: false,
    }
}

fn camera_transform(
    layout: &crate::protocol::LayoutSettings,
    output_width: u32,
    output_height: u32,
) -> SceneTransform {
    let output_width = f64::from(output_width.max(1));
    let output_height = f64::from(output_height.max(1));
    let (camera_width, camera_height) = camera_box_size(&layout.camera_size, &layout.camera_shape);
    let camera_width = f64::from(camera_width);
    let camera_height = f64::from(camera_height);
    let margin = f64::from(layout.camera_margin.min(160));
    let x = match layout.camera_corner {
        CameraCorner::TopLeft | CameraCorner::BottomLeft => margin / output_width,
        CameraCorner::TopRight | CameraCorner::BottomRight => {
            (output_width - camera_width - margin) / output_width
        }
    };
    let y = match layout.camera_corner {
        CameraCorner::TopLeft | CameraCorner::TopRight => margin / output_height,
        CameraCorner::BottomLeft | CameraCorner::BottomRight => {
            (output_height - camera_height - margin) / output_height
        }
    };
    let (crop_left, crop_right) = match layout.camera_fit {
        CameraFit::Fit if layout.camera_zoom == 100 => (0.0, 0.0),
        CameraFit::Fit | CameraFit::Fill => {
            crop_for_zoom(layout.camera_zoom, layout.camera_offset_x)
        }
    };
    let (crop_top, crop_bottom) = match layout.camera_fit {
        CameraFit::Fit if layout.camera_zoom == 100 => (0.0, 0.0),
        CameraFit::Fit | CameraFit::Fill => {
            crop_for_zoom(layout.camera_zoom, layout.camera_offset_y)
        }
    };

    sanitize_transform(SceneTransform {
        x,
        y,
        width: camera_width / output_width,
        height: camera_height / output_height,
        crop_left,
        crop_top,
        crop_right,
        crop_bottom,
    })
}

fn camera_box_size(size: &CameraSize, shape: &CameraShape) -> (u32, u32) {
    let width = match size {
        CameraSize::Small => 260,
        CameraSize::Medium => 360,
        CameraSize::Large => 480,
    };
    let height = match shape {
        CameraShape::Rectangle => (width * 9 + 8) / 16,
        CameraShape::Circle => width,
    };
    (width, height)
}

fn full_frame_transform() -> SceneTransform {
    SceneTransform {
        x: 0.0,
        y: 0.0,
        width: 1.0,
        height: 1.0,
        crop_left: 0.0,
        crop_top: 0.0,
        crop_right: 0.0,
        crop_bottom: 0.0,
    }
}

fn apply_transform_patch(
    mut transform: SceneTransform,
    patch: SceneTransformPatch,
) -> SceneTransform {
    if let Some(value) = patch.x {
        transform.x = value;
    }
    if let Some(value) = patch.y {
        transform.y = value;
    }
    if let Some(value) = patch.width {
        transform.width = value;
    }
    if let Some(value) = patch.height {
        transform.height = value;
    }
    if let Some(value) = patch.crop_left {
        transform.crop_left = value;
    }
    if let Some(value) = patch.crop_top {
        transform.crop_top = value;
    }
    if let Some(value) = patch.crop_right {
        transform.crop_right = value;
    }
    if let Some(value) = patch.crop_bottom {
        transform.crop_bottom = value;
    }
    transform
}

fn sanitize_transform(transform: SceneTransform) -> SceneTransform {
    let (crop_left, crop_right) = normalize_crop_pair(
        clean_number(transform.crop_left),
        clean_number(transform.crop_right),
    );
    let (crop_top, crop_bottom) = normalize_crop_pair(
        clean_number(transform.crop_top),
        clean_number(transform.crop_bottom),
    );

    snap_transform(SceneTransform {
        x: clean_number(transform.x).clamp(-1.0, 2.0),
        y: clean_number(transform.y).clamp(-1.0, 2.0),
        width: clean_number(transform.width).clamp(0.0, 2.0),
        height: clean_number(transform.height).clamp(0.0, 2.0),
        crop_left,
        crop_top,
        crop_right,
        crop_bottom,
    })
}

fn normalize_crop_pair(first: f64, second: f64) -> (f64, f64) {
    let mut first = first.clamp(0.0, 0.95);
    let mut second = second.clamp(0.0, 0.95);
    let total = first + second;
    if total > 0.95 {
        let scale = 0.95 / total;
        first *= scale;
        second *= scale;
    }
    (first, second)
}

fn snap_position(position: f64, size: f64) -> f64 {
    if position.abs() <= SNAP_THRESHOLD {
        0.0
    } else if ((position + size) - 1.0).abs() <= SNAP_THRESHOLD {
        1.0 - size
    } else if ((position + (size / 2.0)) - 0.5).abs() <= SNAP_THRESHOLD {
        0.5 - (size / 2.0)
    } else {
        position
    }
}

fn clean_number(value: f64) -> f64 {
    if value.is_finite() { value } else { 0.0 }
}

fn find_source_mut<'a>(
    scene: &'a mut Scene,
    source_id: &str,
) -> Result<&'a mut SceneSource, String> {
    scene
        .sources
        .iter_mut()
        .find(|source| source.id == source_id)
        .ok_or_else(|| format!("Unknown source id: {source_id}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{LayoutSettings, SourceSelection};

    fn base_params() -> SceneConfigParams {
        SceneConfigParams {
            sources: SourceSelection {
                screen_id: Some("screen:screencapturekit:1".to_string()),
                window_id: None,
                camera_id: Some("camera:avfoundation-native:abc123".to_string()),
                microphone_id: None,
                test_pattern: false,
            },
            layout: LayoutSettings {
                camera_corner: CameraCorner::BottomRight,
                camera_size: CameraSize::Medium,
                camera_shape: CameraShape::Rectangle,
                camera_margin: 32,
                camera_fit: CameraFit::Fill,
                camera_mirror: false,
                camera_zoom: 100,
                camera_offset_x: 0,
                camera_offset_y: 0,
            },
            video: None,
        }
    }

    #[test]
    fn builds_scene_from_capture_config_in_source_order() {
        let scene = scene_from_capture_config(base_params());

        assert_eq!(scene.sources.len(), 2);
        assert_eq!(scene.sources[0].kind, SceneSourceKind::Screen);
        assert_eq!(scene.sources[1].kind, SceneSourceKind::Camera);
        assert_eq!(scene.sources[0].transform.width, 1.0);
        assert!(scene.sources[1].transform.x > 0.6);
        assert!(scene.sources[1].transform.y > 0.6);
    }

    #[test]
    fn reset_transform_restores_source_default() {
        let mut scene = scene_from_capture_config(base_params());

        update_source_transform(
            &mut scene,
            SceneTransformUpdateParams {
                source_id: CAMERA_SOURCE_ID.to_string(),
                transform: SceneTransformPatch {
                    x: Some(0.1),
                    y: Some(0.2),
                    ..SceneTransformPatch::default()
                },
            },
        )
        .unwrap();
        reset_source_transform(
            &mut scene,
            SceneSourceParams {
                source_id: CAMERA_SOURCE_ID.to_string(),
            },
        )
        .unwrap();

        assert_eq!(
            scene.sources[1].transform,
            scene.sources[1].default_transform
        );
    }

    #[test]
    fn clamps_crop_pairs_without_rejecting_tiny_transforms() {
        let mut scene = scene_from_capture_config(base_params());

        update_source_transform(
            &mut scene,
            SceneTransformUpdateParams {
                source_id: CAMERA_SOURCE_ID.to_string(),
                transform: SceneTransformPatch {
                    width: Some(0.0),
                    height: Some(0.0),
                    crop_left: Some(0.8),
                    crop_right: Some(0.8),
                    ..SceneTransformPatch::default()
                },
            },
        )
        .unwrap();

        let transform = &scene.sources[1].transform;
        assert_eq!(transform.width, 0.0);
        assert_eq!(transform.height, 0.0);
        assert!(transform.crop_left + transform.crop_right <= 0.95);
    }

    #[test]
    fn snaps_near_edges_and_center() {
        let transform = snap_transform(SceneTransform {
            x: 0.012,
            y: 0.301,
            width: 0.4,
            height: 0.4,
            crop_left: 0.0,
            crop_top: 0.0,
            crop_right: 0.0,
            crop_bottom: 0.0,
        });

        assert_eq!(transform.x, 0.0);
        assert_eq!(transform.y, 0.3);
    }

    #[test]
    fn reorders_sources_exactly() {
        let mut scene = scene_from_capture_config(base_params());

        reorder_sources(
            &mut scene,
            SceneSourceOrderParams {
                source_ids: vec![CAMERA_SOURCE_ID.to_string(), BASE_SOURCE_ID.to_string()],
            },
        )
        .unwrap();

        assert_eq!(scene.sources[0].id, CAMERA_SOURCE_ID);
        assert_eq!(scene.sources[1].id, BASE_SOURCE_ID);
    }

    #[test]
    fn nudges_with_small_and_large_steps() {
        let mut params = base_params();
        params.layout.camera_corner = CameraCorner::TopLeft;
        let mut scene = scene_from_capture_config(params);
        let original_x = scene.sources[1].transform.x;

        nudge_source(&mut scene, CAMERA_SOURCE_ID, -1.0, 0.0, false).unwrap();
        assert!((scene.sources[1].transform.x - (original_x - 0.005)).abs() < 0.0001);

        nudge_source(&mut scene, CAMERA_SOURCE_ID, 1.0, 0.0, true).unwrap();
        assert!((scene.sources[1].transform.x - (original_x + 0.02)).abs() < 0.0001);
    }

    #[test]
    fn derives_crop_from_zoom_and_pan() {
        let (left, right) = crop_for_zoom(150, 40);

        assert!(left > right);
        assert!(left + right > 0.3);
        assert!(left + right < 0.34);
    }
}
