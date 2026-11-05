//! Smartphone and digital-cinema frame detection for output GIF sizing.
//! The browser studio owns the live path. These helpers keep the same ratios
//! under test without changing the FFmpeg export surface.

pub const MIN_WIDTH: i32 = 100;
pub const MAX_WIDTH: i32 = 800;
pub const MAX_HEIGHT: i32 = 4096;
pub const MAX_FRAME_PIXELS: i64 = 1_600_000;
pub const MAX_LOOP_PIXELS: i64 = 80_000_000;
pub const DCI_ASPECT: f64 = 4096.0 / 2160.0;

pub const PROFILE_IDS: &[&str] = &[
    "match",
    "phone-9-16",
    "phone-16-9",
    "phone-4-3",
    "phone-3-4",
    "phone-1-1",
    "dci-17-9",
    "uhd-16-9",
    "scope-239",
    "univisium-200",
    "flat-185",
    "open-gate-32",
    "anamorphic-43",
    "desqueeze-125",
    "desqueeze-130",
    "desqueeze-133",
    "desqueeze-150",
    "desqueeze-160",
    "desqueeze-180",
    "desqueeze-200",
    "custom",
];

#[derive(Clone, Debug, PartialEq)]
pub struct Detection {
    pub camera_class: &'static str,
    pub format_id: &'static str,
    pub orientation: &'static str,
    pub facing: &'static str,
    pub lens: &'static str,
    pub sensor: &'static str,
    pub width: f64,
    pub height: f64,
    pub aspect: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct FrameSize {
    pub width: i32,
    pub height: i32,
    pub aspect: f64,
    pub framing: &'static str,
    pub desqueeze: f64,
    pub profile_id: &'static str,
    pub pending: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Placement {
    pub sx: f64,
    pub sy: f64,
    pub sw: f64,
    pub sh: f64,
    pub dx: f64,
    pub dy: f64,
    pub dw: f64,
    pub dh: f64,
}

struct Profile {
    id: &'static str,
    aspect: f64,
    desqueeze: f64,
}

fn profile(id: &str) -> Option<Profile> {
    Some(match id {
        "match" => Profile { id: "match", aspect: 0.0, desqueeze: 0.0 },
        "phone-9-16" => Profile { id: "phone-9-16", aspect: 9.0 / 16.0, desqueeze: 0.0 },
        "phone-16-9" => Profile { id: "phone-16-9", aspect: 16.0 / 9.0, desqueeze: 0.0 },
        "phone-4-3" => Profile { id: "phone-4-3", aspect: 4.0 / 3.0, desqueeze: 0.0 },
        "phone-3-4" => Profile { id: "phone-3-4", aspect: 3.0 / 4.0, desqueeze: 0.0 },
        "phone-1-1" => Profile { id: "phone-1-1", aspect: 1.0, desqueeze: 0.0 },
        "dci-17-9" => Profile { id: "dci-17-9", aspect: DCI_ASPECT, desqueeze: 0.0 },
        "uhd-16-9" => Profile { id: "uhd-16-9", aspect: 16.0 / 9.0, desqueeze: 0.0 },
        "scope-239" => Profile { id: "scope-239", aspect: 2.39, desqueeze: 0.0 },
        "univisium-200" => Profile { id: "univisium-200", aspect: 2.0, desqueeze: 0.0 },
        "flat-185" => Profile { id: "flat-185", aspect: 1.85, desqueeze: 0.0 },
        "open-gate-32" => Profile { id: "open-gate-32", aspect: 3.0 / 2.0, desqueeze: 0.0 },
        "anamorphic-43" => Profile { id: "anamorphic-43", aspect: 4.0 / 3.0, desqueeze: 0.0 },
        "desqueeze-125" => Profile { id: "desqueeze-125", aspect: 0.0, desqueeze: 1.25 },
        "desqueeze-130" => Profile { id: "desqueeze-130", aspect: 0.0, desqueeze: 1.3 },
        "desqueeze-133" => Profile { id: "desqueeze-133", aspect: 0.0, desqueeze: 1.33 },
        "desqueeze-150" => Profile { id: "desqueeze-150", aspect: 0.0, desqueeze: 1.5 },
        "desqueeze-160" => Profile { id: "desqueeze-160", aspect: 0.0, desqueeze: 1.6 },
        "desqueeze-180" => Profile { id: "desqueeze-180", aspect: 0.0, desqueeze: 1.8 },
        "desqueeze-200" => Profile { id: "desqueeze-200", aspect: 0.0, desqueeze: 2.0 },
        "custom" => Profile { id: "custom", aspect: 0.0, desqueeze: 0.0 },
        _ => return None,
    })
}

fn contains_any(label: &str, needles: &[&str]) -> bool {
    let lower = label.to_ascii_lowercase();
    needles.iter().any(|needle| lower.contains(needle))
}

fn exact_id(width: f64, height: f64) -> &'static str {
    match (width.round() as i32, height.round() as i32) {
        (4096, 2160) | (2048, 1080) => "dci-17-9",
        (4096, 1716) | (2048, 858) => "scope-239",
        (3996, 2160) | (1998, 1080) => "flat-185",
        (3840, 1920) | (1920, 960) => "univisium-200",
        (3840, 2160) => "uhd-16-9",
        (4096, 3072) | (2880, 2160) | (2048, 1536) => "anamorphic-43",
        (6000, 4000) | (6048, 4032) | (5760, 3840) | (4608, 3072) => "open-gate-32",
        (2160, 3840) | (1080, 1920) | (720, 1280) => "phone-9-16",
        (1080, 1440) | (3024, 4032) => "phone-3-4",
        (1080, 1080) | (2160, 2160) => "phone-1-1",
        (4032, 3024) | (4000, 3000) | (4224, 3024) | (1920, 1440) | (640, 480) => "phone-4-3",
        (3024, 4224) | (1440, 1920) | (480, 640) | (4336, 5776) | (2640, 3520) | (2500, 3300) => "phone-3-4",
        (4608, 3164) | (3164, 4608) | (4448, 3096) | (3096, 4448) | (8640, 5760) | (5760, 8640) | (4032, 6048) | (6024, 4016) | (4016, 6024) => "open-gate-32",
        (6560, 3100) | (3100, 6560) | (17520, 8040) | (8040, 17520) => "univisium-200",
        (8192, 4320) | (4320, 8192) | (6144, 3240) | (3240, 6144) | (12288, 6480) | (6480, 12288) => "dci-17-9",
        (8632, 4856) | (6144, 3456) | (1024, 576) => "uhd-16-9",
        (4856, 8632) | (3456, 6144) | (576, 1024) | (1080, 2520) | (1440, 3360) | (720, 1680) => "phone-9-16",
        (5776, 4336) | (3520, 2640) | (3300, 2500) | (3328, 2790) | (2790, 3328) => "anamorphic-43",
        (2520, 1080) | (3360, 1440) | (1680, 720) => "scope-239",
        _ => "",
    }
}

fn closest_aspect(aspect: f64) -> &'static str {
    const CANDIDATES: &[(&str, f64, f64)] = &[
        ("phone-1-1", 1.0, 0.02),
        ("phone-9-16", 9.0 / 16.0, 0.02),
        ("phone-3-4", 3.0 / 4.0, 0.02),
        ("phone-4-3", 4.0 / 3.0, 0.025),
        ("open-gate-32", 3.0 / 2.0, 0.02),
        ("widescreen-16-9", 16.0 / 9.0, 0.02),
        ("flat-185", 1.85, 0.015),
        ("dci-17-9", DCI_ASPECT, 0.012),
        ("univisium-200", 2.0, 0.02),
        ("scope-239", 2.39, 0.025),
        ("scope-239", 21.0 / 9.0, 0.03),
    ];
    let mut best = "";
    let mut best_distance = f64::MAX;
    for (id, target, delta) in CANDIDATES {
        let distance = (aspect - target).abs();
        if distance <= *delta && distance < best_distance {
            best = id;
            best_distance = distance;
        }
    }
    best
}

fn cinema_id(id: &str) -> bool {
    matches!(id, "dci-17-9" | "scope-239" | "flat-185" | "univisium-200" | "open-gate-32" | "anamorphic-43")
}

fn refine_format(format_id: &str, camera_class: &str, width: f64, height: f64) -> &'static str {
    let mut id = if format_id == "widescreen-16-9" { "phone-16-9" } else { format_id };
    if camera_class == "smartphone" && id == "uhd-16-9" {
        id = "phone-16-9";
    }
    if camera_class == "smartphone" && id == "anamorphic-43" {
        id = "phone-4-3";
    }
    if camera_class == "digital-cinema" && (id == "phone-16-9" || id == "widescreen-16-9") {
        id = "uhd-16-9";
    }
    if camera_class == "digital-cinema" && id == "phone-4-3" {
        id = "anamorphic-43";
    }
    if camera_class == "unknown" && (id == "phone-16-9" || id == "widescreen-16-9") {
        id = if width.min(height) >= 1080.0 { "uhd-16-9" } else { "phone-16-9" };
    }
    match id {
        "phone-9-16" => "phone-9-16",
        "phone-16-9" => "phone-16-9",
        "phone-4-3" => "phone-4-3",
        "phone-3-4" => "phone-3-4",
        "phone-1-1" => "phone-1-1",
        "dci-17-9" => "dci-17-9",
        "uhd-16-9" => "uhd-16-9",
        "scope-239" => "scope-239",
        "univisium-200" => "univisium-200",
        "flat-185" => "flat-185",
        "open-gate-32" => "open-gate-32",
        "anamorphic-43" => "anamorphic-43",
        "widescreen-16-9" => "widescreen-16-9",
        _ => "",
    }
}

pub fn detect(width: f64, height: f64, aspect_ratio: f64, facing_mode: &str, label: &str) -> Detection {
    let facing_mode = if facing_mode == "user" || facing_mode == "environment" { facing_mode } else { "" };
    let phone_label = contains_any(label, &["iphone", "ipad", "pixel", "galaxy", "android", "smartphone", "phone", "facetime", "selfie", "ultra wide", "ultrawide", "telephoto", "front camera", "back camera", "rear camera", "xperia", "continuity", "deviceaswebcam", "device as webcam", "center stage"]);
    let cinema_label = contains_any(label, &["blackmagic", "bmpcc", "pyxis", "arri", "alexa", "red", "komodo", "v-raptor", "venice", "burano", "fx3", "fx6", "fx9", "c70", "c300", "c500", "z-cam", "zcam", "kinefinity", "sigma fp", "atomos", "shogun", "ninja", "decklink", "ultrastudio", "elgato", "cam link", "magewell", "atem", "hdmi", "sdi", "capture card", "open gate", "super 35", "s35", "anamorphic", "ursa"]);
    let super35 = contains_any(label, &["super 35", "s35"]);
    let open_gate = contains_any(label, &["open gate"]);
    let anamorphic = contains_any(label, &["anamorphic"]);
    let lens = if contains_any(label, &["ultra wide", "ultrawide", "0.5x", "0.5 x"]) {
        "ultrawide"
    } else if contains_any(label, &["telephoto", "tele"]) {
        "telephoto"
    } else {
        ""
    };
    let facing = if facing_mode == "user" {
        "front"
    } else if facing_mode == "environment" {
        "rear"
    } else if contains_any(label, &["front", "facetime", "selfie"]) {
        "front"
    } else if contains_any(label, &["rear", "back"]) {
        "rear"
    } else {
        ""
    };
    let mut aspect = if width > 0.0 && height > 0.0 { width / height } else { 0.0 };
    if aspect == 0.0 && aspect_ratio > 0.0 {
        aspect = aspect_ratio;
    }
    if aspect == 0.0 {
        return Detection {
            camera_class: "unknown",
            format_id: "",
            orientation: "",
            facing,
            lens,
            sensor: "",
            width,
            height,
            aspect,
        };
    }
    let orientation = if (aspect - 1.0).abs() <= 0.02 {
        "square"
    } else if aspect < 1.0 {
        "portrait"
    } else {
        "landscape"
    };
    let exact = if width > 0.0 && height > 0.0 { exact_id(width, height) } else { "" };
    let format_guess = if exact.is_empty() { closest_aspect(aspect) } else { exact };
    let phone = facing_mode == "user" || facing_mode == "environment" || phone_label;
    let exclusive = cinema_id(format_guess);
    let mut camera_class = if phone && !exclusive {
        "smartphone"
    } else if cinema_label || super35 || open_gate || anamorphic || (!exact.is_empty() && exclusive) {
        "digital-cinema"
    } else {
        "unknown"
    };
    let format_id = refine_format(format_guess, camera_class, width, height);
    if camera_class == "unknown" && matches!(format_id, "phone-9-16" | "phone-3-4" | "phone-1-1" | "phone-4-3") {
        camera_class = "smartphone";
    }
    if camera_class == "unknown" && cinema_id(format_id) && format_id != "uhd-16-9" {
        let large_gate = format_id != "open-gate-32" || width.max(height) >= 2000.0;
        if large_gate {
            camera_class = "digital-cinema";
        }
    }
    let sensor = if super35 {
        "super35"
    } else if open_gate {
        "open-gate"
    } else if anamorphic {
        "anamorphic"
    } else {
        ""
    };
    Detection { camera_class, format_id, orientation, facing, lens, sensor, width, height, aspect }
}

pub fn height_for_aspect(width: i32, aspect: f64) -> Result<i32, &'static str> {
    if width <= 0 || !(aspect > 0.0) {
        return Err("Invalid camera aspect");
    }
    Ok((width as f64 / aspect).round().max(1.0) as i32)
}

fn require_width(width: i32) -> Result<i32, &'static str> {
    if !(MIN_WIDTH..=MAX_WIDTH).contains(&width) {
        Err("Use a width of 100–800 pixels")
    } else {
        Ok(width)
    }
}

fn normalize_crop(crop: [f64; 4]) -> Result<[f64; 4], &'static str> {
    let [x, y, w, h] = crop;
    if [x, y, w, h].iter().any(|value| !value.is_finite()) {
        return Err("Invalid video edits");
    }
    if x.min(y) < 0.0 || w.min(h) < 1.0 || x + w > 100.0 || y + h > 100.0 {
        return Err("Crop must fit inside the video and be at least 1% wide and high");
    }
    Ok(crop)
}

pub fn output_size(
    profile_id: &str,
    framing: &str,
    width: i32,
    height: i32,
    source_width: f64,
    source_height: f64,
    crop: [f64; 4],
) -> Result<FrameSize, &'static str> {
    let profile = profile(profile_id).ok_or("Choose a camera format")?;
    let out_width = require_width(width)?;
    let [_x, _y, cw, ch] = normalize_crop(crop)?;
    let sw = source_width.max(0.0) * cw / 100.0;
    let sh = source_height.max(0.0) * ch / 100.0;
    let source_aspect = if sw > 0.0 && sh > 0.0 { sw / sh } else { 0.0 };
    let mut out_height = 0;
    let mut aspect = 0.0;
    let mut desqueeze = 1.0;
    let mut mode = if framing == "fit" { "fit" } else { "crop" };
    let mut pending = false;
    if profile.desqueeze > 0.0 {
        desqueeze = profile.desqueeze;
        mode = "crop";
        if source_aspect == 0.0 {
            pending = true;
        } else {
            aspect = source_aspect * desqueeze;
            out_height = height_for_aspect(out_width, aspect)?;
        }
    } else if profile.aspect > 0.0 {
        aspect = profile.aspect;
        out_height = height_for_aspect(out_width, aspect)?;
    } else if profile.id == "custom" {
        if !(2..=MAX_HEIGHT).contains(&height) {
            return Err("Use a height of 2–4096 pixels");
        }
        out_height = height;
        aspect = out_width as f64 / out_height as f64;
    } else if source_aspect > 0.0 {
        out_height = (sh * out_width as f64 / sw).round().max(1.0) as i32;
        aspect = out_width as f64 / out_height as f64;
    } else {
        pending = true;
    }
    if out_height > 0 && (out_height > MAX_HEIGHT || i64::from(out_width) * i64::from(out_height) > MAX_FRAME_PIXELS) {
        return Err("This frame is too large for the browser. Choose a smaller width.");
    }
    Ok(FrameSize {
        width: out_width,
        height: out_height,
        aspect,
        framing: mode,
        desqueeze,
        profile_id: profile.id,
        pending,
    })
}

pub fn place_source(
    source_width: f64,
    source_height: f64,
    crop: [f64; 4],
    out_width: f64,
    out_height: f64,
    framing: &str,
    desqueeze: f64,
) -> Result<Placement, &'static str> {
    let [x, y, cw, ch] = normalize_crop(crop)?;
    let sx = source_width * x / 100.0;
    let sy = source_height * y / 100.0;
    let sw = source_width * cw / 100.0;
    let sh = source_height * ch / 100.0;
    if sw <= 0.0 || sh <= 0.0 || out_width <= 0.0 || out_height <= 0.0 {
        return Err("Invalid video edits");
    }
    let factor = if desqueeze > 0.0 { desqueeze } else { 1.0 };
    let display_w = sw * factor;
    let display_h = sh;
    let scale = if framing == "fit" {
        (out_width / display_w).min(out_height / display_h)
    } else {
        (out_width / display_w).max(out_height / display_h)
    };
    let dw = display_w * scale;
    let dh = display_h * scale;
    Ok(Placement { sx, sy, sw, sh, dx: (out_width - dw) / 2.0, dy: (out_height - dh) / 2.0, dw, dh })
}

/// Keep a locked portrait or landscape frame. A same-orientation resolution change still passes through.
pub fn orient_source(width: f64, height: f64, lock: &str) -> (f64, f64, bool) {
    if width <= 0.0 || height <= 0.0 || (lock != "portrait" && lock != "landscape") {
        return (width, height, false);
    }
    let flipped = (lock == "portrait" && width > height) || (lock == "landscape" && height > width);
    if flipped { (height, width, true) } else { (width, height, true) }
}

pub fn assert_loop_budget(width: i32, height: i32, frames: i32) -> Result<(), &'static str> {
    if width < 1 || height < 1 || width > 65535 || height > 65535 {
        return Err("GIF dimensions are out of range");
    }
    if i64::from(width) * i64::from(height) > MAX_FRAME_PIXELS {
        return Err("This frame is too large for the browser. Choose a smaller width.");
    }
    if frames < 1 || i64::from(frames) * i64::from(width) * i64::from(height) > MAX_LOOP_PIXELS {
        return Err("This loop is too large for the browser. Lower the frame rate or width and try again.");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn near(actual: f64, expected: f64) {
        assert!((actual - expected).abs() < 1e-6, "{actual} != {expected}");
    }

    #[test]
    fn profiles_cover_phone_and_cinema_frames() {
        assert_eq!(PROFILE_IDS.len(), 21);
        assert!(PROFILE_IDS.contains(&"phone-9-16"));
        assert!(PROFILE_IDS.contains(&"dci-17-9"));
        assert!(PROFILE_IDS.contains(&"desqueeze-200"));
    }

    #[test]
    fn detects_smartphone_orientation_lens_and_facing() {
        let front = detect(1080.0, 1920.0, 0.0, "user", "Front Ultra Wide Camera");
        assert_eq!(front.camera_class, "smartphone");
        assert_eq!(front.format_id, "phone-9-16");
        assert_eq!(front.orientation, "portrait");
        assert_eq!(front.facing, "front");
        assert_eq!(front.lens, "ultrawide");

        let rear = detect(1920.0, 1080.0, 0.0, "environment", "Back Telephoto Camera");
        assert_eq!(rear.camera_class, "smartphone");
        assert_eq!(rear.format_id, "phone-16-9");
        assert_eq!(rear.facing, "rear");
        assert_eq!(rear.lens, "telephoto");

        let sensor = detect(4032.0, 3024.0, 0.0, "", "Camera 0, Facing back");
        assert_eq!(sensor.format_id, "phone-4-3");
        assert_eq!(sensor.camera_class, "smartphone");
        assert_eq!(detect(1080.0, 1440.0, 0.0, "", "").format_id, "phone-3-4");
        assert_eq!(detect(1080.0, 1080.0, 0.0, "", "").format_id, "phone-1-1");
        assert_eq!(detect(1080.0, 1080.0, 0.0, "", "").orientation, "square");
    }

    #[test]
    fn detects_digital_cinema_formats() {
        let dci = detect(4096.0, 2160.0, 0.0, "", "DeckLink 8K Pro");
        assert_eq!(dci.camera_class, "digital-cinema");
        assert_eq!(dci.format_id, "dci-17-9");
        assert_eq!(detect(2048.0, 1080.0, 0.0, "", "").format_id, "dci-17-9");
        assert_eq!(detect(4096.0, 1716.0, 0.0, "", "ARRI Alexa").format_id, "scope-239");
        assert_eq!(detect(2048.0, 858.0, 0.0, "", "").format_id, "scope-239");
        assert_eq!(detect(3996.0, 2160.0, 0.0, "", "").format_id, "flat-185");
        assert_eq!(detect(3840.0, 1920.0, 0.0, "", "").format_id, "univisium-200");
        let gate = detect(6000.0, 4000.0, 0.0, "", "ARRI Alexa Open Gate");
        assert_eq!(gate.format_id, "open-gate-32");
        assert_eq!(gate.sensor, "open-gate");
        let anamorphic = detect(2880.0, 2160.0, 0.0, "", "Super 35 anamorphic");
        assert_eq!(anamorphic.format_id, "anamorphic-43");
        assert_eq!(anamorphic.sensor, "super35");
        let uhd = detect(3840.0, 2160.0, 0.0, "", "Blackmagic HDMI");
        assert_eq!(uhd.camera_class, "digital-cinema");
        assert_eq!(uhd.format_id, "uhd-16-9");
    }

    #[test]
    fn phone_signal_wins_on_shared_16_9_sizes() {
        let phone = detect(3840.0, 2160.0, 0.0, "environment", "Back Camera");
        assert_eq!(phone.camera_class, "smartphone");
        assert_eq!(phone.format_id, "phone-16-9");
        let plain = detect(1280.0, 720.0, 0.0, "", "HD Webcam");
        assert_eq!(plain.camera_class, "unknown");
        assert_eq!(plain.format_id, "phone-16-9");
        let small_gate = detect(1500.0, 1000.0, 0.0, "", "");
        assert_eq!(small_gate.format_id, "open-gate-32");
        assert_eq!(small_gate.camera_class, "unknown");
        assert_eq!(detect(0.0, 0.0, 17.0 / 9.0, "", "").format_id, "dci-17-9");
        assert_eq!(detect(0.0, 0.0, 0.0, "", "").format_id, "");
    }

    #[test]
    fn sizes_match_mode_and_named_frames() {
        let matched = output_size("match", "crop", 320, 0, 320.0, 200.0, [0.0, 0.0, 100.0, 100.0]).unwrap();
        assert_eq!((matched.width, matched.height), (320, 200));
        let cropped = output_size("match", "crop", 320, 0, 320.0, 200.0, [0.0, 0.0, 50.0, 100.0]).unwrap();
        assert_eq!((cropped.width, cropped.height), (320, 400));
        assert_eq!(output_size("phone-9-16", "crop", 320, 0, 0.0, 0.0, [0.0, 0.0, 100.0, 100.0]).unwrap().height, 569);
        assert_eq!(output_size("phone-16-9", "crop", 480, 0, 0.0, 0.0, [0.0, 0.0, 100.0, 100.0]).unwrap().height, 270);
        assert_eq!(output_size("phone-4-3", "crop", 320, 0, 0.0, 0.0, [0.0, 0.0, 100.0, 100.0]).unwrap().height, 240);
        assert_eq!(output_size("phone-3-4", "crop", 320, 0, 0.0, 0.0, [0.0, 0.0, 100.0, 100.0]).unwrap().height, 427);
        assert_eq!(output_size("phone-1-1", "crop", 321, 0, 0.0, 0.0, [0.0, 0.0, 100.0, 100.0]).unwrap().height, 321);
        assert_eq!(output_size("dci-17-9", "crop", 512, 0, 0.0, 0.0, [0.0, 0.0, 100.0, 100.0]).unwrap().height, 270);
        assert_eq!(output_size("scope-239", "fit", 478, 0, 1920.0, 1080.0, [0.0, 0.0, 100.0, 100.0]).unwrap().height, 200);
        assert_eq!(output_size("univisium-200", "crop", 480, 0, 0.0, 0.0, [0.0, 0.0, 100.0, 100.0]).unwrap().height, 240);
        assert_eq!(output_size("flat-185", "crop", 370, 0, 0.0, 0.0, [0.0, 0.0, 100.0, 100.0]).unwrap().height, 200);
        assert_eq!(output_size("open-gate-32", "crop", 720, 0, 0.0, 0.0, [0.0, 0.0, 100.0, 100.0]).unwrap().height, 480);
        let custom = output_size("custom", "crop", 321, 181, 0.0, 0.0, [0.0, 0.0, 100.0, 100.0]).unwrap();
        assert_eq!((custom.width, custom.height), (321, 181));
        let squeezed = output_size("desqueeze-200", "fit", 640, 0, 2880.0, 2160.0, [0.0, 0.0, 100.0, 100.0]).unwrap();
        assert_eq!(squeezed.height, 240);
        assert_eq!(squeezed.framing, "crop");
        near(squeezed.desqueeze, 2.0);
        assert!(output_size("desqueeze-133", "crop", 320, 0, 0.0, 0.0, [0.0, 0.0, 100.0, 100.0]).unwrap().pending);
    }

    #[test]
    fn framing_keeps_source_aspect_or_desqueezes() {
        let cover = place_source(1920.0, 1080.0, [0.0, 0.0, 100.0, 100.0], 478.0, 200.0, "crop", 1.0).unwrap();
        near(cover.dw / cover.dh, 1920.0 / 1080.0);
        assert!(cover.dh > 200.0);
        near(cover.dy, (200.0 - cover.dh) / 2.0);
        let fit = place_source(1920.0, 1080.0, [0.0, 0.0, 100.0, 100.0], 478.0, 200.0, "fit", 1.0).unwrap();
        near(fit.dw / fit.dh, 1920.0 / 1080.0);
        assert!(fit.dw < 478.0 && fit.dh <= 200.0 + 1e-6);
        let matched = place_source(320.0, 200.0, [0.0, 0.0, 50.0, 100.0], 320.0, 400.0, "crop", 1.0).unwrap();
        near(matched.sx, 0.0);
        near(matched.sw, 160.0);
        near(matched.dx, 0.0);
        near(matched.dw, 320.0);
        near(matched.dh, 400.0);
        let desqueezed = place_source(2880.0, 2160.0, [0.0, 0.0, 100.0, 100.0], 640.0, 240.0, "crop", 2.0).unwrap();
        near(desqueezed.dw / desqueezed.dh, (2880.0 / 2160.0) * 2.0);
        near(desqueezed.dx, 0.0);
        near(desqueezed.dy, 0.0);
    }

    #[test]
    fn live_dimension_changes_update_match_output() {
        let landscape = output_size("match", "crop", 320, 0, 1920.0, 1080.0, [0.0, 0.0, 100.0, 100.0]).unwrap();
        assert_eq!(landscape.height, 180);
        assert_eq!(detect(1920.0, 1080.0, 0.0, "environment", "Back Camera").format_id, "phone-16-9");
        let portrait = output_size("match", "crop", 320, 0, 1080.0, 1920.0, [0.0, 0.0, 100.0, 100.0]).unwrap();
        assert_eq!(portrait.height, 569);
        assert_eq!(detect(1080.0, 1920.0, 0.0, "environment", "Back Camera").format_id, "phone-9-16");
        let cinema = output_size("match", "crop", 512, 0, 4096.0, 2160.0, [0.0, 0.0, 100.0, 100.0]).unwrap();
        assert_eq!(cinema.height, 270);
        assert_eq!(detect(4096.0, 2160.0, 0.0, "", "DeckLink 8K Pro").format_id, "dci-17-9");
    }

    #[test]
    fn orientation_lock_holds_across_rotation_and_releases() {
        let (w, h, locked) = orient_source(1920.0, 1080.0, "portrait");
        assert!(locked);
        assert_eq!((w, h), (1080.0, 1920.0));
        assert_eq!(output_size("match", "crop", 320, 0, w, h, [0.0, 0.0, 100.0, 100.0]).unwrap().height, 569);
        let (held_w, held_h, _) = orient_source(1080.0, 1920.0, "portrait");
        assert_eq!((held_w, held_h), (1080.0, 1920.0));
        let (wide_w, wide_h, _) = orient_source(1080.0, 1920.0, "landscape");
        assert_eq!((wide_w, wide_h), (1920.0, 1080.0));
        assert_eq!(output_size("match", "crop", 320, 0, wide_w, wide_h, [0.0, 0.0, 100.0, 100.0]).unwrap().height, 180);
        let (raw_w, raw_h, unlocked) = orient_source(1080.0, 1920.0, "");
        assert!(!unlocked);
        assert_eq!((raw_w, raw_h), (1080.0, 1920.0));
        let (setting_w, setting_h, _) = orient_source(1440.0, 1080.0, "landscape");
        assert_eq!((setting_w, setting_h), (1440.0, 1080.0));
        assert_eq!(output_size("match", "crop", 320, 0, setting_w, setting_h, [0.0, 0.0, 100.0, 100.0]).unwrap().height, 240);
    }

    #[test]
    fn master_matrix_matches_the_js_reference() {
        let exact = [
            (4608.0, 3164.0, "open-gate-32"),
            (4448.0, 3096.0, "open-gate-32"),
            (6560.0, 3100.0, "univisium-200"),
            (8192.0, 4320.0, "dci-17-9"),
            (6144.0, 3240.0, "dci-17-9"),
            (8640.0, 5760.0, "open-gate-32"),
            (8632.0, 4856.0, "uhd-16-9"),
            (6144.0, 3456.0, "uhd-16-9"),
            (12288.0, 6480.0, "dci-17-9"),
            (17520.0, 8040.0, "univisium-200"),
            (4224.0, 3024.0, "phone-4-3"),
            (3024.0, 4224.0, "phone-3-4"),
            (1920.0, 1440.0, "phone-4-3"),
            (1024.0, 576.0, "uhd-16-9"),
            (2520.0, 1080.0, "scope-239"),
            (1080.0, 2520.0, "phone-9-16"),
            (3328.0, 2790.0, "anamorphic-43"),
            (5776.0, 4336.0, "anamorphic-43"),
        ];
        for (w, h, id) in exact {
            assert_eq!(detect(w, h, 0.0, "", "").format_id, id, "{w}x{h}");
        }
        assert_eq!(detect(2520.0, 1080.0, 0.0, "", "Xperia Cinema Pro").format_id, "scope-239");
        assert_eq!(detect(1920.0, 1440.0, 0.0, "", "iPhone Continuity Camera").format_id, "phone-4-3");
        assert_eq!(detect(1080.0, 1080.0, 0.0, "", "Center Stage").format_id, "phone-1-1");
        let factors = [
            ("desqueeze-125", 192, 384),
            ("desqueeze-130", 185, 369),
            ("desqueeze-133", 180, 361),
            ("desqueeze-150", 160, 320),
            ("desqueeze-160", 150, 300),
            ("desqueeze-180", 133, 267),
            ("desqueeze-200", 120, 240),
        ];
        for (id, at_320, at_640) in factors {
            assert_eq!(output_size(id, "crop", 320, 0, 2880.0, 2160.0, [0.0, 0.0, 100.0, 100.0]).unwrap().height, at_320, "{id}");
            assert_eq!(output_size(id, "crop", 640, 0, 2880.0, 2160.0, [0.0, 0.0, 100.0, 100.0]).unwrap().height, at_640, "{id}");
        }
        assert_eq!(output_size("desqueeze-200", "crop", 320, 0, 3328.0, 2790.0, [0.0, 0.0, 100.0, 100.0]).unwrap().height, 134);
        assert!(PROFILE_IDS.contains(&"desqueeze-125"));
        assert!(PROFILE_IDS.contains(&"desqueeze-130"));
        assert!(PROFILE_IDS.contains(&"desqueeze-160"));
    }

    #[test]
    fn rejects_unsafe_or_invalid_sizes() {
        assert_eq!(output_size("nope", "crop", 320, 0, 0.0, 0.0, [0.0, 0.0, 100.0, 100.0]), Err("Choose a camera format"));
        assert_eq!(output_size("match", "crop", 80, 0, 0.0, 0.0, [0.0, 0.0, 100.0, 100.0]), Err("Use a width of 100–800 pixels"));
        assert_eq!(output_size("custom", "crop", 320, 1, 0.0, 0.0, [0.0, 0.0, 100.0, 100.0]), Err("Use a height of 2–4096 pixels"));
        assert!(assert_loop_budget(320, 400, 50).is_ok());
        assert_eq!(assert_loop_budget(800, 800, 200), Err("This loop is too large for the browser. Lower the frame rate or width and try again."));
        assert_eq!(assert_loop_budget(2000, 2000, 1), Err("This frame is too large for the browser. Choose a smaller width."));
    }
}
