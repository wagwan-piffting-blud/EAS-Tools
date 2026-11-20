//! #168: an AWIPS product pasted into the Encoder's header box (or sent from WarnGen) also puts
//! the Product Normalizer's text into the TTS message, behind the "productToTts" option.

use eas_tools_e2e::*;

use crate::common::{set_checkbox, set_field};

const PRODUCT: &str = "WFUS53 KLMK 271505\nTORLMK\nKYC111-271545-\n/O.NEW.KLMK.TO.W.0001.260927T1505Z-260927T1545Z/\n\nBULLETIN - EAS ACTIVATION REQUESTED\nTornado Warning\nNational Weather Service Louisville KY\n1105 AM EDT Sun Sep 27 2026\n\nThe National Weather Service in Louisville has issued a\n\n* Tornado Warning for...\n  Jefferson County in north central Kentucky...\n\n* Until 1145 AM EDT.\n\n* At 1105 AM EDT, a severe thunderstorm capable of producing a tornado\n  was located over Shively, moving east at 30 mph.\n\nPRECAUTIONARY/PREPAREDNESS ACTIONS...\n\nTAKE COVER NOW!\n\n&&\n\n$$\n";

const ZCZC: &str = "ZCZC-WXR-TOR-021111+0030-2701505-KLMK/NWS-";

const FAKE_BRIDGE_JS: &str = "
window.__bridgeHandlers = {};
window.__bridgeSent = [];
window.EASBridge = {
    on(name, fn) { window.__bridgeHandlers[name] = fn; },
    send(name, payload) { window.__bridgeSent.push([name, JSON.parse(JSON.stringify(payload))]); },
};
";

async fn open_header_mode(tab: &Tab) -> Result<()> {
    tab.goto("index.html?tool=encoder").await?;
    tab.wait_until(
        "typeof window.resolveHeaderInput === 'function' && !!window.encoderEditor && Object.keys(window.state || {}).length > 40",
        Duration::from_secs(40),
    )
    .await?;
    set_field(tab, "#encoderMode", "header").await?;
    tab.wait_until(
        "getComputedStyle(document.getElementById('stringEncoder')).display !== 'none'",
        Duration::from_secs(30),
    )
    .await
}

async fn normalized(tab: &Tab) -> Result<String> {
    let text: String = tab
        .js_async(
            "const done = arguments[arguments.length - 1];
             import('./assets/js/normalizer-core.js').then(() => done(window.normalizeNwsBulletin(arguments[0]).trim()), (e) => done('ERROR ' + e));",
            json!([PRODUCT]),
        )
        .await?;
    ensure!(
        !text.is_empty() && !text.starts_with("ERROR"),
        "normalizer gave {text:?}"
    );
    Ok(text)
}

async fn tts_text(tab: &Tab) -> Result<String> {
    tab.eval("window.encoderEditor.getValue()").await
}

async fn set_tts_text(tab: &Tab, text: &str) -> Result<()> {
    tab.exec(
        "window.encoderEditor.setValue(arguments[0]);",
        json!([text]),
    )
    .await
}

async fn wait_for_tts(tab: &Tab, expected: &str) -> Result<()> {
    tab.exec("window.__expectedTts = arguments[0];", json!([expected]))
        .await?;
    tab.wait_until(
        "window.encoderEditor.getValue().trim() === window.__expectedTts",
        Duration::from_secs(20),
    )
    .await
    .with_context(|| format!("TTS message never became {expected:?}"))
}

async fn header_preview_settles(tab: &Tab) -> Result<()> {
    tab.wait_until(
        "document.getElementById('headerPreview').textContent.startsWith('ZCZC-')",
        Duration::from_secs(20),
    )
    .await
}

async fn bridge_product_text(tab: &Tab, header: &str) -> Result<Value> {
    tab.exec(
        "window.__askedHeader = arguments[0]; window.__bridgeHandlers['encoder:requestProductText']({ header: arguments[0] });",
        json!([header]),
    )
    .await?;
    tab.wait_until(
        "window.__bridgeSent.some(([n, p]) => n === 'encoder:productText' && p.header === window.__askedHeader)",
        Duration::from_secs(20),
    )
    .await?;
    tab.js(
        "return window.__bridgeSent.filter(([n, p]) => n === 'encoder:productText' && p.header === arguments[0]).pop()[1];",
        json!([header]),
    )
    .await
}

pub fn cases() -> Vec<Case> {
    vec![
        case("pasted_product_fills_the_tts_message", |tab| async move {
            open_header_mode(&tab).await?;
            let expected = normalized(&tab).await?;
            set_tts_text(&tab, "Old message").await?;
            set_field(&tab, "#cheader", PRODUCT).await?;
            wait_for_tts(&tab, &expected).await?;
            let status: String = tab
                .eval("document.getElementById('status').innerText")
                .await?;
            ensure!(status.contains("normalized text"), "{status}");
            Ok(())
        }),
        case("option_off_leaves_the_message_alone", |tab| async move {
            open_header_mode(&tab).await?;
            set_checkbox(&tab, "productToTts", false).await?;
            set_tts_text(&tab, "Keep me").await?;
            set_field(&tab, "#cheader", PRODUCT).await?;
            header_preview_settles(&tab).await?;
            tokio::time::sleep(Duration::from_millis(500)).await;
            let text = tts_text(&tab).await?;
            ensure!(text == "Keep me", "{text}");
            Ok(())
        }),
        case("a_zczc_header_leaves_the_message_alone", |tab| async move {
            open_header_mode(&tab).await?;
            set_tts_text(&tab, "Keep me").await?;
            set_field(&tab, "#cheader", ZCZC).await?;
            header_preview_settles(&tab).await?;
            tokio::time::sleep(Duration::from_millis(500)).await;
            let text = tts_text(&tab).await?;
            ensure!(text == "Keep me", "{text}");
            Ok(())
        }),
        case(
            "product_sent_from_warngen_fills_the_tts_message",
            |tab| async move {
                open_header_mode(&tab).await?;
                let expected = normalized(&tab).await?;
                set_tts_text(&tab, "Old message").await?;
                tab.exec(
                "window.EASHandoff.sendTo('encoder', { header: arguments[0], office: 'LMK' }, { what: 'Product' });",
                json!([PRODUCT]),
            )
            .await?;
                wait_for_tts(&tab, &expected).await?;
                let header: String = tab
                    .eval("document.getElementById('headerPreview').textContent")
                    .await?;
                ensure!(header.starts_with("ZCZC-WXR-TOR-"), "{header}");
                Ok(())
            },
        ),
        case("native_bridge_returns_the_product_text", |tab| async move {
            tab.add_init_script(FAKE_BRIDGE_JS).await?;
            tab.goto("index.html?tool=encoder").await?;
            tab.wait_until(
                "!!window.__bridgeHandlers['encoder:requestProductText'] && Object.keys(window.state || {}).length > 40",
                Duration::from_secs(40),
            )
            .await?;
            let expected = normalized(&tab).await?;
            let product = bridge_product_text(&tab, PRODUCT).await?;
            ensure!(
                product["product"] == true && product["text"] == expected.as_str(),
                "{product}"
            );
            let header = bridge_product_text(&tab, ZCZC).await?;
            ensure!(
                header["product"] == false && header["text"] == "",
                "{header}"
            );
            Ok(())
        }),
    ]
}
