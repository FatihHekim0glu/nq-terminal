//! The HOME probe the smoke runs read over the debugging protocol must survive the first start after a fresh
//! build, when the page is still navigating: the engine then sends events with no `id` and an error reply to the
//! first evaluation ("Execution context was destroyed"). The probe has to skip the events, treat the error as
//! "not ready yet" and ask again, never end its process on a missing field.
//!
//! The stand-in below is a debugging-protocol page target made of Node's standard library: it lists one page,
//! answers the first evaluation with an event and an error, and every later one with a ready HOME.
//! Born failing: the probe that parsed the first message it saw ended with "Cannot read properties of undefined
//! (reading 'result')" and printed nothing.
#![cfg(feature = "smoke")]
#![allow(
    clippy::disallowed_methods,
    reason = "test harness: it starts a Node process it owns"
)]

#[allow(
    dead_code,
    reason = "this binary uses a part of the shared support files"
)]
#[path = "hidden_support/labs.rs"]
mod labs;
#[path = "hidden_support/launch.rs"]
mod launch_support;
#[path = "hidden_support/watch.rs"]
mod watch;

use launch_support::{CREATE_NO_WINDOW, Owned, wait_for_home};
use std::io::{BufRead, BufReader};
use std::os::windows::process::CommandExt;
use std::process::{Command, Stdio};

/// A page target over HTTP and a bare WebSocket (RFC 6455 handshake, unmasked text frames out).
const FAKE_PAGE_JS: &str = r#"import http from 'node:http';
import crypto from 'node:crypto';
let evaluations = 0;
const srv = http.createServer((req, res) => {
  if (req.url === '/json/list') {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify([{ type: 'page', url: 'http://127.0.0.1:1/', webSocketDebuggerUrl: `ws://127.0.0.1:${srv.address().port}/devtools/page/1` }]));
  } else { res.statusCode = 404; res.end(); }
});
const frame = (obj) => {
  const body = Buffer.from(JSON.stringify(obj));
  const head = body.length < 126 ? Buffer.from([0x81, body.length]) : Buffer.from([0x81, 126, body.length >> 8, body.length & 255]);
  return Buffer.concat([head, body]);
};
srv.on('upgrade', (req, sock) => {
  const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  sock.on('error', () => {});
  sock.on('data', (chunk) => {
    if (chunk[0] === 0x88) { sock.end(Buffer.from([0x88, 0x00])); return; }
    if (chunk[0] !== 0x81) return;
    evaluations += 1;
    if (evaluations === 1) {
      sock.write(frame({ method: 'Runtime.executionContextsCleared', params: {} }));
      sock.write(frame({ id: 1, error: { code: -32000, message: 'Execution context was destroyed.' } }));
    } else {
      const value = JSON.stringify({ ready: true, panels: 4, visibility: 'visible', url: 'http://127.0.0.1:1/' });
      sock.write(frame({ id: 1, result: { result: { type: 'string', value } } }));
    }
  });
});
srv.listen(0, '127.0.0.1', () => console.log(srv.address().port));
"#;

#[test]
fn home_probe_asks_again_after_an_event_and_an_error_reply() {
    let mut server = Command::new("node")
        .args(["--input-type=module", "-e", FAKE_PAGE_JS])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .unwrap_or_else(|e| panic!("cannot run node for the stand-in page: {e}"));
    let stdout = server.stdout.take().expect("piped stdout");
    let server = Owned(server);
    let mut first = String::new();
    BufReader::new(stdout)
        .read_line(&mut first)
        .expect("the stand-in prints its port");
    let port: u16 = first.trim().parse().expect("a port number");

    let home = wait_for_home(port, "http://127.0.0.1:");

    assert_eq!(home["ready"], true, "the probe did not settle: {home}");
    assert_eq!(home["panels"], 4);
    drop(server);
}
