//! FIFO transport between native capture threads and the ffmpeg readers.
//!
//! Unix-only today: the Windows counterpart (named pipes) lands with the
//! Windows port (docs/windows-port-plan.md, Phase 3). Until then the
//! non-Unix stubs return `Unsupported` so callers fail with a clear
//! runtime message instead of the crate failing to compile.

use std::fs::File;
use std::io;
use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::time::Duration;

#[cfg(unix)]
pub fn create(path: &Path) -> io::Result<()> {
    use std::ffi::CString;

    let c_path = CString::new(path.display().to_string()).map_err(|_| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "FIFO path contained an interior NUL byte",
        )
    })?;
    let status = unsafe { libc::mkfifo(c_path.as_ptr(), 0o600) };
    if status != 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

/// Opens the FIFO for writing without blocking on a reader, retrying every
/// `retry` until one attaches or `stop` flips. `clear_nonblock` restores
/// blocking writes once the reader is attached.
#[cfg(unix)]
pub fn open_writer(
    path: &Path,
    stop: &AtomicBool,
    retry: Duration,
    clear_nonblock: bool,
    stopped_message: &str,
) -> io::Result<File> {
    use std::ffi::CString;
    use std::os::fd::FromRawFd;
    use std::sync::atomic::Ordering;

    let c_path = CString::new(path.display().to_string())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "invalid FIFO path"))?;

    while !stop.load(Ordering::Relaxed) {
        let fd = unsafe { libc::open(c_path.as_ptr(), libc::O_WRONLY | libc::O_NONBLOCK) };
        if fd >= 0 {
            if clear_nonblock {
                let _ = unsafe { libc::fcntl(fd, libc::F_SETFL, 0) };
            }
            return Ok(unsafe { File::from_raw_fd(fd) });
        }

        let error = io::Error::last_os_error();
        if error.raw_os_error() != Some(libc::ENXIO) {
            return Err(error);
        }
        std::thread::sleep(retry);
    }

    Err(io::Error::new(io::ErrorKind::Interrupted, stopped_message))
}

#[cfg(not(unix))]
pub fn create(path: &Path) -> io::Result<()> {
    let _ = path;
    Err(unsupported())
}

#[cfg(not(unix))]
pub fn open_writer(
    path: &Path,
    stop: &AtomicBool,
    retry: Duration,
    clear_nonblock: bool,
    stopped_message: &str,
) -> io::Result<File> {
    let _ = (path, stop, retry, clear_nonblock, stopped_message);
    Err(unsupported())
}

#[cfg(not(unix))]
fn unsupported() -> io::Error {
    io::Error::new(
        io::ErrorKind::Unsupported,
        "FIFO transport is not implemented on this platform yet (named pipes arrive with the Windows port)",
    )
}

// These cases define the behavioral contract the Windows named-pipe twin
// must match (windows-port-plan Phase 3): create → open_writer(retry/stop)
// → blocking writes once a reader attaches.
#[cfg(all(test, unix))]
mod tests {
    use std::io::Read;
    use std::io::Write;
    use std::os::unix::fs::{FileTypeExt, PermissionsExt};
    use std::path::PathBuf;
    use std::sync::atomic::Ordering;

    use super::*;

    fn temp_fifo_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("videorc-fifo-test-{name}-{}", std::process::id()))
    }

    #[test]
    fn create_makes_a_fifo_with_owner_only_mode() {
        let path = temp_fifo_path("create");
        let _ = std::fs::remove_file(&path);

        create(&path).expect("create should succeed on a fresh path");

        let metadata = std::fs::metadata(&path).expect("fifo metadata");
        assert!(metadata.file_type().is_fifo(), "path must be a FIFO");
        assert_eq!(
            metadata.permissions().mode() & 0o777,
            0o600,
            "FIFO must be owner-only"
        );

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn create_fails_on_existing_path() {
        let path = temp_fifo_path("create-existing");
        let _ = std::fs::remove_file(&path);

        create(&path).expect("first create succeeds");
        assert!(
            create(&path).is_err(),
            "second create on the same path must fail (callers remove stale FIFOs themselves)"
        );

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn open_writer_returns_interrupted_when_stopped() {
        let path = temp_fifo_path("stopped");
        let stop = AtomicBool::new(true);

        let error = open_writer(
            &path,
            &stop,
            Duration::from_millis(1),
            true,
            "writer stopped before FIFO opened",
        )
        .expect_err("a pre-stopped writer must not open");

        assert_eq!(error.kind(), io::ErrorKind::Interrupted);
        assert_eq!(error.to_string(), "writer stopped before FIFO opened");
    }

    #[test]
    fn open_writer_connects_once_a_reader_attaches() {
        let path = temp_fifo_path("connect");
        let _ = std::fs::remove_file(&path);
        create(&path).expect("create fifo");

        let reader_path = path.clone();
        let reader = std::thread::spawn(move || {
            let mut file = std::fs::File::open(reader_path).expect("reader open");
            let mut buffer = [0u8; 4];
            file.read_exact(&mut buffer).expect("reader read");
            buffer
        });

        let stop = AtomicBool::new(false);
        let mut writer = open_writer(
            &path,
            &stop,
            Duration::from_millis(5),
            true,
            "writer stopped before FIFO opened",
        )
        .expect("writer opens once the reader is attached");
        writer.write_all(b"ping").expect("write to fifo");
        drop(writer);

        assert_eq!(&reader.join().expect("reader thread"), b"ping");
        stop.store(true, Ordering::Relaxed);

        let _ = std::fs::remove_file(&path);
    }
}
