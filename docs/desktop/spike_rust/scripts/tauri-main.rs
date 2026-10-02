#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
// Spike shell: opens one window on NQ_URL (the terminal backend), optionally hidden, optionally with an
// init script (NQ_INIT_JS = a file path), and appends epoch-ms milestones to NQ_SPIKE_LOG.
use std::io::Write;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{WebviewUrl, WebviewWindowBuilder};

fn epoch_ms() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
}

fn log(tag: &str) {
    if let Ok(path) = std::env::var("NQ_SPIKE_LOG") {
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(f, "{} {}", tag, epoch_ms());
        }
    }
}

fn main() {
    log("main");
    tauri::Builder::default()
        .on_page_load(|_w, payload| {
            let tag = match payload.event() {
                tauri::webview::PageLoadEvent::Started => "page_started",
                tauri::webview::PageLoadEvent::Finished => "page_finished",
            };
            log(tag);
        })
        .setup(|app| {
            log("setup");
            let url = std::env::var("NQ_URL").unwrap_or_else(|_| "http://127.0.0.1:8791/".into());
            let hidden = std::env::var("NQ_HIDDEN").map(|v| v == "1").unwrap_or(false);
            let mut b = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url.parse().unwrap()))
                .title("NQ Terminal Spike")
                .inner_size(1600.0, 1000.0)
                .visible(!hidden)
                .focused(!hidden);
            if let Ok(p) = std::env::var("NQ_INIT_JS") {
                if let Ok(js) = std::fs::read_to_string(p) {
                    b = b.initialization_script(js);
                }
            }
            b.build()?;
            log("window_built");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running app");
}
