use gpui::{prelude::*, *};
use std::{borrow::Cow, cell::RefCell};
use wasm_bindgen::prelude::*;

#[wasm_bindgen(inline_js = "export function settings(fps,width,duration){parent.postMessage({type:'gif-settings',fps,width,duration},location.origin)}")]
extern "C" { fn settings(fps: i32, width: i32, duration: i32); }

thread_local! {
    static APPLICATION: RefCell<Option<ApplicationHandle>> = const { RefCell::new(None) };
    static STUDIO: RefCell<Option<Entity<Studio>>> = const { RefCell::new(None) };
}

struct Studio { fps: i32, width: i32, duration: i32, image_mode: bool }

#[wasm_bindgen]
pub fn sync_settings(fps: i32, width: i32, duration: i32, image_mode: bool) {
    if !(1..=30).contains(&fps) || !(100..=800).contains(&width) || !(1..=6).contains(&duration) { return; }
    APPLICATION.with(|app| {
        if let Some(app) = app.borrow().as_ref() {
            app.update(|cx| STUDIO.with(|studio| {
                if let Some(studio) = studio.borrow().as_ref() {
                    studio.update(cx, |s, cx| { s.fps=fps; s.width=width; s.duration=duration; s.image_mode=image_mode; cx.notify(); });
                }
            }));
        }
    });
}

impl Studio {
    fn choice(&self, id: &'static str, label: String, active: bool) -> Stateful<Div> {
        div().id(id).flex_1().p_3().rounded_lg().border_1()
            .border_color(rgb(if active { 0xc2f970 } else { 0x343737 }))
            .bg(rgb(if active { 0x293822 } else { 0x202323 }))
            .text_color(rgb(if active { 0xc2f970 } else { 0xd9dddd }))
            .text_sm().cursor_pointer().hover(|style| style.bg(rgb(0x34402e)))
            .child(label)
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
                .child(self.choice("fps-10", "10 fps".into(), self.fps == 10).on_click(cx.listener(|s, _, _, cx| {s.fps=10; settings(s.fps,s.width,s.duration); cx.notify();})))
                .child(self.choice("fps-15", "15 fps".into(), self.fps == 15).on_click(cx.listener(|s, _, _, cx| {s.fps=15; settings(s.fps,s.width,s.duration); cx.notify();})))
                .child(self.choice("fps-24", "24 fps".into(), self.fps == 24).on_click(cx.listener(|s, _, _, cx| {s.fps=24; settings(s.fps,s.width,s.duration); cx.notify();}))))
            .child(div().text_sm().child("Output width"))
            .child(div().flex().gap_2()
                .child(self.choice("width-320", "320 px".into(), self.width == 320).on_click(cx.listener(|s, _, _, cx| {s.width=320; settings(s.fps,s.width,s.duration); cx.notify();})))
                .child(self.choice("width-480", "480 px".into(), self.width == 480).on_click(cx.listener(|s, _, _, cx| {s.width=480; settings(s.fps,s.width,s.duration); cx.notify();})))
                .child(self.choice("width-720", "720 px".into(), self.width == 720).on_click(cx.listener(|s, _, _, cx| {s.width=720; settings(s.fps,s.width,s.duration); cx.notify();}))))
            .when(self.image_mode, |view| view
                .child(div().text_sm().child("Image loop duration"))
                .child(div().flex().gap_2()
                    .child(self.choice("duration-2", "2 sec".into(), self.duration == 2).on_click(cx.listener(|s, _, _, cx| {s.duration=2; settings(s.fps,s.width,s.duration); cx.notify();})))
                    .child(self.choice("duration-4", "4 sec".into(), self.duration == 4).on_click(cx.listener(|s, _, _, cx| {s.duration=4; settings(s.fps,s.width,s.duration); cx.notify();})))
                    .child(self.choice("duration-6", "6 sec".into(), self.duration == 6).on_click(cx.listener(|s, _, _, cx| {s.duration=6; settings(s.fps,s.width,s.duration); cx.notify();})))))
            .child(div().mt_1().p_4().rounded_lg().bg(rgb(0x242a23))
                .child(div().text_sm().text_color(rgb(0xc2f970)).child("Made to loop."))
                .child(div().mt_2().text_sm().text_color(rgb(0xb3bcb6)).child(if self.image_mode { "Original artwork. Stable colors. Width applies when original size is off." } else { "Original aspect ratio. Optimized colors. Endless playback." })))
            .child(div().text_xs().text_color(rgb(0x9fa8a5)).child(format!("CURRENT RECIPE    {} FPS / {} PX",self.fps,self.width)))
    }
}

#[wasm_bindgen]
pub fn run() {
    console_error_panic_hook::set_once();
    gpui_platform::web_init();
    let handle = gpui_platform::single_threaded_web().run_embedded(|cx: &mut App| {
        cx.text_system().add_fonts(vec![Cow::Borrowed(include_bytes!("../fonts/IBMPlexSans-Regular.ttf").as_slice())]).expect("load bundled font");
        cx.open_window(WindowOptions::default(), |_, cx| {
            let studio = cx.new(|_| Studio {fps:10,width:320,duration:4,image_mode:false});
            STUDIO.with(|state| *state.borrow_mut() = Some(studio.clone()));
            studio
        }).expect("open settings");
        cx.activate(true);
    });
    APPLICATION.with(|app| *app.borrow_mut() = Some(handle));
}

