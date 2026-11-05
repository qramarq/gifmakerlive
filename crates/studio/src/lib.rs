use gpui::{prelude::*, *};
use std::{borrow::Cow, cell::RefCell};
use wasm_bindgen::prelude::*;

#[wasm_bindgen(
    inline_js = "export function settings(setting,fps,width,duration,profile,framing){parent.postMessage({type:'gif-settings',setting,fps,width,duration,profile,framing},location.origin)}"
)]
extern "C" {
    fn settings(setting: &str, fps: i32, width: i32, duration: i32, profile: &str, framing: &str);
}

thread_local! {
    static APPLICATION: RefCell<Option<ApplicationHandle>> = const { RefCell::new(None) };
    static STUDIO: RefCell<Option<Entity<Studio>>> = const { RefCell::new(None) };
}

struct Studio {
    fps: i32,
    width: i32,
    duration: i32,
    image_mode: bool,
    profile: String,
    framing: String,
    height: i32,
    detected: String,
}

fn known_profile(profile: &str) -> bool {
    matches!(
        profile,
        "match"
            | "phone-9-16"
            | "phone-16-9"
            | "phone-4-3"
            | "phone-3-4"
            | "phone-1-1"
            | "dci-17-9"
            | "uhd-16-9"
            | "scope-239"
            | "univisium-200"
            | "flat-185"
            | "open-gate-32"
            | "anamorphic-43"
            | "desqueeze-125"
            | "desqueeze-130"
            | "desqueeze-133"
            | "desqueeze-150"
            | "desqueeze-160"
            | "desqueeze-180"
            | "desqueeze-200"
            | "custom"
    )
}

fn profile_label(profile: &str) -> &'static str {
    match profile {
        "match" => "MATCH",
        "phone-9-16" => "9:16",
        "phone-16-9" => "16:9",
        "phone-4-3" => "4:3",
        "phone-3-4" => "3:4",
        "phone-1-1" => "1:1",
        "dci-17-9" => "DCI 17:9",
        "uhd-16-9" => "UHD 16:9",
        "scope-239" => "SCOPE 2.39",
        "univisium-200" => "2.00:1",
        "flat-185" => "1.85:1",
        "open-gate-32" => "OPEN GATE 3:2",
        "anamorphic-43" => "ANAMORPHIC 4:3",
        "desqueeze-125" => "DESQUEEZE 1.25×",
        "desqueeze-130" => "DESQUEEZE 1.3×",
        "desqueeze-133" => "DESQUEEZE 1.33×",
        "desqueeze-150" => "DESQUEEZE 1.5×",
        "desqueeze-160" => "DESQUEEZE 1.6×",
        "desqueeze-180" => "DESQUEEZE 1.8×",
        "desqueeze-200" => "DESQUEEZE 2×",
        "custom" => "CUSTOM",
        _ => "",
    }
}

#[wasm_bindgen]
pub fn sync_settings(
    fps: i32,
    width: i32,
    duration: i32,
    image_mode: bool,
    profile: &str,
    framing: &str,
    height: i32,
    detected: &str,
) {
    if !(1..=30).contains(&fps) || !(100..=800).contains(&width) || !(1..=6).contains(&duration) {
        return;
    }
    if !known_profile(profile) || (framing != "crop" && framing != "fit") {
        return;
    }
    let detected: String = detected.chars().take(160).collect();
    let height = height.clamp(0, 4096);
    APPLICATION.with(|app| {
        if let Some(app) = app.borrow().as_ref() {
            app.update(|cx| {
                STUDIO.with(|studio| {
                    if let Some(studio) = studio.borrow().as_ref() {
                        studio.update(cx, |s, cx| {
                            s.fps = fps;
                            s.width = width;
                            s.duration = duration;
                            s.image_mode = image_mode;
                            s.profile = profile.to_string();
                            s.framing = framing.to_string();
                            s.height = height;
                            s.detected = detected;
                            cx.notify();
                        });
                    }
                })
            });
        }
    });
}

impl Studio {
    fn publish(&self, setting: &str) {
        settings(setting, self.fps, self.width, self.duration, &self.profile, &self.framing);
    }

    fn choice(&self, id: &'static str, label: String, active: bool) -> Stateful<Div> {
        div()
            .id(id)
            .flex_1()
            .p_3()
            .rounded_lg()
            .border_1()
            .border_color(rgb(if active { 0xc2f970 } else { 0x343737 }))
            .bg(rgb(if active { 0x293822 } else { 0x202323 }))
            .text_color(rgb(if active { 0xc2f970 } else { 0xd9dddd }))
            .text_sm()
            .cursor_pointer()
            .hover(|style| style.bg(rgb(0x34402e)))
            .child(label)
    }

    fn chip(&self, id: &'static str, label: &'static str, active: bool) -> Stateful<Div> {
        div()
            .id(id)
            .flex_1()
            .p_2()
            .rounded_lg()
            .border_1()
            .border_color(rgb(if active { 0xc2f970 } else { 0x343737 }))
            .bg(rgb(if active { 0x293822 } else { 0x202323 }))
            .text_color(rgb(if active { 0xc2f970 } else { 0xd9dddd }))
            .text_xs()
            .cursor_pointer()
            .hover(|style| style.bg(rgb(0x34402e)))
            .child(label)
    }

    fn recipe(&self) -> String {
        let size = if self.height > 0 {
            format!("{}×{}", self.width, self.height)
        } else {
            format!("{} PX", self.width)
        };
        let label = profile_label(&self.profile);
        if label.is_empty() {
            format!("CURRENT RECIPE    {} FPS / {}", self.fps, size)
        } else {
            format!("CURRENT RECIPE    {} FPS / {} · {}", self.fps, size, label)
        }
    }
}

impl Render for Studio {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div().size_full().bg(rgb(0x191c1c)).text_color(rgb(0xf3f5f0)).font_family("IBM Plex Sans")
            .p_6().flex().flex_col().gap_3()
            .child(div().text_xs().text_color(rgb(0xc2f970)).child("02 / MAKE IT YOURS"))
            .child(div().text_2xl().child("The finishing touches."))
            .child(div().text_sm().text_color(rgb(0x9fa8a5)).child("Find the sweet spot between smooth motion and a smaller file."))
            .child(div().mt_1().text_sm().child("Frame rate"))
            .child(div().flex().gap_2()
                .child(self.choice("fps-10", "10 fps".into(), self.fps == 10).on_click(cx.listener(|s, _, _, cx| {s.fps=10; s.publish("fps"); cx.notify();})))
                .child(self.choice("fps-15", "15 fps".into(), self.fps == 15).on_click(cx.listener(|s, _, _, cx| {s.fps=15; s.publish("fps"); cx.notify();})))
                .child(self.choice("fps-24", "24 fps".into(), self.fps == 24).on_click(cx.listener(|s, _, _, cx| {s.fps=24; s.publish("fps"); cx.notify();}))))
            .child(div().text_sm().child("Output width"))
            .child(div().flex().gap_2()
                .child(self.choice("width-320", "320 px".into(), self.width == 320).on_click(cx.listener(|s, _, _, cx| {s.width=320; s.publish("width"); cx.notify();})))
                .child(self.choice("width-480", "480 px".into(), self.width == 480).on_click(cx.listener(|s, _, _, cx| {s.width=480; s.publish("width"); cx.notify();})))
                .child(self.choice("width-720", "720 px".into(), self.width == 720).on_click(cx.listener(|s, _, _, cx| {s.width=720; s.publish("width"); cx.notify();}))))
            .when(!self.image_mode, |view| view
                .child(div().text_sm().child("Camera format"))
                .child(div().flex().gap_2()
                    .child(self.chip("cam-match", "Match", self.profile == "match").on_click(cx.listener(|s, _, _, cx| {s.profile="match".into(); s.publish("camera"); cx.notify();})))
                    .child(self.chip("cam-916", "9:16", self.profile == "phone-9-16").on_click(cx.listener(|s, _, _, cx| {s.profile="phone-9-16".into(); s.publish("camera"); cx.notify();})))
                    .child(self.chip("cam-169", "16:9", self.profile == "phone-16-9").on_click(cx.listener(|s, _, _, cx| {s.profile="phone-16-9".into(); s.publish("camera"); cx.notify();})))
                    .child(self.chip("cam-11", "1:1", self.profile == "phone-1-1").on_click(cx.listener(|s, _, _, cx| {s.profile="phone-1-1".into(); s.publish("camera"); cx.notify();}))))
                .child(div().flex().gap_2()
                    .child(self.chip("cam-dci", "DCI", self.profile == "dci-17-9").on_click(cx.listener(|s, _, _, cx| {s.profile="dci-17-9".into(); s.publish("camera"); cx.notify();})))
                    .child(self.chip("cam-scope", "Scope", self.profile == "scope-239").on_click(cx.listener(|s, _, _, cx| {s.profile="scope-239".into(); s.publish("camera"); cx.notify();})))
                    .child(self.chip("cam-flat", "1.85", self.profile == "flat-185").on_click(cx.listener(|s, _, _, cx| {s.profile="flat-185".into(); s.publish("camera"); cx.notify();})))
                    .child(self.chip("cam-gate", "3:2", self.profile == "open-gate-32").on_click(cx.listener(|s, _, _, cx| {s.profile="open-gate-32".into(); s.publish("camera"); cx.notify();}))))
                .child(div().text_sm().child("Anamorphic desqueeze"))
                .child(div().flex().gap_2()
                    .child(self.chip("ds-125", "1.25", self.profile == "desqueeze-125").on_click(cx.listener(|s, _, _, cx| {s.profile="desqueeze-125".into(); s.publish("camera"); cx.notify();})))
                    .child(self.chip("ds-130", "1.3", self.profile == "desqueeze-130").on_click(cx.listener(|s, _, _, cx| {s.profile="desqueeze-130".into(); s.publish("camera"); cx.notify();})))
                    .child(self.chip("ds-133", "1.33", self.profile == "desqueeze-133").on_click(cx.listener(|s, _, _, cx| {s.profile="desqueeze-133".into(); s.publish("camera"); cx.notify();})))
                    .child(self.chip("ds-150", "1.5", self.profile == "desqueeze-150").on_click(cx.listener(|s, _, _, cx| {s.profile="desqueeze-150".into(); s.publish("camera"); cx.notify();}))))
                .child(div().flex().gap_2()
                    .child(self.chip("ds-160", "1.6", self.profile == "desqueeze-160").on_click(cx.listener(|s, _, _, cx| {s.profile="desqueeze-160".into(); s.publish("camera"); cx.notify();})))
                    .child(self.chip("ds-180", "1.8", self.profile == "desqueeze-180").on_click(cx.listener(|s, _, _, cx| {s.profile="desqueeze-180".into(); s.publish("camera"); cx.notify();})))
                    .child(self.chip("ds-200", "2×", self.profile == "desqueeze-200").on_click(cx.listener(|s, _, _, cx| {s.profile="desqueeze-200".into(); s.publish("camera"); cx.notify();}))))
                .child(div().text_sm().child("Framing"))
                .child(div().flex().gap_2()
                    .child(self.chip("frame-crop", "Crop to fill", self.framing == "crop").on_click(cx.listener(|s, _, _, cx| {s.framing="crop".into(); s.publish("framing"); cx.notify();})))
                    .child(self.chip("frame-fit", "Fit inside", self.framing == "fit").on_click(cx.listener(|s, _, _, cx| {s.framing="fit".into(); s.publish("framing"); cx.notify();}))))
                .when(!self.detected.is_empty(), |row| row.child(div().text_xs().text_color(rgb(0x9fa8a5)).child(self.detected.clone()))))
            .when(self.image_mode, |view| view
                .child(div().text_sm().child("Image loop duration"))
                .child(div().flex().gap_2()
                    .child(self.choice("duration-2", "2 sec".into(), self.duration == 2).on_click(cx.listener(|s, _, _, cx| {s.duration=2; s.publish("duration"); cx.notify();})))
                    .child(self.choice("duration-4", "4 sec".into(), self.duration == 4).on_click(cx.listener(|s, _, _, cx| {s.duration=4; s.publish("duration"); cx.notify();})))
                    .child(self.choice("duration-6", "6 sec".into(), self.duration == 6).on_click(cx.listener(|s, _, _, cx| {s.duration=6; s.publish("duration"); cx.notify();})))))
            .child(div().mt_1().p_4().rounded_lg().bg(rgb(0x242a23))
                .child(div().text_sm().text_color(rgb(0xc2f970)).child("Made to loop."))
                .child(div().mt_2().text_sm().text_color(rgb(0xb3bcb6)).child(if self.image_mode { "Original artwork. Stable colors. Width applies when original size is off." } else { "Match the camera, or choose a cinema frame. Endless playback." })))
            .child(div().text_xs().text_color(rgb(0x9fa8a5)).child(self.recipe()))
    }
}

#[wasm_bindgen]
pub fn run() {
    console_error_panic_hook::set_once();
    gpui_platform::web_init();
    let handle = gpui_platform::single_threaded_web().run_embedded(|cx: &mut App| {
        cx.text_system()
            .add_fonts(vec![Cow::Borrowed(
                include_bytes!("../fonts/IBMPlexSans-Regular.ttf").as_slice(),
            )])
            .expect("load bundled font");
        cx.open_window(WindowOptions::default(), |_, cx| {
            let studio = cx.new(|_| Studio {
                fps: 10,
                width: 320,
                duration: 4,
                image_mode: false,
                profile: "match".into(),
                framing: "crop".into(),
                height: 0,
                detected: String::new(),
            });
            STUDIO.with(|state| *state.borrow_mut() = Some(studio.clone()));
            studio
        })
        .expect("open settings");
        cx.activate(true);
    });
    APPLICATION.with(|app| *app.borrow_mut() = Some(handle));
}
