//! The declared `windows` features cover the stage B spawn and handshake path (03 sections 2.3 and 2.4), so no
//! stage B slice edits Cargo.toml. The shell creates the backend's stdin and stdout pipes with `CreatePipe`
//! (feature `Win32_System_Pipes`), writes TOKEN and NONCE with `WriteFile`, reads the handshake with `ReadFile`
//! and checks the pipe with `PeekNamedPipe` (all gated on `Win32_System_IO`). This test calls each of them, so
//! dropping one of the two features from the manifest breaks the build of this test (born failing before the
//! features were declared). No window, no process and no file is involved: an anonymous in-memory pipe only.

#![allow(
    clippy::disallowed_methods,
    reason = "test file, not shipped: WriteFile and ReadFile on an anonymous in-memory pipe, no file involved"
)]

use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::System::Pipes::{CreatePipe, PeekNamedPipe};

const PIPE_BUFFER: u32 = 4096;
const MESSAGE: &[u8] = b"TOKEN 00\nNONCE 00\n";

fn pipe_pair() -> (HANDLE, HANDLE) {
    let mut read = HANDLE::default();
    let mut write = HANDLE::default();
    // SAFETY: both out-pointers are valid for the call; default security attributes.
    unsafe { CreatePipe(&mut read, &mut write, None, PIPE_BUFFER) }.expect("CreatePipe");
    (read, write)
}

#[test]
fn pipe_round_trip_uses_the_declared_features() {
    let (read, write) = pipe_pair();
    let mut written = 0u32;
    // SAFETY: handles come from CreatePipe above; the buffer outlives the call.
    unsafe {
        windows::Win32::Storage::FileSystem::WriteFile(
            write,
            Some(MESSAGE),
            Some(&mut written),
            None,
        )
    }
    .expect("WriteFile");
    assert_eq!(written as usize, MESSAGE.len());

    let mut available = 0u32;
    // SAFETY: only the available-bytes out-pointer is passed; the rest are None.
    unsafe { PeekNamedPipe(read, None, 0, None, Some(&mut available), None) }
        .expect("PeekNamedPipe");
    assert_eq!(available as usize, MESSAGE.len());

    let mut buffer = [0u8; 64];
    let mut got = 0u32;
    // SAFETY: handles come from CreatePipe above; the buffer outlives the call.
    unsafe {
        windows::Win32::Storage::FileSystem::ReadFile(read, Some(&mut buffer), Some(&mut got), None)
    }
    .expect("ReadFile");
    assert_eq!(&buffer[..got as usize], MESSAGE);

    // SAFETY: each handle is closed exactly once.
    unsafe {
        CloseHandle(read).expect("close read end");
        CloseHandle(write).expect("close write end");
    }
}

#[test]
fn the_io_module_is_reachable_for_overlapped_reads() {
    // OVERLAPPED is the type ReadFile and WriteFile take for the handshake reader; naming it proves the module.
    let overlapped = windows::Win32::System::IO::OVERLAPPED::default();
    assert_eq!(overlapped.hEvent, HANDLE::default());
}
