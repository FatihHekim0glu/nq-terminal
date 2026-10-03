//! The link to the backend (03 sections 2.2, 4.2 and 6 item 2; 04 D4.3; 05 G08): the ONLY module allowed a TCP
//! connection, and only to the literal 127.0.0.1. The Clippy bans in clippy.toml (std::net::TcpStream and its
//! connect calls) are allowed on the one function that opens the socket (`get`) and nowhere else.
//!
//! Every request names who may answer it. Before connecting, the listener on 127.0.0.1:<port> must belong to an
//! accepted process (GetExtendedTcpTable, listener rows); after connecting and BEFORE a byte is written, the far end
//! of this very connection must belong to an accepted process too (the server-side row of the connection table), so
//! a header, and above all the token, is never sent to a listener that failed the ownership check, even one swapped
//! in between the two looks. The challenge-response MACs (`ready|nonce|port|pid` for NQT-READY, `proof|...` for
//! /api/desktop/proof) are computed here with the token's raw bytes as the key; the proof request itself carries no
//! secret and no Authorization header.

use hmac::{Hmac, KeyInit, Mac};
use serde::Deserialize;
use serde::de::DeserializeOwned;
use sha2::Sha256;
use std::fmt;
use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4};
use std::time::{Duration, Instant};
use windows::Win32::NetworkManagement::IpHelper::{
    GetExtendedTcpTable, TCP_TABLE_CLASS, TCP_TABLE_OWNER_PID_CONNECTIONS,
    TCP_TABLE_OWNER_PID_LISTENER,
};

/// The only host the shell ever connects to.
pub const LOOPBACK: Ipv4Addr = Ipv4Addr::LOCALHOST;
/// The owner's browser backend: the shell never connects to it.
pub const OWNER_PORT: u16 = 8765;
/// The largest answer the shell reads; its routes answer a few hundred bytes.
pub const MAX_RESPONSE_BYTES: usize = 1024 * 1024;
/// The two MAC kinds, so a READY answer can never be replayed as a proof answer or the other way round.
pub const READY_KIND: &str = "ready";
pub const PROOF_KIND: &str = "proof";
/// The session cookie's name carries the port (cookies do not separate by port on 127.0.0.1).
pub const COOKIE_PREFIX: &str = "nqt_s_";
/// Secrets are 32 random bytes, written as 64 lowercase hex characters.
pub const SECRET_BYTES: usize = 32;

const AF_INET: u32 = 2;
const NO_ERROR: u32 = 0;
const ERROR_INSUFFICIENT_BUFFER: u32 = 122;
const ROW_WORDS: usize = 6;
const TABLE_ATTEMPTS: usize = 4;
const USER_AGENT: &str = "nq-lab-terminal-shell";

type HmacSha256 = Hmac<Sha256>;

/// One HTTP response from the backend.
#[derive(Debug, Default)]
pub struct Response {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Response {
    /// The first header of that name (case-insensitive).
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(n, _)| n.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }

    /// The value a `Set-Cookie` header gives the cookie `name`.
    pub fn cookie(&self, name: &str) -> Option<String> {
        self.headers
            .iter()
            .filter(|(n, _)| n.eq_ignore_ascii_case("set-cookie"))
            .filter_map(|(_, v)| v.split(';').next()?.trim().split_once('='))
            .find(|(n, _)| *n == name)
            .map(|(_, value)| value.to_string())
    }

    /// The body as JSON, only for a 200 answer.
    pub fn json<T: DeserializeOwned>(&self) -> Result<T, LinkError> {
        if self.status != 200 {
            return Err(LinkError::Status(self.status));
        }
        serde_json::from_slice(&self.body).map_err(|e| LinkError::Protocol(e.to_string()))
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum LinkError {
    /// A host other than 127.0.0.1 was asked for.
    HostRefused(String),
    /// A port of 0 or the owner's browser port.
    PortRefused(u16),
    /// A path or header that could split the request.
    BadRequest(String),
    /// The listener, or the far end of the connection, belongs to a process that is not accepted (or to none).
    NotOwned {
        port: u16,
        owner: Option<u32>,
    },
    /// The backend answered with a status other than 200.
    Status(u16),
    Timeout,
    Io(String),
    Protocol(String),
}

impl fmt::Display for LinkError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::HostRefused(host) => write!(
                f,
                "host {host} refused: the shell connects to 127.0.0.1 only"
            ),
            Self::PortRefused(port) => write!(f, "port {port} refused"),
            Self::BadRequest(why) => write!(f, "request refused: {why}"),
            Self::NotOwned { port, owner } => match owner {
                Some(pid) => write!(f, "port {port} belongs to process {pid}, not the backend"),
                None => write!(f, "no single process of the backend listens on port {port}"),
            },
            Self::Status(code) => write!(f, "the backend answered {code}"),
            Self::Timeout => write!(f, "the backend did not answer in time"),
            Self::Io(why) => write!(f, "connection failed: {why}"),
            Self::Protocol(why) => write!(f, "bad answer: {why}"),
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

// ---------------------------------------------------------------- who owns a port

/// One IPv4 row of an owner-pid TCP table.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Row {
    local: SocketAddrV4,
    remote: SocketAddrV4,
    pid: u32,
}

fn row_from(words: &[u32; ROW_WORDS]) -> Row {
    let addr =
        |a: u32, p: u32| SocketAddrV4::new(Ipv4Addr::from(u32::from_be(a)), u16::from_be(p as u16));
    Row {
        local: addr(words[1], words[2]),
        remote: addr(words[3], words[4]),
        pid: words[5],
    }
}

/// The IPv4 rows of one owner-pid table class. The buffer is u32 words, so the table is read without casts: the
/// entry count, then six words per row (state, local address, local port, remote address, remote port, pid).
fn tcp_rows(class: TCP_TABLE_CLASS) -> Result<Vec<Row>, LinkError> {
    let mut size = 0u32;
    for _ in 0..TABLE_ATTEMPTS {
        let mut words = vec![0u32; (size as usize).div_ceil(4).max(1)];
        let byte_len = (words.len() * 4) as u32;
        size = byte_len;
        // SAFETY: the buffer holds `size` writable bytes, and `size` is a valid out-pointer for the call.
        let code = unsafe {
            GetExtendedTcpTable(
                Some(words.as_mut_ptr().cast()),
                &mut size,
                false,
                AF_INET,
                class,
                0,
            )
        };
        match code {
            NO_ERROR => {
                let count = words[0] as usize;
                let rows = words[1..]
                    .as_chunks::<ROW_WORDS>()
                    .0
                    .iter()
                    .take(count)
                    .map(row_from);
                return Ok(rows.collect());
            }
            ERROR_INSUFFICIENT_BUFFER => size = size.max(byte_len) + 64 * ROW_WORDS as u32 * 4,
            other => {
                return Err(LinkError::Io(format!(
                    "GetExtendedTcpTable failed with {other}"
                )));
            }
        }
    }
    Err(LinkError::Io("the TCP table kept growing".into()))
}

fn listener_pids(rows: &[Row], port: u16) -> Vec<u32> {
    let mut pids: Vec<u32> = rows
        .iter()
        .filter(|r| r.local.port() == port)
        .filter(|r| *r.local.ip() == LOOPBACK || r.local.ip().is_unspecified())
        .map(|r| r.pid)
        .collect();
    pids.sort_unstable();
    pids.dedup();
    pids
}

/// The one process listening on 127.0.0.1:<port> (or on every IPv4 address at that port). No listener, or
/// listeners of more than one process, is an error: nobody can vouch for such a port.
pub fn listener_owner(port: u16) -> Result<u32, LinkError> {
    match listener_pids(&tcp_rows(TCP_TABLE_OWNER_PID_LISTENER)?, port).as_slice() {
        [pid] => Ok(*pid),
        _ => Err(LinkError::NotOwned { port, owner: None }),
    }
}

/// The process on the server side of the connection from 127.0.0.1:<client_port> to 127.0.0.1:<server_port>.
fn peer_owner(server_port: u16, client_port: u16) -> Result<Option<u32>, LinkError> {
    let rows = tcp_rows(TCP_TABLE_OWNER_PID_CONNECTIONS)?;
    Ok(rows
        .iter()
        .find(|r| {
            r.local == SocketAddrV4::new(LOOPBACK, server_port)
                && r.remote == SocketAddrV4::new(LOOPBACK, client_port)
        })
        .map(|r| r.pid))
}

// ---------------------------------------------------------------- the one GET

/// One GET on the loopback port.
#[derive(Clone, Copy, Debug)]
pub struct Get<'a> {
    pub host: &'a str,
    pub port: u16,
    pub path: &'a str,
    pub headers: &'a [(&'a str, &'a str)],
    pub timeout: Duration,
}

impl<'a> Get<'a> {
    /// A GET on 127.0.0.1.
    pub fn loopback(
        port: u16,
        path: &'a str,
        headers: &'a [(&'a str, &'a str)],
        timeout: Duration,
    ) -> Self {
        Self {
            host: "127.0.0.1",
            port,
            path,
            headers,
            timeout,
        }
    }
}

fn token_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || "-_".contains(c)
}

/// The request head; a path or a header that could split the request is refused.
fn request_head(req: &Get<'_>) -> Result<String, LinkError> {
    if !req.path.starts_with('/') || !req.path.chars().all(|c| c.is_ascii_graphic()) {
        return Err(LinkError::BadRequest(
            "the path must be printable ASCII from /".into(),
        ));
    }
    let mut head = format!(
        "GET {} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nConnection: close\r\nAccept: application/json\r\nUser-Agent: {USER_AGENT}\r\n",
        req.path, req.port
    );
    for (name, value) in req.headers {
        let clean = value.chars().all(|c| c == ' ' || c.is_ascii_graphic());
        if name.is_empty() || !name.chars().all(token_char) || !clean {
            return Err(LinkError::BadRequest(format!("header {name} refused")));
        }
        head.push_str(&format!("{name}: {value}\r\n"));
    }
    head.push_str("\r\n");
    Ok(head)
}

fn left(deadline: Instant) -> Result<Duration, LinkError> {
    let rest = deadline.saturating_duration_since(Instant::now());
    if rest.is_zero() {
        Err(LinkError::Timeout)
    } else {
        Ok(rest)
    }
}

fn io_error(e: &std::io::Error) -> LinkError {
    match e.kind() {
        std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock => LinkError::Timeout,
        _ => LinkError::Io(e.to_string()),
    }
}

/// `GET` on 127.0.0.1:<port>, answered only by a process `owner_ok` accepts: the listener is checked before the
/// connect, and the far end of the connection after it, before the request (with its headers) is written.
#[allow(
    clippy::disallowed_types,
    clippy::disallowed_methods,
    reason = "the one function allowed a TCP connection (03 section 6 item 2), to 127.0.0.1 only"
)]
pub fn get(req: &Get<'_>, owner_ok: &dyn Fn(u32) -> bool) -> Result<Response, LinkError> {
    let addr = SocketAddrV4::new(check_host(req.host)?, check_port(req.port)?);
    let head = request_head(req)?;
    let deadline = Instant::now() + req.timeout;
    let listener = listener_owner(req.port)?;
    if !owner_ok(listener) {
        return Err(LinkError::NotOwned {
            port: req.port,
            owner: Some(listener),
        });
    }
    let mut stream = std::net::TcpStream::connect_timeout(&SocketAddr::V4(addr), left(deadline)?)
        .map_err(|e| io_error(&e))?;
    let client_port = stream.local_addr().map_err(|e| io_error(&e))?.port();
    let peer = peer_owner(req.port, client_port)?;
    if !peer.is_some_and(owner_ok) {
        return Err(LinkError::NotOwned {
            port: req.port,
            owner: peer,
        });
    }
    stream
        .set_write_timeout(Some(left(deadline)?))
        .map_err(|e| io_error(&e))?;
    stream
        .write_all(head.as_bytes())
        .map_err(|e| io_error(&e))?;
    let raw = read_until_closed(&mut stream, deadline, |s, d| s.set_read_timeout(Some(d)))?;
    parse_response(&raw)
}

/// Reads until the server closes (the request says `Connection: close`), within the deadline and the size cap.
fn read_until_closed<S: Read>(
    stream: &mut S,
    deadline: Instant,
    set_timeout: impl Fn(&S, Duration) -> std::io::Result<()>,
) -> Result<Vec<u8>, LinkError> {
    let mut raw = Vec::new();
    let mut chunk = [0u8; 16 * 1024];
    loop {
        set_timeout(stream, left(deadline)?).map_err(|e| io_error(&e))?;
        let n = match stream.read(&mut chunk) {
            Ok(n) => n,
            // A server that resets after its whole answer has still answered.
            Err(e) if e.kind() == std::io::ErrorKind::ConnectionReset && !raw.is_empty() => 0,
            Err(e) => return Err(io_error(&e)),
        };
        if n == 0 {
            return Ok(raw);
        }
        raw.extend_from_slice(&chunk[..n]);
        if raw.len() > MAX_RESPONSE_BYTES {
            return Err(LinkError::Protocol("the answer is too large".into()));
        }
    }
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

/// Status line, headers and body of an HTTP/1.1 answer (Content-Length or chunked, or up to the close).
pub fn parse_response(raw: &[u8]) -> Result<Response, LinkError> {
    let bad = |why: &str| LinkError::Protocol(why.to_string());
    let end = find(raw, b"\r\n\r\n").ok_or_else(|| bad("no end of headers"))?;
    let head = std::str::from_utf8(&raw[..end]).map_err(|_| bad("headers are not text"))?;
    let mut lines = head.split("\r\n");
    let status_line = lines.next().unwrap_or_default();
    let mut parts = status_line.splitn(3, ' ');
    if !parts.next().is_some_and(|v| v.starts_with("HTTP/1.")) {
        return Err(bad("not an HTTP/1.x answer"));
    }
    let status = parts
        .next()
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| bad("no status"))?;
    let headers: Vec<(String, String)> = lines
        .filter_map(|l| l.split_once(':'))
        .map(|(n, v)| (n.trim().to_string(), v.trim().to_string()))
        .collect();
    let mut response = Response {
        status,
        headers,
        body: Vec::new(),
    };
    let rest = &raw[end + 4..];
    response.body = if response
        .header("transfer-encoding")
        .is_some_and(|v| v.eq_ignore_ascii_case("chunked"))
    {
        dechunk(rest)?
    } else if let Some(length) = response.header("content-length") {
        let n: usize = length.parse().map_err(|_| bad("bad Content-Length"))?;
        rest.get(..n)
            .ok_or_else(|| bad("the body is shorter than its length"))?
            .to_vec()
    } else {
        rest.to_vec()
    };
    Ok(response)
}

fn dechunk(mut rest: &[u8]) -> Result<Vec<u8>, LinkError> {
    let bad = |why: &str| LinkError::Protocol(why.to_string());
    let mut body = Vec::new();
    loop {
        let line_end = find(rest, b"\r\n").ok_or_else(|| bad("bad chunk"))?;
        let size_text = std::str::from_utf8(&rest[..line_end]).map_err(|_| bad("bad chunk"))?;
        let size = usize::from_str_radix(size_text.split(';').next().unwrap_or("").trim(), 16)
            .map_err(|_| bad("bad chunk size"))?;
        rest = &rest[line_end + 2..];
        if size == 0 {
            return Ok(body);
        }
        body.extend_from_slice(rest.get(..size).ok_or_else(|| bad("short chunk"))?);
        rest = rest.get(size + 2..).ok_or_else(|| bad("short chunk"))?;
    }
}

// ---------------------------------------------------------------- secrets and MACs

pub fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Lowercase or uppercase hex to bytes; None for anything else.
pub fn from_hex(text: &str) -> Option<Vec<u8>> {
    if !text.len().is_multiple_of(2) {
        return None;
    }
    (0..text.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(text.get(i..i + 2)?, 16).ok())
        .collect()
}

/// A fresh secret: 32 bytes from the operating system's generator, as 64 lowercase hex characters.
pub fn fresh_secret() -> String {
    let mut bytes = [0u8; SECRET_BYTES];
    rand::fill(&mut bytes);
    to_hex(&bytes)
}

fn keyed(token_hex: &str, kind: &str, nonce_hex: &str, port: u16, pid: u32) -> Option<HmacSha256> {
    let key = from_hex(token_hex).filter(|k| k.len() == SECRET_BYTES)?;
    let mut mac = HmacSha256::new_from_slice(&key).ok()?;
    mac.update(format!("{kind}|{nonce_hex}|{port}|{pid}").as_bytes());
    Some(mac)
}

/// HMAC-SHA256 keyed by the token's raw bytes over the ASCII text `kind|nonce|port|pid`, in hex.
#[allow(
    dead_code,
    reason = "the known-answer tests in tests/link_*.rs check the MAC against the backend's"
)]
pub fn mac_hex(
    token_hex: &str,
    kind: &str,
    nonce_hex: &str,
    port: u16,
    pid: u32,
) -> Option<String> {
    keyed(token_hex, kind, nonce_hex, port, pid).map(|m| to_hex(&m.finalize().into_bytes()))
}

/// Whether `claimed` is that MAC, compared in constant time.
pub fn verify_mac(
    token_hex: &str,
    kind: &str,
    nonce_hex: &str,
    port: u16,
    pid: u32,
    claimed: &str,
) -> bool {
    let (Some(mac), Some(claimed)) = (
        keyed(token_hex, kind, nonce_hex, port, pid),
        from_hex(claimed),
    ) else {
        return false;
    };
    mac.verify_slice(&claimed).is_ok()
}

// ---------------------------------------------------------------- the shell's routes

/// The answer of `/api/desktop/proof`.
#[derive(Clone, Debug, Deserialize)]
pub struct ProofBody {
    pub proof: String,
    pub root: String,
    pub prefix: String,
    pub contract: i64,
    pub pid: u32,
}

/// `GET /api/desktop/proof?nonce=<nonce>`: no Authorization header and no secret go out.
pub fn proof(
    port: u16,
    nonce_hex: &str,
    owner_ok: &dyn Fn(u32) -> bool,
    timeout: Duration,
) -> Result<ProofBody, LinkError> {
    let path = format!("/api/desktop/proof?nonce={nonce_hex}");
    get(&Get::loopback(port, &path, &[], timeout), owner_ok)?.json()
}

pub fn cookie_name(port: u16) -> String {
    format!("{COOKIE_PREFIX}{port}")
}

pub fn origin(port: u16) -> String {
    format!("http://127.0.0.1:{port}")
}

/// `GET /api/session` with the token and the page's origin: the session value the backend set as `nqt_s_<port>`.
pub fn session(
    port: u16,
    token_hex: &str,
    owner_ok: &dyn Fn(u32) -> bool,
    timeout: Duration,
) -> Result<String, LinkError> {
    let authorization = format!("NQT {token_hex}");
    let origin = origin(port);
    let headers = [
        ("Authorization", authorization.as_str()),
        ("X-NQT-Origin", origin.as_str()),
    ];
    let answer = get(
        &Get::loopback(port, "/api/session", &headers, timeout),
        owner_ok,
    )?;
    if answer.status != 200 {
        return Err(LinkError::Status(answer.status));
    }
    answer
        .cookie(&cookie_name(port))
        .filter(|v| v.len() == 2 * SECRET_BYTES && from_hex(v).is_some())
        .ok_or_else(|| LinkError::Protocol("no session cookie in the answer".into()))
}

/// A GET with the session cookie (for /api/health and /api/jobs).
pub fn with_session(
    port: u16,
    path: &str,
    session: &str,
    owner_ok: &dyn Fn(u32) -> bool,
    timeout: Duration,
) -> Result<Response, LinkError> {
    let cookie = format!("{}={session}", cookie_name(port));
    get(
        &Get::loopback(port, path, &[("Cookie", cookie.as_str())], timeout),
        owner_ok,
    )
}

#[derive(Deserialize)]
struct JobCounts {
    running: u32,
}

/// How many backtests the backend is running (`GET /api/jobs`), for the close confirmation (O11).
pub fn running_jobs(
    port: u16,
    session: &str,
    owner_ok: &dyn Fn(u32) -> bool,
    timeout: Duration,
) -> Result<u32, LinkError> {
    Ok(with_session(port, "/api/jobs", session, owner_ok, timeout)?
        .json::<JobCounts>()?
        .running)
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
