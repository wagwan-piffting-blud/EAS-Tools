use anyhow::{anyhow, Context, Result};
use base64::Engine;
use image::RgbImage;

pub type Rgb = (u8, u8, u8);

pub fn decode_data_url(src: &str) -> Result<RgbImage> {
    let b64 = src
        .split_once(',')
        .map(|(_, b)| b)
        .ok_or_else(|| anyhow!("not a data URL"))?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .context("base64")?;
    decode_bytes(&bytes)
}

pub fn decode_bytes(bytes: &[u8]) -> Result<RgbImage> {
    Ok(image::load_from_memory(bytes)
        .context("decode image")?
        .to_rgb8())
}

pub fn px(image: &RgbImage, x: u32, y: u32) -> Rgb {
    let p = image.get_pixel(x, y).0;
    (p[0], p[1], p[2])
}

pub fn near(pixel: Rgb, target: Rgb, tolerance: u8) -> bool {
    pixel.0.abs_diff(target.0) <= tolerance
        && pixel.1.abs_diff(target.1) <= tolerance
        && pixel.2.abs_diff(target.2) <= tolerance
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
        let hit = (0..w)
            .step_by(2)
            .any(|x| near(px(image, x, y), target, tolerance));
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
    let decoder =
        image::codecs::gif::GifDecoder::new(std::io::Cursor::new(bytes)).context("gif header")?;
    decoder
        .into_frames()
        .map(|frame| {
            Ok(
                image::DynamicImage::ImageRgba8(frame.context("gif frame")?.into_buffer())
                    .to_rgb8(),
            )
        })
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
    list.sort_by_key(|item| std::cmp::Reverse(item.1));
    list.into_iter().map(|(c, _)| c).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::codecs::gif::GifEncoder;
    use image::{Frame, ImageBuffer, ImageFormat, Rgb, Rgba};
    use std::io::Cursor;

    fn sample() -> RgbImage {
        ImageBuffer::from_fn(6, 9, |x, y| {
            if (1..=3).contains(&x) && (2..=6).contains(&y) {
                Rgb([220, 220, 220])
            } else if x == 5 && y >= 7 {
                Rgb([255, 0, 0])
            } else {
                Rgb([0, 0, 0])
            }
        })
    }

    #[test]
    fn pixels_and_threshold_helpers_cover_bright_regions() {
        let image = sample();
        assert_eq!(px(&image, 2, 4), (220, 220, 220));
        assert_eq!(min_channel((9, 4, 7)), 4);
        assert!(near((10, 20, 30), (12, 18, 29), 2));
        assert!(!near((10, 20, 30), (13, 18, 29), 2));
        assert_eq!(bright_bounds(&image, 200), Some((1, 2, 3, 6)));
        assert_eq!(bright_bounds(&image, 255), None);
        assert_eq!(bright_rows(&image, 200), vec![(4.0, 2, 6)]);
        assert_eq!(color_rows(&image, (255, 0, 0), 0), Vec::<f64>::new());
        assert_eq!(difference_ratio(&image, &image, 0), 0.0);

        let mut changed = image.clone();
        changed.put_pixel(0, 0, Rgb([255, 255, 255]));
        assert_eq!(difference_ratio(&image, &changed, 0), 1.0 / 54.0);
    }

    #[test]
    fn color_runs_and_palette_use_their_boundaries() {
        let image = ImageBuffer::from_fn(4, 12, |x, y| {
            if (2..=6).contains(&y) && x % 2 == 0 {
                Rgb([10, 30, 200])
            } else if y >= 8 && x % 2 == 0 {
                Rgb([200, 10, 10])
            } else {
                Rgb([0, 0, 0])
            }
        });
        assert_eq!(color_rows(&image, (10, 30, 200), 0), vec![4.5]);
        assert_eq!(color_rows(&image, (200, 10, 10), 0), vec![10.0]);

        let palette_colors = palette(&image, 100, 1);
        assert_eq!(palette_colors[0], (10, 30, 200));
        assert_eq!(palette_colors[1], (200, 10, 10));
        assert_eq!(palette(&image, 250, 0), Vec::<super::Rgb>::new());
    }

    #[test]
    fn decoders_accept_png_and_gif_and_reject_bad_input() {
        let image = sample();
        let mut png = Cursor::new(Vec::new());
        image
            .write_to(&mut png, ImageFormat::Png)
            .expect("encode png");
        let decoded = decode_bytes(png.get_ref()).expect("decode png");
        assert_eq!(decoded.dimensions(), image.dimensions());
        let data_url = format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(png.get_ref())
        );
        assert_eq!(decode_data_url(&data_url).unwrap().dimensions(), (6, 9));
        assert!(decode_data_url("not-a-data-url").is_err());
        assert!(decode_data_url("data:image/png;base64,not-base64").is_err());
        assert!(decode_bytes(b"not-an-image").is_err());

        let mut gif = Vec::new();
        {
            let mut encoder = GifEncoder::new(&mut gif);
            encoder
                .encode_frame(Frame::new(ImageBuffer::from_pixel(
                    2,
                    2,
                    Rgba([0, 255, 0, 255]),
                )))
                .expect("encode gif");
        }
        let frames = gif_frames(&gif).expect("decode gif");
        assert_eq!(frames.len(), 1);
        assert_eq!(px(&frames[0], 0, 0), (0, 255, 0));
        assert!(gif_frames(b"not-a-gif").is_err());
    }
}
