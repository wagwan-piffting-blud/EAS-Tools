//! #167: events whose names carry no Warning/Watch/Emergency-style word (BLU, MEP, NMN, TX*)
//! still get a severity in the Decoder, from the event-code table in event-severity.js.

use eas_tools_e2e::*;

use crate::common::open_tool;

async fn modal_for(tab: &Tab, header: &str) -> Result<String> {
    tab.exec(
        "window.__testPromptValue = arguments[0]; window.prompt = () => window.__testPromptValue;",
        json!([header]),
    )
    .await?;
    tab.click("button[data-decoder-load-raw]").await?;
    tab.wait_until(
        "Array.from(document.querySelectorAll('#output button')).some((el) => el.innerText.trim() === 'View Alert')",
        Duration::from_secs(25),
    )
    .await?;
    let found: bool = tab
        .js(
            "const b = Array.from(document.querySelectorAll('#output button')).filter((el) => el.innerText.trim() === 'View Alert').pop();
             document.querySelectorAll('[data-test-view-alert]').forEach((el) => el.removeAttribute('data-test-view-alert'));
             if (b) b.setAttribute('data-test-view-alert', '');
             return !!b;",
            json!([]),
        )
        .await?;
    ensure!(found, "no View Alert button in the output");
    tab.click("[data-test-view-alert]").await?;
    tab.wait_until(
        "document.querySelector('.modalInfo').innerText.includes('Send alert to')",
        Duration::from_secs(60),
    )
    .await?;
    tab.eval("document.querySelector('.modalInfo').innerText")
        .await
}

async fn severity_and_border(tab: &Tab, header: &str) -> Result<(String, String)> {
    open_tool(tab, "decoder").await?;
    let modal = modal_for(tab, header).await?;
    let severity = modal
        .lines()
        .find_map(|line| line.trim().strip_prefix("Severity: "))
        .unwrap_or_default()
        .to_string();
    let border: String = tab
        .eval("document.querySelector('.modalBox')?.style.borderColor ?? ''")
        .await?;
    Ok((severity, border))
}

fn severity_case(
    name: &'static str,
    header: &'static str,
    severity: &'static str,
    border: &'static str,
) -> Case {
    case(name, move |tab| async move {
        let (shown, color) = severity_and_border(&tab, header).await?;
        ensure!(
            shown == severity,
            "{header}: severity {shown:?}, expected {severity}"
        );
        ensure!(
            color == border,
            "{header}: border {color:?}, expected {border}"
        );
        Ok(())
    })
}

pub fn cases() -> Vec<Case> {
    vec![
        severity_case(
            "blue_alert_is_a_warning",
            "ZCZC-CIV-BLU-034039+0100-1351200-KLOT/NWS-",
            "Warning",
            "red",
        ),
        severity_case(
            "missing_persons_is_a_warning",
            "ZCZC-CIV-MEP-034039+0100-1351200-KLOT/NWS-",
            "Warning",
            "red",
        ),
        severity_case(
            "network_notification_is_an_advisory",
            "ZCZC-EAS-NMN-034039+0100-1351200-KLOT/NWS-",
            "Advisory",
            "yellow",
        ),
        severity_case(
            "transmitter_status_is_an_advisory",
            "ZCZC-WXR-TXO-034039+0100-1351200-KLOT/NWS-",
            "Advisory",
            "yellow",
        ),
        severity_case(
            "marked_events_keep_their_word_severity",
            "ZCZC-WXR-TOA-034039+0100-1351200-KLOT/NWS-",
            "Watch",
            "orange",
        ),
    ]
}
