const BUNDLED_FFMPEG_PATH_ENV: &str = "VIDEORC_BUNDLED_FFMPEG_PATH";

pub fn default_ffmpeg_path() -> String {
    std::env::var(BUNDLED_FFMPEG_PATH_ENV)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "ffmpeg".to_string())
}

pub fn resolve_ffmpeg_path(path: Option<String>) -> String {
    path.map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(default_ffmpeg_path)
}

pub fn resolve_ffmpeg_path_ref(path: Option<&str>) -> String {
    path.map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(default_ffmpeg_path)
}
