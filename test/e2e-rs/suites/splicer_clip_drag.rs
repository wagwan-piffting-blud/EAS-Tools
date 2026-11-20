//! Splicer clip dragging on a track of back-to-back clips (#172): a small drag moves the clip a
//! small amount and shifts the clips it runs into, instead of throwing it past every later clip.

use eas_tools_e2e::*;

use crate::common::{open_tool, sine_wav, temp_file};

const STARTS_JS: &str = "return arguments[0].map((id) => {
    const node = document.querySelector('.sp-clip[data-clip=\"' + id + '\"]');
    return node ? parseFloat(node.style.left) / parseFloat(node.style.width) : null;
});";

async fn load_one_second_clips(tab: &Tab, count: usize) -> Result<Vec<String>> {
    let wav = sine_wav(0.25, 1.0, 44100);
    for n in 1..=count {
        tab.set_files("#spliceFile", &[temp_file("tone.wav", &wav)?])
            .await?;
        tab.wait_until(
            &format!("document.querySelectorAll('.sp-clip[data-clip]').length === {n}"),
            Duration::from_secs(20),
        )
        .await?;
    }
    let ids: Vec<String> = tab
        .eval(
            "Array.from(document.querySelectorAll('.sp-clip[data-clip]'))
                .sort((a, b) => parseFloat(a.style.left) - parseFloat(b.style.left))
                .map((node) => node.dataset.clip)",
        )
        .await?;
    let tracks: usize = tab
        .eval("new Set(Array.from(document.querySelectorAll('.sp-clip[data-clip]'), (n) => n.dataset.track)).size")
        .await?;
    ensure!(tracks == 1, "the clips landed on {tracks} tracks");
    Ok(ids)
}

async fn starts(tab: &Tab, ids: &[String]) -> Result<Vec<f64>> {
    let out: Vec<Option<f64>> = tab.js(STARTS_JS, json!([ids])).await?;
    out.into_iter()
        .map(|s| s.ok_or_else(|| anyhow!("a clip vanished from the timeline")))
        .collect()
}

async fn drag_clip_seconds(tab: &Tab, id: &str, seconds: f64) -> Result<()> {
    let selector = format!(".sp-clip[data-clip=\"{id}\"]");
    let width: f64 = tab
        .js(
            "return parseFloat(document.querySelector(arguments[0]).style.width);",
            json!([selector]),
        )
        .await?;
    tab.drag_by(&selector, width * seconds, 0.0).await
}

fn near(actual: &[f64], expected: &[f64]) -> bool {
    actual.len() == expected.len()
        && actual
            .iter()
            .zip(expected)
            .all(|(a, e)| (a - e).abs() < 0.02)
}

pub fn cases() -> Vec<Case> {
    vec![case(
        "small_drag_moves_a_small_amount_and_back",
        |tab| async move {
            open_tool(&tab, "splicer").await?;
            let ids = load_one_second_clips(&tab, 4).await?;
            let before = starts(&tab, &ids).await?;
            ensure!(near(&before, &[0.0, 1.0, 2.0, 3.0]), "{before:?}");

            drag_clip_seconds(&tab, &ids[1], 0.3).await?;
            let right = starts(&tab, &ids).await?;
            ensure!(
                near(&right, &[0.0, 1.3, 2.3, 3.3]),
                "a 0.3 s drag right should move the clip 0.3 s and shift the later clips: {right:?}"
            );

            drag_clip_seconds(&tab, &ids[1], -0.15).await?;
            let back = starts(&tab, &ids).await?;
            ensure!(
                near(&back, &[0.0, 1.15, 2.3, 3.3]),
                "dragging back left should leave the clip in the gap: {back:?}"
            );
            Ok(())
        },
    )]
}
