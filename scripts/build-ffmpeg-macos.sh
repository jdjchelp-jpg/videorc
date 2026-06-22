#!/usr/bin/env bash
set -euo pipefail

FFMPEG_VERSION="${FFMPEG_VERSION:-8.1.1}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARCH="$(uname -m)"
SOURCE_URL="https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz"
SOURCE_DIR="${REPO_ROOT}/vendor/ffmpeg/_src"
BUILD_DIR="${REPO_ROOT}/vendor/ffmpeg/_build/macos-${ARCH}"
INSTALL_DIR="${REPO_ROOT}/vendor/ffmpeg/macos-${ARCH}"
CURRENT_DIR="${REPO_ROOT}/vendor/ffmpeg/current"
TARBALL="${SOURCE_DIR}/ffmpeg-${FFMPEG_VERSION}.tar.xz"
EXTRACTED_DIR="${SOURCE_DIR}/ffmpeg-${FFMPEG_VERSION}"
JOBS="${JOBS:-$(sysctl -n hw.ncpu 2>/dev/null || echo 4)}"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "FFmpeg macOS bundle build must run on macOS." >&2
  exit 1
fi

if [[ -x "${CURRENT_DIR}/bin/ffmpeg" && -x "${CURRENT_DIR}/bin/ffprobe" && "${FFMPEG_REBUILD:-0}" != "1" ]]; then
  "${CURRENT_DIR}/bin/ffmpeg" -version | head -1
  echo "Using existing bundled FFmpeg at ${CURRENT_DIR}/bin/ffmpeg"
  exit 0
fi

mkdir -p "${SOURCE_DIR}" "${BUILD_DIR}"

if [[ ! -f "${TARBALL}" ]]; then
  echo "Downloading ${SOURCE_URL}"
  curl -fL "${SOURCE_URL}" -o "${TARBALL}"
fi

SOURCE_SHA256="$(shasum -a 256 "${TARBALL}" | awk '{print $1}')"
if [[ -n "${FFMPEG_SOURCE_SHA256:-}" && "${SOURCE_SHA256}" != "${FFMPEG_SOURCE_SHA256}" ]]; then
  echo "FFmpeg source checksum mismatch." >&2
  echo "Expected: ${FFMPEG_SOURCE_SHA256}" >&2
  echo "Actual:   ${SOURCE_SHA256}" >&2
  exit 1
fi

rm -rf "${EXTRACTED_DIR}" "${BUILD_DIR}" "${INSTALL_DIR}" "${CURRENT_DIR}"
mkdir -p "${BUILD_DIR}" "${INSTALL_DIR}"
tar -xJf "${TARBALL}" -C "${SOURCE_DIR}"

CONFIGURE_FLAGS=(
  "--prefix=${INSTALL_DIR}"
  "--disable-debug"
  "--disable-doc"
  "--disable-ffplay"
  "--disable-gpl"
  "--disable-nonfree"
  "--enable-avfoundation"
  "--enable-audiotoolbox"
  "--enable-videotoolbox"
)

(
  cd "${BUILD_DIR}"
  "${EXTRACTED_DIR}/configure" "${CONFIGURE_FLAGS[@]}"
  make -j "${JOBS}"
  make install
)

VERSION_OUTPUT="$("${INSTALL_DIR}/bin/ffmpeg" -version)"
CONFIGURATION_LINE="$(printf '%s\n' "${VERSION_OUTPUT}" | grep '^configuration:' || true)"
if printf '%s\n' "${CONFIGURATION_LINE}" | grep -Eq -- '--enable-(gpl|nonfree)'; then
  echo "Refusing to stage FFmpeg build with GPL or nonfree configuration:" >&2
  echo "${CONFIGURATION_LINE}" >&2
  exit 1
fi

mkdir -p "${INSTALL_DIR}/licenses"
cp "${EXTRACTED_DIR}/COPYING.LGPLv2.1" "${INSTALL_DIR}/licenses/"
cp "${EXTRACTED_DIR}/COPYING.LGPLv3" "${INSTALL_DIR}/licenses/"
cp "${EXTRACTED_DIR}/LICENSE.md" "${INSTALL_DIR}/licenses/"

cat > "${INSTALL_DIR}/NOTICE.txt" <<NOTICE
This product includes FFmpeg and FFprobe as separate executables.

FFmpeg is licensed under the GNU Lesser General Public License (LGPL) version 2.1 or later unless GPL components are enabled. This Videorc bundle is built without --enable-gpl and without --enable-nonfree.

FFmpeg project: https://ffmpeg.org/
NOTICE

cat > "${INSTALL_DIR}/SOURCE.txt" <<SOURCE
FFmpeg source archive: ${SOURCE_URL}
FFmpeg version: ${FFMPEG_VERSION}
Source SHA-256: ${SOURCE_SHA256}

Exact configure command:
${EXTRACTED_DIR}/configure ${CONFIGURE_FLAGS[*]}

Source code for this exact archive must be made available beside public Videorc binary downloads.
SOURCE

cat > "${INSTALL_DIR}/BUILD-CONFIG.txt" <<CONFIG
Built at: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
Build host: $(uname -a)
Architecture: ${ARCH}
Jobs: ${JOBS}

${VERSION_OUTPUT}
CONFIG

mkdir -p "${CURRENT_DIR}"
ditto "${INSTALL_DIR}" "${CURRENT_DIR}"

"${CURRENT_DIR}/bin/ffmpeg" -version | head -1
echo "Staged LGPL-compatible FFmpeg bundle at ${CURRENT_DIR}"
