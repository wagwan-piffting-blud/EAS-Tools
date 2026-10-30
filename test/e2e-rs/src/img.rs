use anyhow::{anyhow, Context, Result};
use base64::Engine;
use image::RgbImage;

pub type Rgb = (u8, u8, u8);

pub fn decode_data_url(src: &str) -> Result<RgbImage> {
    let b64 = src.split_once(',').map(|(_, b)| b).ok_or_else(|| anyhow!("not a data URL"))?;
    let bytes = base64::engine::general_purpose::STANDARD.decode(b64).context("base64")?;
    decode_bytes(&bytes)
}

pub fn decode_bytes(bytes: &[u8]) -> Result<RgbImage> {
    Ok(image::load_from_memory(bytes).context("decode image")?.to_rgb8())
}

pub fn px(image: &RgbImage, x: u32, y: u32) -> Rgb {
    let p = image.get_pixel(x, y).0;
    (p[0], p[1], p[2])
}

pub fn near(pixel: Rgb, target: Rgb, tolerance: u8) -> bool {
    pixel.0.abs_diff(target.0) <= tolerance && pixel.1.abs_diff(target.1) <= tolerance && pixel.2.abs_diff(target.2) <= tolerance
}

pub fn min_channel(pixel: Rgb) -> u8 {
    pixel.0.min(pixel.1).min(pixel.2)
}

/// Bounding box (left, top, right, bottom) of pixels whose darkest channel is at least `threshold`.
pub fn bright_bounds(image: &RgbImage, threshold: u8) -> Option<(u32, u32, u32, u32)> {
    let (mut l, mut t, mut r, mut b) = (u32::MAX, u32::MAX, 0, 0);
    let mut any = false;
    for (x, y, p) in image.enumerate_pixels() {
        if p.0[0].min(p.0[1]).min(p.0[2]) >= threshold {
            any = true;
            l = l.min(x);
            t = t.min(y);
            r = r.max(x);
            b = b.max(y);
        }
    }
    any.then_some((l, t, r, b))
}

/// Horizontal runs of rows containing bright pixels: (center, top, bottom).
pub fn bright_rows(image: &RgbImage, threshold: u8) -> Vec<(f64, u32, u32)> {
    let (w, h) = image.dimensions();
    let lit: Vec<bool> = (0..h)
        .map(|y| (0..w).any(|x| min_channel(px(image, x, y)) >= threshold))
        .collect();
    runs(&lit, 0)
}

/// Y centers of runs of rows containing `target` (sampling every other column), keeping runs
/// longer than four rows, measured as (first + one-past-last) / 2.
pub fn color_rows(image: &RgbImage, target: Rgb, tolerance: u8) -> Vec<f64> {
    let (w, h) = image.dimensions();
    let mut out = Vec::new();
    let mut start: Option<u32> = None;
    for y in 0..h {
        let hit = (0..w).step_by(2).any(|x| near(px(image, x, y), target, tolerance));
        match (hit, start) {
            (true, None) => start = Some(y),
            (false, Some(s)) => {
                if y - s > 4 {
                    out.push((s + y) as f64 / 2.0);
                }
                start = None;
            }
            _ => {}
        }
    }
    if let Some(s) = start {
        out.push((s + h) as f64 / 2.0);
    }
    out
}

/// Share of pixels whose per-channel difference, taken as luma like PIL's convert("L"),
/// exceeds `threshold`.
pub fn difference_ratio(a: &RgbImage, b: &RgbImage, threshold: u8) -> f64 {
    let changed = a
        .pixels()
        .zip(b.pixels())
        .filter(|(p, q)| {
            let d = |i: usize| p.0[i].abs_diff(q.0[i]) as u32;
            let luma = (d(0) * 299 + d(1) * 587 + d(2) * 114 + 500) / 1000;
            luma > threshold as u32
        })
        .count();
    changed as f64 / (a.width() * a.height()) as f64
}

/// Every frame of an animated GIF, composited, as RGB.
pub fn gif_frames(bytes: &[u8]) -> Result<Vec<RgbImage>> {
    use image::AnimationDecoder;
    let decoder = image::codecs::gif::GifDecoder::new(std::io::Cursor::new(bytes)).context("gif header")?;
    decoder
        .into_frames()
        .map(|frame| Ok(image::DynamicImage::ImageRgba8(frame.context("gif frame")?.into_buffer()).to_rgb8()))
        .collect()
}

fn runs(flags: &[bool], min_run: u32) -> Vec<(f64, u32, u32)> {
    let mut out = Vec::new();
    let mut start: Option<u32> = None;
    for (y, &on) in flags.iter().enumerate() {
        let y = y as u32;
        match (on, start) {
            (true, None) => start = Some(y),
            (false, Some(s)) => {
                if y - s > min_run {
                    out.push(((s + y - 1) as f64 / 2.0, s, y - 1));
                }
                start = None;
            }
            _ => {}
        }
    }
    if let Some(s) = start {
        let end = flags.len() as u32 - 1;
        if end + 1 - s > min_run {
            out.push(((s + end) as f64 / 2.0, s, end));
        }
    }
    out
}

/// Distinct colors with at least `min_count` pixels whose brightest channel is at least `min_level`.
pub fn palette(image: &RgbImage, min_level: u8, min_count: usize) -> Vec<Rgb> {
    let mut counts = std::collections::HashMap::<Rgb, usize>::new();
    for p in image.pixels() {
        let c = (p.0[0], p.0[1], p.0[2]);
        if c.0.max(c.1).max(c.2) >= min_level {
            *counts.entry(c).or_default() += 1;
        }
    }
    let mut list: Vec<(Rgb, usize)> = counts.into_iter().filter(|(_, n)| *n > min_count).collect();
    list.sort_by(|a, b| b.1.cmp(&a.1));
    list.into_iter().map(|(c, _)| c).collect()
}
