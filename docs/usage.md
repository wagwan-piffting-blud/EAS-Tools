# Using EAS Tools

Serve the repository over HTTP and open `index.html`, or use
[eas.tools](https://eas.tools/). The application tabs can also be opened with
`?tool=decoder`, `encoder`, `crawl`, `splicer`, `phoneme`, `warngen`, or `muxer`.

## Decoder

1. Open **Decoder** and choose a microphone, direct stream, or uploaded audio file.
2. Grant microphone permission when prompted. Playback of the selected source is optional.
3. Play an EAS/SAME signal, or use **Load/Analyze Raw ZCZC Header** for text input.
4. Open the decoded alert to inspect the raw header, originator, event, locations,
   issue and expiration times, sender, inferred ENDEC profile, and EAS2Text wording.

Decoded alerts can be transferred to the encoder for regeneration. Inference of
an ENDEC profile is a best match, not proof of the originating hardware.

## Encoder

1. Open **Encoder** and complete the SAME form, or provide a custom SAME header.
2. Optionally enter spoken-message text and select a TTS voice.
3. Select **Generate**, review the resulting audio, and save the WAV if required.

WebAssembly voices run locally. Other Web TTS voices are sent to the configured
TTS service; see the [TTS documentation](./generated/tts.md) before using them.

## Text crawl generator

1. Select custom text or generate text from a SAME header with EAS2Text.
2. Configure speed, frame delay, dimensions, font, inset, and colors.
3. Preview with the start, pause, and stop controls.
4. Export GIF or WebM output, or copy the resolved crawl text.

## Audio splicer

1. Upload clips or synthesize TTS clips inside the splicer.
2. Arrange, trim, split, and process clips; add silence or macros as needed.
3. Review the timeline and select **Export WAV**.

## Phoneme converter and TTS

Enter text, select the target phoneme system, and convert it. Copy the result into
a compatible voice or TTS field. The generated phoneme references and detailed
voice controls are linked from the [documentation index](./index.md).

## WarnGen

1. Open **WarnGen**, then select a product and template era.
2. Complete the product fields and use the map to define affected geography.
3. Review generated UGC, VTEC, headings, timing, bullets, and product text.
4. Export the polygon or AWIPS text product.

WarnGen is a reconstruction and editing aid. Product output should be compared
with the applicable authoritative template, configuration, and operational
requirements before real-world use.

## Video/audio muxer

Load FFmpeg.wasm, select the video and audio inputs, append the audio, and download
the result. Loading FFmpeg is required once per browser session.

## Accessibility

The main shell supports keyboard navigation, screen-reader announcements, and a
focus-managed alert-details dialog. NVDA or JAWS with Chrome is the recommended
tested combination. Map drawing and waveform drag-selection remain inherently
visual interactions; consult the [accessibility FAQ](./generated/faq.md)
for current details and alternatives.
