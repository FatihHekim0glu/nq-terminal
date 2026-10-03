//! link.rs (03 section 6 item 2; 04 D4.3; 05 G08): the only TCP user connects to the literal 127.0.0.1 only, never to
//! the owner's port 8765 in smoke and measure builds, sends no header to a listener that fails the ownership check, and computes the backend's
//! MACs exactly as backend desktop/handshake.py does (known answers computed with the nq-lab venv's Python).
//!
//! Born failing: before stage B `get` refused every call (NotReady), so the accepted-owner case failed; a `get` that
//! connected before checking the owner fails `a_listener_of_another_process_gets_no_connection`.
#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    reason = "test harness: a loopback listener this test owns stands in for a backend"
)]

#[allow(dead_code)]
#[path = "../src/link.rs"]
mod link;

use link::{Get, LinkError};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::mpsc;
use std::time::Duration;

const TIMEOUT: Duration = Duration::from_secs(2);
const TOKEN: &str = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
const READY_KAT: &str = "82eaa134e3601d8a38ca6461c9e86a5572611815fa6cdba6799783a2a8ada0a1";
const PROOF_KAT: &str = "8a56cd84b801a88468b198421c55641fd7349f3883efa15af958110748bfedb6";

fn nonce() -> String {
    "ab".repeat(32)
}

#[test]
fn every_host_but_the_literal_loopback_address_is_refused_before_any_socket() {
    for host in [
        "localhost",
        "127.0.0.2",
        "0.0.0.0",
        "::1",
        "[::1]",
        "192.168.1.10",
        "127.1",
        "example.com",
        "",
    ] {
        let request = Get {
            host,
            port: 53117,
            path: "/api/health",
            headers: &[],
            timeout: TIMEOUT,
        };
        let refused = link::get(&request, &|_| true);
        assert_eq!(
            refused.unwrap_err(),
            LinkError::HostRefused(host.to_string()),
            "host {host}"
        );
    }
}

#[test]
fn port_zero_is_refused_in_every_build() {
    let refused = link::get(&Get::loopback(0, "/", &[], TIMEOUT), &|_| true);
    assert_eq!(refused.unwrap_err(), LinkError::PortRefused(0));
}

/// Smoke and measure builds (the ones that run beside the owner's terminal) never reach 8765.
#[cfg(any(feature = "smoke", feature = "measure"))]
#[test]
fn the_owner_port_is_refused_in_smoke_and_measure_builds() {
    let refused = link::get(&Get::loopback(link::OWNER_PORT, "/", &[], TIMEOUT), &|_| {
        true
    });
    assert_eq!(
        refused.unwrap_err(),
        LinkError::PortRefused(link::OWNER_PORT)
    );
}

/// The release shell must be able to attach to the browser door's backend, which keeps 8765 (03 sections 2.1 and
/// 2.2). The ownership check still runs first: here it refuses every process, so no socket is ever opened and
/// whatever listens on 8765 is never contacted.
#[cfg(not(any(feature = "smoke", feature = "measure")))]
#[test]
fn the_release_shell_does_not_refuse_the_browser_doors_port_but_still_checks_its_owner() {
    let result = link::get(
        &Get::loopback(link::OWNER_PORT, "/api/health", &[], TIMEOUT),
        &|_| false,
    );
    assert_ne!(
        result.as_ref().err(),
        Some(&LinkError::PortRefused(link::OWNER_PORT)),
        "the release shell refused 8765 by number"
    );
    assert!(
        result.is_err(),
        "nothing may be answered to a refused owner"
    );
}

#[test]
fn a_path_or_header_that_could_split_the_request_is_refused() {
    let bad_paths = ["api/health", "/api/health HTTP/1.1\r\nX: y", "/a b"];
    for path in bad_paths {
        let refused = link::get(&Get::loopback(53117, path, &[], TIMEOUT), &|_| true);
        assert!(
            matches!(refused, Err(LinkError::BadRequest(_))),
            "path {path:?}"
        );
    }
    let bad_headers: [(&str, &str); 3] = [("X-A", "v\r\nX-B: w"), ("Bad Name", "v"), ("", "v")];
    for header in bad_headers {
        let headers = [header];
        let refused = link::get(&Get::loopback(53117, "/", &headers, TIMEOUT), &|_| true);
        assert!(
            matches!(refused, Err(LinkError::BadRequest(_))),
            "header {header:?}"
        );
    }
}

/// A one-shot loopback server in this process: it sends what it read back on the channel and answers `answer`.
fn one_shot(answer: &'static [u8]) -> (u16, mpsc::Receiver<Vec<u8>>, TcpListener) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind a spare loopback port");
    let port = listener.local_addr().expect("address").port();
    let serving = listener.try_clone().expect("clone");
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        if let Ok((mut stream, _)) = serving.accept() {
            let mut request = vec![0u8; 8192];
            let n = stream.read(&mut request).unwrap_or(0);
            let _ = stream.write_all(answer);
            let _ = tx.send(request[..n].to_vec());
        }
    });
    (port, rx, listener)
}

#[test]
fn a_listener_of_another_process_gets_no_connection() {
    let (port, received, listener) = one_shot(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok");
    let me = std::process::id();
    let token_header = format!("NQT {TOKEN}");
    let headers = [("Authorization", token_header.as_str())];
    let refused = link::get(
        &Get::loopback(port, "/api/session", &headers, TIMEOUT),
        &|pid| pid != me,
    );
    assert_eq!(
        refused.unwrap_err(),
        LinkError::NotOwned {
            port,
            owner: Some(me)
        }
    );
    listener.set_nonblocking(true).expect("nonblocking");
    std::thread::sleep(Duration::from_millis(300));
    assert!(
        received.try_recv().is_err(),
        "the refused listener received a request (the token)"
    );
}

#[test]
fn an_accepted_owner_is_asked_and_its_answer_parsed() {
    let answer = b"HTTP/1.1 200 OK\r\nSet-Cookie: nqt_s_1=abc; HttpOnly; Path=/api\r\nContent-Length: 11\r\n\r\n{\"ok\":true}";
    let (port, received, _listener) = one_shot(answer);
    let me = std::process::id();
    let response = link::get(
        &Get::loopback(port, "/api/health", &[("Cookie", "x=y")], TIMEOUT),
        &|pid| pid == me,
    )
    .expect("the owner answers");
    assert_eq!(response.status, 200);
    assert_eq!(response.body, b"{\"ok\":true}");
    assert_eq!(response.cookie("nqt_s_1").as_deref(), Some("abc"));
    let request =
        String::from_utf8(received.recv_timeout(TIMEOUT).expect("the request")).expect("text");
    assert!(
        request.starts_with("GET /api/health HTTP/1.1\r\n"),
        "{request}"
    );
    assert!(
        request.contains(&format!("Host: 127.0.0.1:{port}\r\n"))
            && request.contains("Cookie: x=y\r\n")
    );
}

#[test]
fn chunked_and_sized_answers_parse() {
    let chunked = link::parse_response(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n4\r\nwiki\r\n5\r\npedia\r\n0\r\n\r\n")
        .expect("chunked");
    assert_eq!(chunked.body, b"wikipedia");
    let sized =
        link::parse_response(b"HTTP/1.0 401 Unauthorized\r\nContent-Length: 3\r\n\r\nabcdef")
            .expect("sized");
    assert_eq!(
        (sized.status, sized.body.as_slice()),
        (401, b"abc".as_slice())
    );
    assert!(link::parse_response(b"SSH-2.0-OpenSSH\r\n\r\n").is_err());
}

#[test]
fn the_macs_match_the_backend_known_answers() {
    let n = nonce();
    let ready = link::mac_hex(TOKEN, link::READY_KIND, &n, 53117, 4120);
    let proof = link::mac_hex(TOKEN, link::PROOF_KIND, &n, 53117, 4120);
    assert_eq!(
        (ready.as_deref(), proof.as_deref()),
        (Some(READY_KAT), Some(PROOF_KAT))
    );
    assert!(link::verify_mac(
        TOKEN,
        link::READY_KIND,
        &n,
        53117,
        4120,
        READY_KAT
    ));
    let upper = PROOF_KAT.to_uppercase();
    assert!(link::verify_mac(
        TOKEN,
        link::PROOF_KIND,
        &n,
        53117,
        4120,
        &upper
    ));
}

/// (token, kind, nonce, port, pid, claimed MAC) for one verification.
type Case<'a> = (&'a str, &'a str, &'a str, u16, u32, &'a str);

#[test]
fn any_other_kind_port_pid_nonce_or_token_fails() {
    let (n, other_nonce, other_token) = (nonce(), "cd".repeat(32), "11".repeat(32));
    let (ready, proof) = (link::READY_KIND, link::PROOF_KIND);
    let cases: [Case<'_>; 7] = [
        (TOKEN, proof, &n, 53117, 4120, READY_KAT),
        (TOKEN, ready, &n, 53118, 4120, READY_KAT),
        (TOKEN, ready, &n, 53117, 4121, READY_KAT),
        (TOKEN, ready, &other_nonce, 53117, 4120, READY_KAT),
        (&other_token, ready, &n, 53117, 4120, READY_KAT),
        (TOKEN, ready, &n, 53117, 4120, "not hex"),
        ("short", ready, &n, 53117, 4120, READY_KAT),
    ];
    for (token, kind, nonce, port, pid, claimed) in cases {
        let passed = link::verify_mac(token, kind, nonce, port, pid, claimed);
        assert!(!passed, "accepted {kind} for port {port} pid {pid}");
    }
}

#[test]
fn fresh_secrets_are_64_hex_and_differ() {
    let (a, b) = (link::fresh_secret(), link::fresh_secret());
    assert_eq!(a.len(), 64);
    assert!(
        a.chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
    );
    assert_ne!(a, b);
}
