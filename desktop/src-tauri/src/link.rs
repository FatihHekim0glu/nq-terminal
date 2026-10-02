//! The link to the backend (03 section 6 item 2; 04 D4.3): the ONLY module allowed a TCP connection, and only to
//! 127.0.0.1 on the handshake's port. The Clippy bans in clippy.toml (std::net::TcpStream) are allowed on the one
//! function that opens the socket (`get`) and nowhere else.
//!
//! STAGE A: the host rule is complete; `get` is a stub with its final signature. Stage B (slice
//! w4b-supervise-link) fills the HTTP/1.1 GET with its timeout, used for the proof, /api/session, /api/health and
//! /api/jobs.
#![allow(
    dead_code,
    reason = "stage A stub: stage B wires every entry point (04 D4)"
)]

use std::fmt;
use std::net::Ipv4Addr;
use std::time::Duration;

/// The only host the shell ever connects to.
pub const LOOPBACK: Ipv4Addr = Ipv4Addr::LOCALHOST;
/// The owner's browser backend: the shell never connects to it.
pub const OWNER_PORT: u16 = 8765;

/// One HTTP response from the backend.
#[derive(Debug, Default)]
pub struct Response {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum LinkError {
    /// A host other than 127.0.0.1 was asked for.
    HostRefused(String),
    /// A port of 0 or the owner's browser port.
    PortRefused(u16),
    Timeout,
    Io(String),
    Protocol(String),
    /// Stage B fills the request itself.
    NotReady,
}

impl fmt::Display for LinkError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::HostRefused(host) => write!(
                f,
                "host {host} refused: the shell connects to 127.0.0.1 only"
            ),
            Self::PortRefused(port) => write!(f, "port {port} refused"),
            Self::Timeout => write!(f, "the backend did not answer in time"),
            Self::Io(why) => write!(f, "connection failed: {why}"),
            Self::Protocol(why) => write!(f, "bad answer: {why}"),
            Self::NotReady => write!(f, "the link is not built yet"),
        }
    }
}

impl std::error::Error for LinkError {}

/// Accepts only the literal 127.0.0.1 (no name lookup, no other loopback form).
pub fn check_host(host: &str) -> Result<Ipv4Addr, LinkError> {
    match host.parse::<Ipv4Addr>() {
        Ok(addr) if addr == LOOPBACK && host == "127.0.0.1" => Ok(addr),
        _ => Err(LinkError::HostRefused(host.to_string())),
    }
}

/// Accepts any port but 0 and the owner's browser port.
pub fn check_port(port: u16) -> Result<u16, LinkError> {
    if port == 0 || port == OWNER_PORT {
        Err(LinkError::PortRefused(port))
    } else {
        Ok(port)
    }
}

/// `GET <path_and_query>` on 127.0.0.1:<port> with the given extra headers. STUB: refuses every call after the
/// host and port rules.
#[allow(
    clippy::disallowed_types,
    clippy::disallowed_methods,
    reason = "the one function allowed a TCP connection (03 section 6 item 2); stage B opens the socket here"
)]
pub fn get(
    port: u16,
    path_and_query: &str,
    headers: &[(&str, &str)],
    timeout: Duration,
) -> Result<Response, LinkError> {
    check_port(port)?;
    let _ = (path_and_query, headers, timeout);
    Err(LinkError::NotReady)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_literal_loopback_address_passes() {
        assert_eq!(check_host("127.0.0.1"), Ok(LOOPBACK));
        for host in [
            "localhost",
            "127.0.0.2",
            "0.0.0.0",
            "::1",
            "192.168.1.10",
            "127.1",
            "example.com",
            "",
        ] {
            assert!(check_host(host).is_err(), "accepted {host}");
        }
    }

    #[test]
    fn owner_port_and_zero_are_refused() {
        assert!(check_port(OWNER_PORT).is_err());
        assert!(check_port(0).is_err());
        assert_eq!(check_port(53117), Ok(53117));
    }
}
