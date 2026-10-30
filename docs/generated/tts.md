<!-- GENERATED FILE: edit tts-docs.html, then run make docs. -->

# EAS Tools - TTS Documentation

## Text-to-Speech (TTS) Documentation

The Text-to-Speech (TTS) feature in EAS Tools allows users to convert text messages into spoken audio. This can be particularly useful for generating alerts with announcements based on the text input.

### How to Use the TTS Feature

1. Navigate to the encoder section of the EAS Tools application.
2. Enter the text you wish to convert into speech in the provided text area after checking "Spoken message".
3. Select the desired voice.
4. Click the "Generate" button to create the speech audio alongside the tones.
5. Listen to the generated audio or download it for later use.

### Supported Voices

EAS Tools supports a variety of voices for text-to-speech conversion. Users can choose from a list of different voices to use, each with their own unique characteristics. The following is a list of voices currently available to users, and what backends they use in square brackets:

- \[WASM\] WebAssembly (local) Voice
- \[NanoTTS\] NanoTTS (local) Voice
- \[Speechify\] Speechify (local) Voice
- \[AcuVoice\] AcuVoice (local) Voice
- \[eSpeak\] eSpeak NG (local) Voices — English (US/UK), Spanish (Latin America), French, plus the Male 3, Female 2, Whisper, Croak and Klatt variants

NOTE: **Except for the WebAssembly voices**, all voices listed here are processed by an outside server located at [Wags' Puzzle Space](https://wagspuzzle.space/tools/eas-tts/). This is because they require server-side processing to generate the speech audio, which is beyond the capabilities of a simple site like EAS Tools.

### Voice Descriptions

Each voice has its own unique sound and characteristics. For example, the DECTalk voices are known for their distinctive robotic sound, while the other voices offer a more natural-sounding speech synthesis. Users can experiment with different voices to find the one that best suits their needs. If you want a small taste of each voice, you can listen to the demos provided on the [demos page](./tts-demos.md).

### Additional Notes

When using the TTS feature, users should be aware of the following:

- The quality of the generated speech may vary depending on the selected voice. See below for pronunciation notes and examples.
- There is a per-user limit of the configured number of successful requests per day for the server-side voices to prevent abuse. This limit resets daily at midnight Central Time. All processed audio is also cleared at this time, so make sure you download your audio before then.
- Each TTS request is allowed up to 90 seconds to complete itself. If a request takes longer than this, it will be terminated and abandoned by the server. Most requests should complete LONG before this timer is up, but know that **you may need to adjust your text input or try a different voice if you encounter timeouts.** Timeouts usually result in an "x-empty" response by the TTS server.
- **Screen reader users:** TTS preview audio plays through your computer's speakers and will overlap with your screen reader's speech. Recommended workflow: wear headphones, or temporarily silence the screen reader before pressing Play (NVDA: press `Insert`+`S` to cycle the speech mode to "off"; JAWS: press `Insert`+`Space` then `S`, or just press `Ctrl` to silence the current utterance). The decoded audio from the SAME Decoder behaves the same way.

### Pronunciation Notes and Examples

Here are some pronunciation notes and examples for the different voices available in EAS Tools:

- Each voice will pronounce each word in the text input according to its own unique characteristics. Users are encouraged to experiment with different voices to find the one that best suits their needs. YouTube is a great example of where to find pronunciation examples for various text-to-speech voices.
- Some voices may have difficulty pronouncing certain words or phrases, especially if they are uncommon or technical in nature. Users may need to adjust their text input to ensure that the generated speech is clear and understandable. See below for some codes you can use to adjust pronunciation depending on the backend used for the given voice.
- If you find yourself running into the daily request limit frequently, try installing some of the voices locally so you know what to expect when using them. This also helps reduce server load since you're using the voices locally instead of relying on an outside service. Installers for most of the voices can be found on websites like the [Internet Archive](https://archive.org/) or the ["EAS Mock Resources"](https://easmocks.carrd.co/) Carrd site.

Below are some specific pronunciation guidelines for different TTS backends, including both WebAssembly (WASM) and Web TTS voice types. Note that "full control" means you can adjust all of the following parameters: pronunciation, rate, and pitch (the most common types of mutability with TTS), while "partial control" means you can only adjust certain aspects (which are listed per-voice). "Immutable" means you cannot adjust **any** of these parameters for that specific voice.

WebAssembly (WASM, fully local/in-browser) voices:

- **\[WASM\] Piper: Immutable.** There is no built-in way to modify pronunciation or rate/pitch with this specific WebAssembly voice backend.
- **\[NanoTTS\] NanoTTS: Immutable.**
- **\[Speechify\] Speechify WASM: Includes full control.**
- **\[AcuVoice\] AcuVoice WASM: Includes partial (pronunciation ONLY) control.** Use Balabolka/Balcon `<pron sym="...">` formatting. (Example: `<pron sym="t eh k ey 1 m ax" />`)
- **\[eSpeak\] eSpeak NG WASM: Includes full control**, but NOT as inline tags. Wrap Kirshenbaum phonemes in double square brackets to override a word, e.g. `[[t,Ek@m'A]]` for "Tekamah". A full mnemonic list is in the [eSpeak NG phoneme documentation](https://github.com/espeak-ng/espeak-ng/blob/master/docs/phonemes.md). XML and SSML tags are **not** parsed; they will be read out loud verbatim. The Speech Speed and Speech Pitch controls, however, **do indeed** apply to these voices, and are the only way to control rate/pitch. Each one is a slider paired with a number box, so you can either drag it or type an exact value from -10 to 10.

The **Speech Speed**, **Speech Pitch** and **Speech Volume** controls in the Encoder and Audio Splicer wrap your text in the right markup for you, so you do not have to write these tags by hand. All three are independent and combine freely in any mix. Each runs from -10 to +10, with 0 meaning "leave it alone", and each has a slider and a number box that stay in sync. What they turn into depends on the backend:

- **\[VT\] VoiceText:** speed becomes `<vtml_speed value="0-200">`, pitch becomes `<vtml_pitch value="0-200">`, and volume becomes `<vtml_volume value="1-500">`. VoiceText is the only backend that can go _louder_ than normal; +10 volume is five times normal.
- **\[BAL\] Balabolka/Balcon** (and **\[BAL/SPFY\] Speechify**): speed becomes `<rate absspeed="-10 to 10">`, pitch becomes `<pitch absmiddle="-10 to 10">`, and volume becomes `<volume level="1-100">`. SAPI treats 100 as full volume, so these voices can only be made _quieter_; a positive volume setting is ignored rather than being turned into a tag that does nothing.
- **\[eSpeak\] eSpeak NG:** speed and pitch are applied directly by the engine rather than as markup, and volume does not apply, so that control is hidden when an eSpeak voice is selected.
- Every other backend ignores all three controls, and the controls are hidden for them.

**A note on volume in the Encoder:** the Encoder normalises announcement audio to a fixed level so that voices with very different native loudness all sit consistently against the tones. That normalisation is now scaled by whatever you set the volume to, so the setting is audible in the finished alert rather than being flattened back out. Because the announcement is already driven right up to the clipping point by default, a _positive_ volume in the Encoder mostly reads as heavier clipping rather than as extra loudness; negative volume behaves exactly as you would expect. The Audio Splicer does not normalise, so there the volume setting is passed through untouched.

The tags nest, so setting more than one is fine: speed, pitch and volume together on a Balabolka voice produces `<volume level="51"><pitch absmiddle="5"><rate absspeed="-3">your text</rate></pitch></volume>`. You can still write any of these tags yourself in the text box if you want finer control than the sliders give; the two are added together as plain nesting.

Web TTS voices:

- **\[VT\] VoiceText/NeoSpeech: Includes full control.** See the detailed [documentation PDF](../../assets/tts%5Fbackend%5Fcodes/vtml.pdf) for a full list of examples and documentation for the VTML format. A simplified table of all codes is available [at this link](./phonemes/vtml.md). A complete example of VoiceText is below for demonstration purposes.
- **\[BAL\] Balabolka/Balcon: Includes full control.** You can use the SAPI/Microsoft Speech Platform codes to adjust things like silence periods, speech rate (how fast the text is spoken), speech pitch, volume, and phonemes (the big one). Phonemes are formatted like so: `<pron sym="t eh k ey 1 m ax" />`, which would pronounce the word "Tekamah" (city in Nebraska) correctly. A full list of phonemes is [available here](./phonemes/balabolka.md). The same example for VoiceText is available in Balabolka format below too.
- **\[DT\] DECTalk: Includes full control.** DECTalk has its own set of phoneme codes that can be used to adjust pronunciation. An example would be `[:phoneme on] [axs'owshiyeyt]`. This will pronounce the word "associate" like "uh-soh-shee-ayt" (to associate something with someone or something), not like "uh-soh-shee-at" (an associate/worker at a store). A full list of DECTalk phoneme codes can be found in the link [located here](./phonemes/dectalk.md).
- **\[FEST\] Festvox: Immutable.** Festvox uses the Festival Speech Synthesis System, which has no way to override the pronunciation of words "on the fly" like other engines. You're limited to the pre-defined pronunciations in the voice model.
- **\[CEP6\] Cepstral: Immutable.** No pronunciation or phoneme correction is available using these voices, sadly.
- **\[EMNet\] EMNet: Immutable.** The EMNet voice uses a bunch of pre-recorded audio files and just combines them according to the header and time the alert expires, so there are no options (other than what timezone you wish to use).
- **\[BAL/SPFY\] Speechify: Includes full control.** Speechify uses the same phoneme codes as Balabolka/Balcon, so you can use the same techniques listed above to adjust pronunciation. You may also use SPR, or [Symbolic Phonetic Representation](https://github.com/wagwan-piffting-blud/Speechify#spr-symbol-reference), to perform phoneme/pronunciation control at the Speechify engine level, separate from Balabolka's phonemic controls. An example would be `\![1tEk.2am.a]`. However, most of the time, these pronunciations line up with each other, making them (somewhat) redundant.
- **\[ECI\] IBM ViaVoice ECI: Immutable.** Uses a custom backend.
- **\[WAT\] IBM Watson: Immutable.** Also uses a custom backend like ECI.

If you're having trouble with pronunciation of specific words, try adjusting the phoneme codes or using different text input that sounds more literal to the word you're trying to emulate (e.g., "teh kay mah" vs "Tekamah"). You can also experiment with different voices to see if they handle the text better. **If you need an exact phoneme for a specific word and voice, and don't know if anyone else has it, try either the built-in Phoneme Converter/Generator tool OR the [TTS Phoneme Helper ChatGPT GPT](https://chatgpt.com/g/g-6919e0f83e4c8191b57400362668981c-tts-phoneme-helper), which is built and trained on the data in this exact documentation. (NOTE: Requires a (free) OpenAI account to use.)**

### Addendum: A full example of VoiceText VTML/Balabolka Phoneme usage

Here is a full example of how to use the VoiceText Paul voice with example VTML codes to adjust pronunciation, speed, and pitch:

```xml
This Hazardous Weather Outlook is for southwest Iowa<vtml_pause time="200"/>west central Iowa<vtml_pause time="200"/>east central Nebraska<vtml_pause time="200"/>northeast Nebraska and southeast Nebraska, including the city of <vtml_phoneme alphabet="x-cmu" ph="T AH K EY0 M AH">Tekamah</vtml_phoneme> for testing purposes.

For tonight... No hazardous weather is expected at this time.

SPOTTER INFORMATION STATEMENT<vtml_pause time="200"/>Spotter activation is not expected at this time.

<vtml_pause time="1500"/>

This is NOAA All Hazards Radio Station K I H 61 in Omaha<vtml_pause time="200"/>Nebraska.

The current time is, current local time.

<vtml_pitch value="150">This sentence is higher pitched than normal.</vtml_pitch>

<vtml_speed value="70">And this sentence is spoken at a slower rate than normal.</vtml_speed>
```

And that same example, but with Balabolka:

```xml
This Hazardous Weather Outlook is for southwest Iowa<silence msec="200"/>west central Iowa<silence msec="200"/>east central Nebraska<silence msec="200"/>northeast Nebraska and southeast Nebraska, including the city of <pron sym="t eh k ey 1 m ax" /> for testing purposes.

For tonight... No hazardous weather is expected at this time.

SPOTTER INFORMATION STATEMENT<silence msec="200"/>Spotter activation is not expected at this time.

<silence msec="1500"/>

This is NOAA All Hazards Radio Station K I H 61 in Omaha<silence msec="200"/>Nebraska.

The current time is, current local time.

<pitch absmiddle="5">This sentence is higher pitched than normal.</pitch>

<rate absspeed="-3">And this sentence is spoken at a slower rate than normal.</rate>
```

Finally, with DECtalk:

```text
[:comma 20] This Hazardous Weather Outlook is for southwest Iowa, west central Iowa, east central Nebraska, northeast Nebraska and southeast Nebraska, including the city of [:phoneme on] [t ah k ey m ah] for testing purposes.

For tonight... No hazardous weather is expected at this time.

[:period 1500]

SPOTTER INFORMATION STATEMENT, Spotter activation is not expected at this time.

[:period 60]

This is NOAA All Hazards Radio Station K I H 61 in Omaha, Nebraska.

[:comma 0] The current time is, current local time.

[:np][:dv ap 200] This sentence is higher pitched than normal. [:sync]

[:np][:dv ap 120][:rate 100] And this sentence is spoken at a slower rate than normal. [:sync]
```

### Conclusion

By keeping these notes in mind, users can make the most of the TTS feature in EAS Tools and ensure a smoother experience when working with different voices.

## Page last updated: September 25th, 2026
