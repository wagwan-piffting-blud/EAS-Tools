//! Header validation for the demo audio in assets/demo_files.
//!
//! Deliberately not a browser test. The first batch of eSpeak demos shipped with a zero in
//! the WAV data chunk size field: Chrome played them regardless while Firefox refused them
//! with NS_ERROR_DOM_MEDIA_METADATA_ERR. Reading the header directly is browser independent
//! and catches the whole class of malformed-container bug.

use std::path::PathBuf;

use eas_tools_e2e::browser::repo_root;
use eas_tools_e2e::*;

struct Wav {
    format: u16,
    channels: u16,
    sample_rate: u32,
    block_align: u16,
    data: std::ops::Range<usize>,
}

fn demo_files() -> Vec<PathBuf> {
    let dir = repo_root().join("assets").join("demo_files");
    let mut files: Vec<PathBuf> = std::fs::read_dir(&dir)
        .map(|entries| entries.filter_map(|e| e.ok().map(|e| e.path())).collect())
        .unwrap_or_default();
    files.retain(|p| p.extension().and_then(|e| e.to_str()) == Some("wav"));
    files.sort();
    files
}

fn u16_at(raw: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([raw[at], raw[at + 1]])
}

fn u32_at(raw: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([raw[at], raw[at + 1], raw[at + 2], raw[at + 3]])
}

/// Walks the chunks rather than assuming data starts at offset 36: some encoders emit LIST
/// or fact chunks before it.
fn parse(raw: &[u8]) -> Result<Wav> {
    ensure!(raw.len() >= 44, "file is too short to hold a WAV header");
    ensure!(&raw[0..4] == b"RIFF", "missing RIFF magic: {:?}", &raw[0..4]);
    ensure!(&raw[8..12] == b"WAVE", "missing WAVE magic: {:?}", &raw[8..12]);
    let riff_size = u32_at(raw, 4) as usize;
    ensure!(riff_size == raw.len() - 8, "RIFF size field is {riff_size}, file body is {}", raw.len() - 8);

    let mut offset = 12;
    let mut fmt = None;
    while offset + 8 <= raw.len() {
        let id = &raw[offset..offset + 4];
        let size = u32_at(raw, offset + 4) as usize;
        let body = offset + 8;
        if id == b"fmt " {
            let mut format = u16_at(raw, body);
            if format == 0xFFFE && size >= 26 {
                format = u16_at(raw, body + 24);
            }
            let channels = u16_at(raw, body + 2);
            let sample_rate = u32_at(raw, body + 4);
            let block_align = u16_at(raw, body + 12);
            let bits = u16_at(raw, body + 14);
            ensure!(channels >= 1, "zero channels declared");
            ensure!(sample_rate > 0, "zero sample rate declared");
            ensure!(bits > 0, "zero bit depth declared");
            fmt = Some((format, channels, sample_rate, block_align));
        } else if id == b"data" {
            ensure!(size > 0, "data chunk size field is zero");
            ensure!(body + size <= raw.len(), "data chunk claims {size} bytes but only {} remain", raw.len() - body);
            let (format, channels, sample_rate, block_align) = fmt.context("no fmt chunk")?;
            return Ok(Wav { format, channels, sample_rate, block_align, data: body..body + size });
        }
        offset = body + size + (size % 2);
    }
    ensure!(fmt.is_some(), "no fmt chunk");
    bail!("no data chunk")
}

pub fn cases() -> Vec<Case> {
    let files = demo_files();
    let mut cases = vec![plain("demo_directory_is_populated", {
        let empty = files.is_empty();
        move || {
            ensure!(!empty, "no demo audio found in assets/demo_files");
            Ok(())
        }
    })];
    for path in files {
        let stem = path.file_stem().unwrap().to_string_lossy().into_owned();
        let header_path = path.clone();
        cases.push(plain(format!("wav_header_sizes_match_the_file[{stem}]"), move || {
            parse(&std::fs::read(&header_path)?)?;
            Ok(())
        }));
        cases.push(plain(format!("wav_is_readable_and_not_silent[{stem}]"), move || {
            let raw = std::fs::read(&path)?;
            let wav = parse(&raw)?;
            ensure!(wav.format == 1, "not linear PCM (format tag {})", wav.format);
            ensure!(wav.channels >= 1 && wav.block_align > 0);
            let frames = wav.data.len() / wav.block_align as usize;
            ensure!(frames > 0, "no audio frames");
            let duration = frames as f64 / wav.sample_rate as f64;
            ensure!((0.5..=60.0).contains(&duration), "implausible demo duration: {duration:.2}s");
            ensure!(raw[wav.data].iter().any(|b| *b != 0), "the audio payload is entirely zero bytes");
            Ok(())
        }));
    }
    cases
}
