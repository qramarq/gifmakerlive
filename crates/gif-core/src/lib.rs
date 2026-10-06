//! Native conversion boundary. The HTTP adapter owns upload/output paths.
use std::{io::Read, process::{Command, Stdio}, time::{Duration, Instant}};

#[weaveffi::module]
pub mod gif {
    #[weaveffi::error]
    #[derive(Debug, PartialEq)]
    pub enum ConversionError {
        /// FPS must be 1–30 and width must be 100–800 pixels.
        InvalidOptions = 1,
        /// The input is missing, empty, or larger than 100 MiB.
        InvalidInput = 2,
        /// FFmpeg is unavailable.
        EncoderUnavailable = 3,
        /// The video could not be decoded or encoded.
        EncodingFailed = 4,
        /// Conversion exceeded the two minute limit.
        TimedOut = 5,
        /// The output could not be written.
        OutputFailed = 6,
    }

    impl std::fmt::Display for ConversionError {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            f.write_str(match self {
                Self::InvalidOptions => "Use 1–30 FPS and a width of 100–800 pixels",
                Self::InvalidInput => "Choose a nonempty video smaller than 100 MiB",
                Self::EncoderUnavailable => "FFmpeg is not installed on the conversion server",
                Self::EncodingFailed => "Unable to decode this video or create its GIF",
                Self::TimedOut => "Conversion exceeded two minutes; try a shorter video",
                Self::OutputFailed => "Unable to save the GIF",
            })
        }
    }

    /// Convert a server-owned local video into a looping, palette-optimized GIF.
    #[weaveffi::export]
    pub fn convert(input: String, output: String, fps: i32, width: i32) -> Result<u64, ConversionError> {
        if !(1..=30).contains(&fps) || !(100..=800).contains(&width) {
            return Err(ConversionError::InvalidOptions);
        }
        super::encode(&input, &output, fps, width)
    }
}

fn encode(input: &str, output: &str, fps: i32, width: i32) -> Result<u64, gif::ConversionError> {
    use gif::ConversionError as E;
    let meta = std::fs::metadata(input).map_err(|_| E::InvalidInput)?;
    if !meta.is_file() || meta.len() == 0 || meta.len() > 100 * 1024 * 1024 {
        return Err(E::InvalidInput);
    }
    let output = std::path::Path::new(output);
    let parent = output.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(std::path::Path::new("."));
    // Encode into a same-directory temporary file; failed jobs never expose partial GIFs.
    let temp = tempfile::Builder::new().suffix(".gif").tempfile_in(parent).map_err(|_| E::OutputFailed)?;
    let filter = format!("fps={fps},scale={width}:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse");
    let mut child = Command::new("ffmpeg")
        .args(["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", input,
            "-filter_complex", &filter, "-loop", "0", "-f", "gif"])
        .arg(temp.path()).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null())
        .spawn().map_err(|_| E::EncoderUnavailable)?;
    let deadline = Instant::now() + Duration::from_secs(120);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() { return Err(E::EncodingFailed); }
                break;
            }
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(50)),
            result => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(if result.is_err() { E::EncodingFailed } else { E::TimedOut });
            }
        }
    }
    let mut header = [0; 6];
    std::fs::File::open(temp.path()).and_then(|mut file| file.read_exact(&mut header)).map_err(|_| E::EncodingFailed)?;
    if &header != b"GIF89a" && &header != b"GIF87a" { return Err(E::EncodingFailed); }
    let bytes = temp.as_file().metadata().map_err(|_| E::OutputFailed)?.len();
    temp.persist_noclobber(output).map_err(|_| E::OutputFailed)?;
    Ok(bytes)
}

weaveffi::export_runtime!();

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_before_running_encoder() {
        assert_eq!(gif::convert("missing".into(), "out.gif".into(), 0, 320), Err(gif::ConversionError::InvalidOptions));
        assert_eq!(gif::convert("missing".into(), "out.gif".into(), 10, 320), Err(gif::ConversionError::InvalidInput));
    }
    #[test]
    fn converts_real_video_and_cleans_up_failed_output() {
        let dir = tempfile::tempdir().unwrap();
        let input = dir.path().join("fixture.mp4");
        assert!(Command::new("ffmpeg").args(["-v", "error", "-f", "lavfi", "-i", "testsrc=size=160x90:rate=10", "-t", "0.5", "-pix_fmt", "yuv420p"]).arg(&input).status().expect("FFmpeg required for integration test").success());
        let output = dir.path().join("result.gif");
        let bytes = gif::convert(input.to_string_lossy().into(), output.to_string_lossy().into(), 10, 320).unwrap();
        assert!(bytes > 6);
        let data = std::fs::read(&output).unwrap();
        assert_eq!(u16::from_le_bytes([data[6], data[7]]), 320);
        assert_eq!(u16::from_le_bytes([data[8], data[9]]), 180);
        let invalid = dir.path().join("bad.mp4");
        std::fs::write(&invalid, b"not a video").unwrap();
        assert_eq!(gif::convert(invalid.to_string_lossy().into(), dir.path().join("bad.gif").to_string_lossy().into(), 10, 320), Err(gif::ConversionError::EncodingFailed));
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 3);
    }
}
