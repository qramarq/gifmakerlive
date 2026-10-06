//! A small, explicit prompt grammar. Unrecognised requests must never silently
//! become another effect or get interpolated into HTML / shell commands.
use crate::gif::ConversionError as E;
use std::{io::Read, path::Path, process::Command};

pub fn plan(prompt: &str) -> Result<String, E> {
    if prompt.len() > 240 {
        return Err(E::UnsupportedMotion);
    }
    let lower = prompt.trim().trim_end_matches('.').to_ascii_lowercase();
    let mut words: Vec<&str> = lower.split_whitespace().collect();
    let gentle = words.contains(&"gently") || words.contains(&"subtly");
    // Filler/modifiers cannot conceal negation, an extra instruction, or a subject.
    words.retain(|w| !["please", "gently", "subtly"].contains(w));
    let text = words.join(" ");
    let text = text
        .strip_prefix("make the image ")
        .or_else(|| text.strip_prefix("make the photo "))
        .or_else(|| text.strip_prefix("make it "))
        .unwrap_or(&text);
    let effect = match text {
        "float" | "float up and down" | "move up and down" => "float",
        "pan left" | "move left" | "pan left and back" => "pan-left",
        "pan right" | "move right" | "pan right and back" => "pan-right",
        "zoom in" | "zoom in and back out" => "zoom-in",
        "zoom out" | "zoom out and back in" => "zoom-out",
        "rotate clockwise" | "rotate clockwise and back" => "rotate-cw",
        "rotate counterclockwise" | "rotate anticlockwise" | "rotate counterclockwise and back" => {
            "rotate-ccw"
        }
        _ => return Err(E::UnsupportedMotion),
    };
    Ok(format!(r#"{{"effect":"{effect}","gentle":{gentle}}}"#))
}

pub fn encode(frames: &str, output: &str, fps: i32, count: i32) -> Result<u64, E> {
    if !(1..=30).contains(&fps) || count < fps || count > fps * 6 {
        return Err(E::InvalidOptions);
    }
    let directory = Path::new(frames);
    let mut dimensions = None;
    for index in 0..count {
        let path = directory.join(format!("frame_{index:06}.png"));
        let mut file = std::fs::File::open(path).map_err(|_| E::InvalidInput)?;
        if file.metadata().map_err(|_| E::InvalidInput)?.len() > 16 * 1024 * 1024 {
            return Err(E::InvalidInput);
        }
        let mut header = [0u8; 24];
        file.read_exact(&mut header).map_err(|_| E::InvalidInput)?;
        if &header[..8] != b"\x89PNG\r\n\x1a\n" || &header[12..16] != b"IHDR" {
            return Err(E::InvalidInput);
        }
        let width = u32::from_be_bytes(header[16..20].try_into().unwrap());
        let height = u32::from_be_bytes(header[20..24].try_into().unwrap());
        if width == 0
            || height == 0
            || width > 1800
            || height > 1800
            || u64::from(width) * u64::from(height) * count as u64 > 120_000_000
            || dimensions.is_some_and(|d| d != (width, height))
        {
            return Err(E::InvalidOptions);
        }
        dimensions = Some((width, height));
    }
    // One palette for the entire loop and no dithering: stable flat colors,
    // no moving dither pattern, no resize or YUV/chroma-subsampled intermediate.
    let mut command = Command::new("ffmpeg");
    command.args(["-hide_banner", "-loglevel", "error", "-nostdin", "-y",
        "-framerate", &fps.to_string(), "-start_number", "0", "-i"])
        .arg(directory.join("frame_%06d.png"))
        .args(["-filter_complex", "split[a][b];[a]palettegen=stats_mode=full:reserve_transparent=1[p];[b][p]paletteuse=dither=none:alpha_threshold=128",
            "-frames:v", &count.to_string(), "-loop", "0", "-f", "gif"]);
    crate::encode_command(command, output)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn refuses_ambiguous_or_unimplemented_instructions() {
        for prompt in [
            "",
            "don't zoom in",
            "pan left and make the cat wave",
            "make the water ripple",
            "<script>pan left</script>",
            "pan left 100 pixels",
            "pan left; rm -rf /",
        ] {
            assert_eq!(plan(prompt), Err(E::UnsupportedMotion), "{prompt}");
        }
        assert_eq!(
            plan("Please gently float up and down.").unwrap(),
            r#"{"effect":"float","gentle":true}"#
        );
        assert!(plan("make the image zoom in").unwrap().contains("zoom-in"));
    }
    #[test]
    fn enforces_frame_budget_before_encoding() {
        assert_eq!(
            encode("missing", "out.gif", 30, 181),
            Err(E::InvalidOptions)
        );
        assert_eq!(encode("missing", "out.gif", 10, 40), Err(E::InvalidInput));
    }
}
