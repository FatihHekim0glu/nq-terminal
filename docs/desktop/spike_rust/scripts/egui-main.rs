#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
// Native micro-benchmark: eframe + egui_plot line chart (1,000,000 points, programmatic pan and zoom) and an
// 8,411-row virtualised table with sorting, all on synthetic data. The window is created hidden.
// Args: --mode both|chart|chart-dec|table  --secs N (work phase)  --idle-ms N  --visible  --vsync  --out FILE
use std::io::Write;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use eframe::egui;
use egui_extras::{Column, TableBuilder};
use egui_plot::{Line, Plot, PlotBounds, PlotPoint, PlotPoints};

const N_POINTS: usize = 1_000_000;
const N_ROWS: usize = 8_411;
const WARMUP_FRAMES: usize = 30;

fn epoch_ms() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
}

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> f64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        (self.0 >> 11) as f64 / (1u64 << 53) as f64
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Mode {
    Both,
    Chart,
    ChartDec,
    BothDec,
    Table,
}

struct Row {
    id: u32,
    symbol: &'static str,
    side: &'static str,
    qty: u32,
    price: f64,
    pnl: f64,
    ts: u64,
}

struct App {
    mode: Mode,
    pts: Vec<PlotPoint>,
    rows: Vec<Row>,
    order: Vec<usize>,
    sort_col: usize,
    sort_asc: bool,
    // run control
    secs: f64,
    idle_ms: u64,
    out: String,
    t_start: Instant,
    t_work: Option<Instant>,
    frames: usize,
    last_ui: Option<Instant>,
    intervals_ms: Vec<f64>,
    ui_ms: Vec<f64>,
    sort_ms: Vec<f64>,
    first_frame_logged: bool,
    idle_logged: bool,
    work_logged: bool,
    data_gen_ms: f64,
    setup_epoch: u128,
    first_frame_epoch: u128,
    dec_buf: Vec<PlotPoint>,
}

fn log(tag: &str) {
    if let Some(p) = arg_val("--log") {
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(p) {
            let _ = writeln!(f, "{} {}", tag, epoch_ms());
        }
    }
}

fn arg_val(name: &str) -> Option<String> {
    let a: Vec<String> = std::env::args().collect();
    a.iter().position(|x| x == name).and_then(|i| a.get(i + 1).cloned())
}
fn has_flag(name: &str) -> bool {
    std::env::args().any(|x| x == name)
}

fn percentile(v: &[f64], p: f64) -> f64 {
    if v.is_empty() {
        return -1.0;
    }
    let mut s = v.to_vec();
    s.sort_by(|a, b| a.partial_cmp(b).unwrap());
    s[((s.len() - 1) as f64 * p).round() as usize]
}

impl App {
    fn new() -> Self {
        let t = Instant::now();
        let mut rng = Rng(0x9E3779B97F4A7C15);
        let mut y = 100.0f64;
        let pts: Vec<PlotPoint> = (0..N_POINTS)
            .map(|i| {
                y += (rng.next() - 0.5) * 0.4;
                PlotPoint::new(i as f64, y)
            })
            .collect();
        let syms = ["NQ", "ES", "YM", "RTY", "CL", "GC", "ZN", "6E"];
        let rows: Vec<Row> = (0..N_ROWS)
            .map(|i| Row {
                id: i as u32,
                symbol: syms[(rng.next() * 8.0) as usize % 8],
                side: if rng.next() < 0.5 { "BUY" } else { "SELL" },
                qty: 1 + (rng.next() * 20.0) as u32,
                price: 10000.0 + rng.next() * 9000.0,
                pnl: (rng.next() - 0.45) * 2000.0,
                ts: 1_600_000_000 + (rng.next() * 100_000_000.0) as u64,
            })
            .collect();
        let mode = match arg_val("--mode").as_deref() {
            Some("chart") => Mode::Chart,
            Some("chart-dec") => Mode::ChartDec,
            Some("both-dec") => Mode::BothDec,
            Some("table") => Mode::Table,
            _ => Mode::Both,
        };
        Self {
            mode,
            pts,
            order: (0..rows.len()).collect(),
            rows,
            sort_col: 0,
            sort_asc: true,
            secs: arg_val("--secs").and_then(|s| s.parse().ok()).unwrap_or(8.0),
            idle_ms: arg_val("--idle-ms").and_then(|s| s.parse().ok()).unwrap_or(3000),
            out: arg_val("--out").unwrap_or_else(|| "result.json".into()),
            t_start: Instant::now(),
            t_work: None,
            frames: 0,
            last_ui: None,
            intervals_ms: Vec::new(),
            ui_ms: Vec::new(),
            sort_ms: Vec::new(),
            first_frame_logged: false,
            idle_logged: false,
            work_logged: false,
            data_gen_ms: t.elapsed().as_secs_f64() * 1000.0,
            setup_epoch: epoch_ms(),
            first_frame_epoch: 0,
            dec_buf: Vec::new(),
        }
    }

    fn sort_by(&mut self, col: usize) {
        if self.sort_col == col {
            self.sort_asc = !self.sort_asc;
        } else {
            self.sort_col = col;
            self.sort_asc = true;
        }
        let t = Instant::now();
        let rows = &self.rows;
        let asc = self.sort_asc;
        self.order.sort_by(|&a, &b| {
            let (x, y) = (&rows[a], &rows[b]);
            let o = match col {
                0 => x.id.cmp(&y.id),
                1 => x.symbol.cmp(y.symbol),
                2 => x.side.cmp(y.side),
                3 => x.qty.cmp(&y.qty),
                4 => x.price.partial_cmp(&y.price).unwrap(),
                5 => x.pnl.partial_cmp(&y.pnl).unwrap(),
                _ => x.ts.cmp(&y.ts),
            };
            if asc { o } else { o.reverse() }
        });
        self.sort_ms.push(t.elapsed().as_secs_f64() * 1000.0);
    }

    /// Visible slice by binary search on x (sorted), then per-pixel min/max decimation into dec_buf.
    fn decimate(&mut self, x0: f64, x1: f64, buckets: usize) -> (f64, f64) {
        let lo = self.pts.partition_point(|p| p.x < x0).saturating_sub(1);
        let hi = (self.pts.partition_point(|p| p.x <= x1) + 1).min(self.pts.len());
        let slice = &self.pts[lo..hi];
        let (mut ymin, mut ymax) = (f64::MAX, f64::MIN);
        self.dec_buf.clear();
        if matches!(self.mode, Mode::ChartDec | Mode::BothDec) && slice.len() > buckets * 2 {
            let per = slice.len().div_ceil(buckets);
            for ch in slice.chunks(per) {
                let (mut mn, mut mx) = (ch[0], ch[0]);
                for p in ch {
                    if p.y < mn.y { mn = *p; }
                    if p.y > mx.y { mx = *p; }
                }
                ymin = ymin.min(mn.y);
                ymax = ymax.max(mx.y);
                if mn.x <= mx.x { self.dec_buf.push(mn); self.dec_buf.push(mx); } else { self.dec_buf.push(mx); self.dec_buf.push(mn); }
            }
        } else {
            for p in slice {
                ymin = ymin.min(p.y);
                ymax = ymax.max(p.y);
            }
        }
        (ymin, ymax)
    }

    fn draw(&mut self, ui: &mut egui::Ui, work_t: f64) {
        if self.frames > 0 && self.frames % 120 == 60 && self.mode != Mode::Chart && self.mode != Mode::ChartDec {
            let c = (self.frames / 120) % 7;
            self.sort_by(c);
        }
        let show_chart = self.mode != Mode::Table;
        let show_table = matches!(self.mode, Mode::Both | Mode::BothDec | Mode::Table);
        let mut chart_h = ui.available_height();
        if show_chart && show_table {
            chart_h *= 0.6;
        }
        if show_chart {
            // simulated pan and zoom: the span sweeps 1e3..1e6 points, the centre sweeps the series
            let phase = work_t * 0.6;
            let span = 10f64.powf(3.0 + 3.0 * (0.5 + 0.5 * phase.sin()));
            let centre = (N_POINTS as f64) * (0.5 + 0.4 * (work_t * 0.37).sin());
            let (x0, x1) = ((centre - span / 2.0).max(0.0), (centre + span / 2.0).min(N_POINTS as f64));
            let width_px = ui.available_width().max(200.0) as usize;
            let (ymin, ymax) = self.decimate(x0, x1, width_px);
            let pad = (ymax - ymin).max(1e-6) * 0.05;
            let dec = matches!(self.mode, Mode::ChartDec | Mode::BothDec);
            let pts_ref: &[PlotPoint] = if dec && !self.dec_buf.is_empty() { &self.dec_buf } else { &self.pts };
            Plot::new("chart")
                .height(chart_h)
                .allow_zoom(true)
                .allow_drag(true)
                .allow_scroll(true)
                .show(ui, |pui| {
                    pui.set_plot_bounds(PlotBounds::from_min_max([x0, ymin - pad], [x1, ymax + pad]));
                    pui.line(Line::new("series", PlotPoints::from(pts_ref)));
                });
        }
        if show_table {
            let row_h = 18.0;
            let mut clicked: Option<usize> = None;
            let scroll_row = ((work_t * 2000.0) as usize) % N_ROWS;
            let heads = ["id", "symbol", "side", "qty", "price", "pnl", "ts"];
            TableBuilder::new(ui)
                .striped(true)
                .columns(Column::auto().at_least(80.0), 7)
                .scroll_to_row(scroll_row, Some(egui::Align::Center))
                .header(20.0, |mut h| {
                    for (i, t) in heads.iter().enumerate() {
                        h.col(|ui| {
                            if ui.button(*t).clicked() {
                                clicked = Some(i);
                            }
                        });
                    }
                })
                .body(|body| {
                    body.rows(row_h, self.order.len(), |mut row| {
                        let r = &self.rows[self.order[row.index()]];
                        row.col(|ui| { ui.label(r.id.to_string()); });
                        row.col(|ui| { ui.label(r.symbol); });
                        row.col(|ui| { ui.label(r.side); });
                        row.col(|ui| { ui.label(r.qty.to_string()); });
                        row.col(|ui| { ui.label(format!("{:.2}", r.price)); });
                        row.col(|ui| { ui.label(format!("{:.2}", r.pnl)); });
                        row.col(|ui| { ui.label(r.ts.to_string()); });
                    });
                });
            if let Some(c) = clicked {
                self.sort_by(c);
            }
        }
    }

    fn finish(&mut self, ctx: &egui::Context) {
        let skip = WARMUP_FRAMES.min(self.intervals_ms.len());
        let iv = &self.intervals_ms[skip..];
        let ui = &self.ui_ms[skip.min(self.ui_ms.len())..];
        let mode = match self.mode { Mode::Both => "both", Mode::Chart => "chart", Mode::ChartDec => "chart-dec", Mode::BothDec => "both-dec", Mode::Table => "table" };
        let json = format!(
            "{{\"mode\":\"{}\",\"frames\":{},\"interval_ms\":{{\"median\":{:.3},\"p95\":{:.3},\"p99\":{:.3},\"max\":{:.3}}},\"ui_cpu_ms\":{{\"median\":{:.3},\"p95\":{:.3},\"max\":{:.3}}},\"sorts\":{},\"sort_ms_median\":{:.3},\"data_gen_ms\":{:.1},\"setup_to_first_frame_ms\":{},\"main_epoch\":{}}}",
            mode, self.frames, percentile(iv, 0.5), percentile(iv, 0.95), percentile(iv, 0.99), percentile(iv, 1.0),
            percentile(ui, 0.5), percentile(ui, 0.95), percentile(ui, 1.0),
            self.sort_ms.len(), percentile(&self.sort_ms, 0.5), self.data_gen_ms,
            self.first_frame_epoch.saturating_sub(self.setup_epoch), self.setup_epoch
        );
        let _ = std::fs::write(&self.out, json);
        log("done");
        ctx.send_viewport_cmd(egui::ViewportCommand::Close);
    }
}

impl eframe::App for App {
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        let t_ui = Instant::now();
        let ctx = ui.ctx().clone();
        if !self.first_frame_logged {
            self.first_frame_logged = true;
            self.first_frame_epoch = epoch_ms();
            log("first_frame");
        }
        // idle phase: draw, but do not ask for repaints
        let idle = t_ui.duration_since(self.t_start).as_millis() < self.idle_ms as u128;
        if idle {
            ctx.request_repaint_after(std::time::Duration::from_millis(200));
        } else {
            if !self.idle_logged {
                self.idle_logged = true;
                log("idle_done");
            }
            if self.t_work.is_none() {
                self.t_work = Some(Instant::now());
                log("work_start");
            }
            ctx.request_repaint();
            if let Some(last) = self.last_ui {
                self.intervals_ms.push(t_ui.duration_since(last).as_secs_f64() * 1000.0);
            }
            self.last_ui = Some(t_ui);
            self.frames += 1;
        }
        let work_t = self.t_work.map(|t| t.elapsed().as_secs_f64()).unwrap_or(0.0);
        if work_t > 4.0 && !self.work_logged {
            self.work_logged = true;
            log("work_mid");
        }

        self.draw(ui, work_t);
        if !idle {
            self.ui_ms.push(t_ui.elapsed().as_secs_f64() * 1000.0);
        }
        if self.t_work.map(|t| t.elapsed().as_secs_f64() >= self.secs).unwrap_or(false) {
            self.finish(&ctx);
        }
    }
}

fn offscreen() {
    use eframe::wgpu;
    log("main");
    let ppp = 1.25f32;
    let (w, h) = (2000u32, 1250u32);
    let ctx = egui::Context::default();
    let setup = eframe::egui_wgpu::WgpuSetup::without_display_handle();
    let instance = pollster::block_on(setup.new_instance());
    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
        power_preference: wgpu::PowerPreference::HighPerformance,
        ..Default::default()
    }))
    .expect("adapter");
    let info = adapter.get_info();
    let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor::default())).expect("device");
    let fmt = wgpu::TextureFormat::Rgba8Unorm;
    let mut renderer = eframe::egui_wgpu::Renderer::new(&device, fmt, eframe::egui_wgpu::RendererOptions::default());
    let tex = device.create_texture(&wgpu::TextureDescriptor {
        label: None,
        size: wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: fmt,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let view = tex.create_view(&wgpu::TextureViewDescriptor::default());
    let mut app = App::new();
    log("offscreen_ready");
    let t_boot = Instant::now();
    let idle_ms = app.idle_ms;
    // idle phase: one frame, then sleep (the runner samples memory here)
    let mut frame = |app: &mut App, work_t: f64, clock: f64| -> (f64, f64) {
        let t0 = Instant::now();
        let mut raw = egui::RawInput::default();
        raw.screen_rect = Some(egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(w as f32 / ppp, h as f32 / ppp)));
        raw.time = Some(clock);
        raw.viewports.entry(egui::ViewportId::ROOT).or_default().native_pixels_per_point = Some(ppp);
        let out = ctx.run_ui(raw, |ui| {
            egui::CentralPanel::default().show(ui, |ui| app.draw(ui, work_t));
        });
        let prims = ctx.tessellate(out.shapes, out.pixels_per_point);
        let ui_ms = t0.elapsed().as_secs_f64() * 1000.0;
        for (id, delta) in &out.textures_delta.set {
            for d in delta.iter() { renderer.update_texture(&device, &queue, *id, d); }
        }
        let sd = eframe::egui_wgpu::ScreenDescriptor { size_in_pixels: [w, h], pixels_per_point: out.pixels_per_point };
        let mut enc = device.create_command_encoder(&wgpu::CommandEncoderDescriptor::default());
        let extra = renderer.update_buffers(&device, &queue, &mut enc, &prims, &sd);
        {
            let mut pass = enc
                .begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: None,
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &view,
                        depth_slice: None,
                        resolve_target: None,
                        ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::BLACK), store: wgpu::StoreOp::Store },
                    })],
                    depth_stencil_attachment: None,
                    timestamp_writes: None,
                    occlusion_query_set: None,
                    multiview_mask: None,
                })
                .forget_lifetime();
            renderer.render(&mut pass, &prims, &sd);
        }
        let idx = queue.submit(extra.into_iter().chain(std::iter::once(enc.finish())));
        let _ = device.poll(wgpu::PollType::Wait { submission_index: Some(idx), timeout: None });
        for id in &out.textures_delta.free {
            renderer.free_texture(id);
        }
        (t0.elapsed().as_secs_f64() * 1000.0, ui_ms)
    };
    // first frame (also builds fonts and pipelines): this is the cold-frame cost
    let (first_ms, _) = frame(&mut app, 0.0, 0.0);
    log("first_frame");
    app.first_frame_epoch = epoch_ms();
    std::thread::sleep(std::time::Duration::from_millis(idle_ms));
    log("idle_done");
    log("work_start");
    let t_work = Instant::now();
    let mut totals: Vec<f64> = Vec::new();
    let mut uis: Vec<f64> = Vec::new();
    let mut logged_mid = false;
    while t_work.elapsed().as_secs_f64() < app.secs {
        let wt = t_work.elapsed().as_secs_f64();
        let (tot, u) = frame(&mut app, wt, wt);
        app.frames += 1;
        totals.push(tot);
        uis.push(u);
        if wt > 4.0 && !logged_mid {
            logged_mid = true;
            log("work_mid");
        }
    }
    let skip = WARMUP_FRAMES.min(totals.len());
    let (t, u) = (&totals[skip..], &uis[skip..]);
    let mode = match app.mode { Mode::Both => "both", Mode::Chart => "chart", Mode::ChartDec => "chart-dec", Mode::BothDec => "both-dec", Mode::Table => "table" };
    let json = format!(
        "{{\"mode\":\"{}\",\"offscreen\":true,\"adapter\":\"{} {:?}\",\"size\":\"{}x{}@{}\",\"frames\":{},\"first_frame_ms\":{:.1},\"frame_ms\":{{\"median\":{:.3},\"p95\":{:.3},\"p99\":{:.3},\"max\":{:.3}}},\"cpu_build_ms\":{{\"median\":{:.3},\"p95\":{:.3},\"max\":{:.3}}},\"sorts\":{},\"sort_ms_median\":{:.3},\"data_gen_ms\":{:.1},\"init_ms\":{:.1}}}",
        mode, info.name, info.backend, w, h, ppp, app.frames, first_ms,
        percentile(t, 0.5), percentile(t, 0.95), percentile(t, 0.99), percentile(t, 1.0),
        percentile(u, 0.5), percentile(u, 0.95), percentile(u, 1.0),
        app.sort_ms.len(), percentile(&app.sort_ms, 0.5), app.data_gen_ms, t_boot.elapsed().as_secs_f64() * 1000.0
    );
    let _ = std::fs::write(&app.out, json);
    log("done");
}

fn main() -> eframe::Result {
    if has_flag("--offscreen") {
        offscreen();
        return Ok(());
    }
    log("main");
    let mut options = eframe::NativeOptions::default();
    options.viewport = egui::ViewportBuilder::default()
        .with_inner_size([1600.0, 1000.0])
        .with_visible(has_flag("--visible"))
        .with_active(has_flag("--visible"));
    if !has_flag("--vsync") {
        options.wgpu_options.surface.present_mode = eframe::wgpu::PresentMode::AutoNoVsync;
    }
    eframe::run_native(
        "NQ native spike",
        options,
        Box::new(|_cc| {
            log("app_creator");
            Ok(Box::new(App::new()))
        }),
    )
}
