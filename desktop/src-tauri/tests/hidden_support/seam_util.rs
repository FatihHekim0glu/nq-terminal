//! Small helpers of the INT1 seam run: polling, and reading the shell log. Kept apart so `int1_seams.rs` stays under
//! the 800-line ceiling.

use serde_json::Value;
use std::time::{Duration, Instant};

pub fn wait_until<T>(what: &str, limit: Duration, mut probe: impl FnMut() -> Option<T>) -> T {
    let started = Instant::now();
    loop {
        if let Some(found) = probe() {
            return found;
        }
        assert!(
            started.elapsed() < limit,
            "gave up waiting for {what} after {limit:?}"
        );
        std::thread::sleep(Duration::from_millis(100));
    }
}

pub fn first_event<'a>(log: &'a [Value], event: &str) -> &'a Value {
    log.iter()
        .find(|e| e["event"] == event)
        .unwrap_or_else(|| panic!("no {event} in the shell log: {log:?}"))
}

pub fn position_of(log: &[Value], event: &str) -> usize {
    log.iter()
        .position(|e| e["event"] == event)
        .unwrap_or_else(|| panic!("no {event} in the shell log: {log:?}"))
}
