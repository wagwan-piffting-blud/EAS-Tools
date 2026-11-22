# Using EAS Tools

Serve the repository over HTTP and open `index.html`, or use
[eas.tools](https://eas.tools/). The application tabs can also be opened with
`?tool=decoder`, `encoder`, `crawl`, `splicer`, `phoneme`, `warngen`, `muxer`, or `multiview`.

## Decoder

1. Open **Decoder** and choose a microphone, direct stream, or an audio or video file
   (the Decoder reads a video's sound).
2. Grant microphone permission when prompted. Playback of the selected source is optional.
3. Play an EAS/SAME signal, or use **Load/Analyze Raw ZCZC Header** for text input.
4. Open the decoded alert to inspect the raw header, originator, event, locations,
   issue and expiration times, sender, inferred ENDEC profile, and EAS2Text wording.

Decoded alerts can be transferred to the encoder for regeneration. Inference of
an ENDEC profile is a best match, not proof of the originating hardware.
**Recording format** sets the file type, channels and sample rate of saved recordings.

## Encoder

1. Open **Encoder** and complete the SAME form, or provide a custom SAME header.
2. Optionally enter spoken-message text and select a TTS voice.
3. Select **Generate**, review the resulting audio, and select **Save audio file** if required.
   **Saved audio file** picks the format (WAV 16-bit by default; 24-bit and 32-bit float WAV,
   FLAC, MP3, and Opus or AAC where the browser can encode them), the bitrate for MP3, Opus
   and AAC, mono or stereo, and the sample rate. Original keeps 44.1 kHz, or the ENDEC's rate
   when **Emulate ENDEC Sample Rate** is on.

WebAssembly voices run locally. Other Web TTS voices are sent to the configured
TTS service; see the [TTS documentation](./generated/tts.md) before using them.

Locations come from the county, Canadian, and NWS marine tables
(`assets/E2T/include/same-marine.json`, built from
[weather.gov/gis/EasNWR](https://www.weather.gov/gis/EasNWR) by
`tools/build-same-marine.mjs`). A well-formed six-digit code typed into the
manual FIPS field is accepted even when no table lists it; the status log marks
it as custom and decoders show it as a bare FIPS code.

**Custom event codes**, under the event picker, saves three-letter codes and
their names in this browser. The encoder lists them under *Custom Codes*, and
the decoder, EAS2Text, and text crawl use their names. Codes nobody has named
read as "an Unrecognized Warning/Watch/Statement/Emergency" by their last
letter, or "an Unrecognized Message".

With the VT Paul voice selected, the Encoder and the Audio Splicer show "NWR
pronunciations (VT Paul)". It applies the NWS national dictionary by default.
Pick a forecast office or NOAA Weather Radio transmitter to add that site's
pronunciations, speed and pauses. **Preview replacements** shows the text as it
will be sent. **My pronunciations…** lets you add your own entries, turn shared
ones off, import or export them, and suggest them for everyone (anonymous,
reviewed before publishing).

## Text crawl generator

1. Select custom text or generate text from a SAME header with EAS2Text.
2. Configure speed, frame delay, dimensions, font, inset, and colors. A background can be a
   solid color, an image, a video, or an animated GIF (turned into a video when chosen).
3. Preview with the start, pause, and stop controls.
4. Export GIF or WebM output, or copy the resolved crawl text.

## Audio splicer

1. Load audio clips (or the sound of a video), or synthesize TTS clips inside the splicer.
2. Arrange, trim, split, and process clips; add silence or macros as needed.
3. Pick the export format, then review the timeline and select **Export Audio**.

Every file picker on the site (audio, video, images, fonts, presets, WarnGen imports) works
the same way: a **Choose file…** button that shows the chosen file's name, and you can also
drop a file onto it. Audio pickers accept video files too and use their sound.

## Phoneme converter and TTS

Enter text, select the target phoneme system, and convert it. Copy the result into
a compatible voice or TTS field. The generated phoneme references and detailed
voice controls are linked from the [documentation index](./index.md).

## WarnGen

1. Open **WarnGen**, then select a product and template era.
2. Complete the product fields and use the map to define affected geography.
3. Review generated UGC, VTEC, headings, timing, bullets, and product text.
4. Export the polygon or AWIPS text product.

WarnGen is a reconstruction and editing aid. Product output should be compared with
the applicable authoritative template and configuration. It doesn't replace the
original WarnGen in CAVE for official use.

## Video/audio muxer

Load FFmpeg.wasm, select the video and audio inputs, append the audio, and download
the result. Loading FFmpeg is required once per browser session.

## Multi-View

**Multi-View** (`?tool=multiview`) shows two to four tools side by side, each a
full copy of that tool. Drag a tool from the strip onto a pane to put it there,
or drag a pane by its handle to swap places; each pane also has a tool picker,
move buttons, and a close button for keyboard use. **Send to…** delivers into
the pane holding the target tool, opening one if there is room. The layout is
remembered per browser. It needs a window at least 1024 pixels wide, so phones
never offer it, and the mobile apps do not include it.

## Accessibility

The main shell supports keyboard navigation, screen-reader announcements, and a
focus-managed alert-details dialog. NVDA or JAWS with Chrome is the recommended
tested combination. Map drawing and waveform drag-selection remain inherently
visual interactions; consult the [accessibility FAQ](./generated/faq.md)
for current details and alternatives.
