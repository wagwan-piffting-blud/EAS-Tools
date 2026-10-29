<!-- GENERATED FILE: edit faq.html, then run make docs. -->

# EAS Tools - FAQ/Docs

## Frequently Asked Questions about the EAS and EAS Tools itself

This section addresses common questions regarding the Emergency Alert System (EAS) in general, and some questions about the EAS Tools web application specifically.

- [What is the EAS?](#)
- [What is EAS Tools?](#)
- [What is SAME?](#)
- [What is AFSK modulation?](#)
- [What is the purpose of the EAS Tools web application?](#)
- [How does EAS Tools work?](#)
- [Is EAS Tools free to use?](#)
- [What technologies does EAS Tools use?](#)
- [Who developed EAS Tools?](#)
- [How can I contribute to EAS Tools?](#)
- [Is EAS Tools available as a mobile app?](#)
- [Where can I report bugs or request features without knowing how to code?](#)
- [You mentioned a web TTS service? What's that, and how does it work?](#)
- [How can I support the development of EAS Tools?](#)
- [Are there currently any known issues or limitations with EAS Tools? (updated as of 2026-04-26)](#)
- [How can I get more involved in the overall EAS community?](#)
- [Does EAS Tools work with screen readers (NVDA, JAWS)?](#)

### What is the EAS?

The Emergency Alert System (EAS) is a national public warning system used in the United States that allows authorized government officials to send emergency alerts and warnings to the public via radio, television, and other communication channels. [Learn more at Wikipedia](https://en.wikipedia.org/wiki/Emergency%5FAlert%5FSystem).

### What is EAS Tools?

EAS Tools is a web-based application designed to help users decode and encode EAS SAME headers, generate text crawls, and splice audio files for EAS alerts. It provides a user-friendly interface for working with EAS data and is provided for lab, testing, hobbyist, and educational purposes only. The author is NOT responsible for ANY misuse.

### What is SAME?

[SAME (Specific Area Message Encoding)](https://en.wikipedia.org/wiki/Specific%5FArea%5FMessage%5FEncoding) is a protocol used in the EAS to encode information about emergency alerts, including the type of alert, affected areas, and duration. SAME headers are transmitted as part of the EAS message and are used by receiving devices to determine whether to activate and display the alert. You can most commonly find SAME technology in weather radios and some newer TVs using the ATSC 3 standard. The SAME tones are those 3 repeat distinctive audio signals that accompany the alert messages before and after the alert announcement (if any, usually Required Weekly Tests skip the announcement).

### What is AFSK modulation?

AFSK (Audio Frequency-Shift Keying) modulation is a method of encoding digital data using audio tones of different frequencies. In the context of the EAS, AFSK modulation is used to transmit SAME headers as audio signals that can be decoded by receiving devices. The EAS SAME tones use AFSK modulation at 520.83 bits per second, with a mark frequency of 2083.3 Hz and a space frequency of 1562.5 Hz. You only really need to know this information if you're making your own encoder/decoder, but since this repository provides the necessary tools to work with AFSK modulation in the context of the EAS, there's no real need to know this info (unless you want to be a developer).

### What is the purpose of the EAS Tools web application?

The purpose of the EAS Tools web application is to provide a convenient and accessible way for users to work with EAS SAME headers and related data. It allows users to decode and encode SAME headers, generate text crawls, and splice audio files for EAS alerts, all within a web browser. This makes it easy for hobbyists, educators, and developers to experiment with EAS data without needing complicated, usually hard to use, specialized software or hardware. Anyone can freely use the application without any cost or licensing fees.

### How does EAS Tools work?

EAS Tools is a web-based application that allows users to decode and encode EAS SAME headers directly in their web browser, among other features. It uses JavaScript to process the data locally, ensuring that no data is sent to external servers (except for web TTS requests, more on that below). No analytics or tracking is performed on user data. Any web TTS requests are only logged until Midnight Central Time, for debugging purposes only, and the logs and generated audio are automatically deleted after that time from the server. Your privacy is important to me, and I am committed to protecting it as best as I know how.

### Is EAS Tools free to use?

Yes, EAS Tools is completely free (as in beer AND speech) to use. It is an open-source project available on [GitHub](https://github.com/wagwan-piffting-blud/EAS-Tools), licensed under the GNU GPL 3, a widely used free software license that allows for redistribution and modification with proper attribution. This entire website is also hosted proudly with Hetzner (used to be GitHub Pages). Download the source code, modify it as you see fit, and contribute to the project if you'd like, especially if you know your way around HTML/CSS/JavaScript comfortably! Heck, you can even run a copy of the ENTIRE site locally, so long as you're comfortable with the command line and have the necessary tools installed. The only thing that relies on an outside internet connection is Web TTS. That's it!

### What technologies does EAS Tools use?

EAS Tools is built using standard web technologies, including HTML, CSS, JavaScript, and WebAssembly. It leverages a number of JavaScript libraries for the various functionality provided. Everything is bundled with the GitHub repository, there are absolutely no external dependencies that can get in the way. The application is designed to run entirely in the user's web browser, from any device, ensuring that no data is sent to external servers (except for web TTS requests, again, more on that below).

### Who developed EAS Tools?

EAS Tools was developed by me, [wagwan-piffting-blud (but you can call me Wags)](https://wagspuzzle.space/)! I am a hobbyist developer with a specialized interest in the EAS and technology. Though the intersection of those two interests is hardly mainstream, I believe in making the EAS more accessible to everyone and anyone with even a moderate interest in the topic. Whether that be for mocks, educational purposes, or just personal projects, I truly hope that EAS Tools can be a valuable resource in anyone's back pocket. I work on EAS Tools solely in my free time, and I welcome any feedback or suggestions you may have!

### How can I contribute to EAS Tools?

You can contribute to EAS Tools by visiting the project's [GitHub repository](https://github.com/wagwan-piffting-blud/EAS-Tools). From there, make a Pull Request with your changes or improvements, and I will review it ASAP! If you don't know how to code, that's okay too, see the section below on contributing without coding.

### Is EAS Tools available as a mobile app?

Yes! EAS Tools is available as a mobile app for both Android and iOS devices. You can download the app from the [Google Play Store](https://play.google.com/store/apps/details?id=com.wagspuzzle.eastools) for Android devices or from the [Apple App Store](https://apps.apple.com/us/app/eas-tools/id6759717275) for iOS devices. The mobile app provides the exact same functionality to the web application, allowing you to decode and encode EAS SAME headers, generate text crawls, and splice audio files on your mobile device, and whatever the web version of EAS tools allows you to do normally!

### Where can I report bugs or request features without knowing how to code?

You can report bugs or request features by visiting the project's [GitHub Issues page](https://github.com/wagwan-piffting-blud/EAS-Tools/issues). Your feedback is valuable and helps improve the project! I love reading user feedback, especially with regards to new features that can potentially be added.

### You mentioned a web TTS service? What's that, and how does it work?

The web TTS (Text-to-Speech) service is a server-side component that generates speech audio from text input. When you use the EAS Tools Encoder or Audio Splicer tools and select the Text-to-Speech announcement option and a voice other than WebAssembly/NanoTTS, your text is sent to the TTS server located at [Wags' Puzzle Space](https://wagspuzzle.space/tools/eas-tts). The server processes the text and returns the generated audio back to your browser for inclusion in the EAS alert. This allows for dynamic generation of speech audio without relying on client-side TTS capabilities, which are extremely limited when it comes to being able to synthesize real voices used in actual alerts. Please note that any/all requests made to the TTS server are logged temporarily for debugging purposes only, and all logs and generated audio are automatically deleted at exactly Midnight Central Time. Each individual user is limited to  requests per day overall to prevent abuse of the service. If you find yourself running into the request limit often, try installing some of the voices you're looking to synthesize on a regular basis and using them locally! The web TTS service is provided AS-IS, with no guarantees or warranties, or uptime promises. It may go down randomly, it may not. The server tries to check and make sure it is up before it processes audio, but if it happens to suddenly, randomly go down in the middle of this processing, it may not be able to complete your request successfully. Keep this in mind when using the Web TTS service.

### How can I support the development of EAS Tools?

You can support the development of EAS Tools by contributing code, reporting bugs, requesting features, or spreading the word about the project. You may also (very much optionally!) support the development and hosting of EAS Tools and the EAS TTS service through [PayPal.Me](https://paypal.me/wagspuzzlespace) or [GitHub Sponsors](https://github.com/sponsors/wagwan-piffting-blud). Donating is greatly appreciated and helps cover the costs of hosting and development! All money will **solely** be used to cover the costs of hosting and development.

### Are there currently any known issues or limitations with EAS Tools?

Every effort is made to make sure EAS Tools works at its best. Some features may not work as expected on all browsers or devices, and there may be occasional bugs or glitches with the code. Changes are made regularly to improve the application and address any issues that possibly arise. A best effort is made to keep the application as stable and functional as possible, but please understand that this is a hobby project developed in my free time with no monetary support. If you encounter any issues, please report them on the project's [GitHub Issues page](https://github.com/wagwan-piffting-blud/EAS-Tools/issues) as soon as you notice them, and they will get addressed ASAP.

Currently known issues:

- Accessibility of the tools may not be 100% where I like it to be. There are a lot of missing aria attributes that help promote accessibility when using assistive technologies like screen readers, etc. This is something I am actively working on improving.
- WarnGen is a very new tool, meaning it is bound to have unexpected behavior in some scenarios compared to the real AWIPS CAVE WarnGen. While I tried my best to make it absolutely as close as I could to the original (comparing against multiple VTEC archives), there may be discrepancies in certain cases. For example, county names may not be listed in the correct order, cities may be missing from the path list, highway mile markers and numbers may be inconsistent, or the generated warning may not include all the necessary information. Most of these issues are simply data-related, meaning that I am not able to fix them myself, as they originate from outside the code I made if that makes sense. Cities are no longer one of those issues: WarnGen now uses the same location table real AWIPS WarnGen does (`mapdata.warngenloc`, pulled from NSF Unidata's public EDEX server), including the WARNGENLEV rankings that decide which places show up in the closest-point line, the pathcast, and the other-locations list. That means small rural towns and unincorporated communities are included, not just places with 1,000+ people.

### How can I get more involved in the overall EAS community?

You can get more involved in the EAS community by joining online forums, participating in discussions on social media, and connecting with other hobbyists and professionals interested in the EAS. There are many online communities dedicated to the EAS where you can share your experiences, and connect with others who share your interest. Some popular places to start include the [Global Weather and EAS Society Discord](https://globaleas.org/) (of which I am an active member), [the EAS sub-reddit](https://www.reddit.com/r/EmergencyAlertSystem/), and I'm sure there are more that are not mentioned here. Additionally, consider reaching out to local professionals that deal with the EAS, such as your local broadcasters or even HAM radio operators.

### Does EAS Tools work with screen readers (NVDA, JAWS)?

The main tools page is built to be navigable by NVDA and JAWS on Windows. The Decoder, Encoder, Text Crawl Generator, Audio Splicer, Phoneme Converter, and AWIPS Product Normalizer expose ARIA roles, labels, and live regions so screen-reader users can:

- Use arrow keys to move between the tool tabs at the top of the page.
- Hear "Audio signal present" / "No audio signal" announcements while the microphone or stream decoder is running.
- Hear the status of the SAME sync detector update in real time.
- Receive an "Alert decoded" announcement when the Decoder identifies a SAME header, with the alert details modal trapping focus until you press Escape or activate the close button.

**Known limitations:**

- The Audio Splicer's waveform editor exposes a visual-only drag-select. Use the numeric "Insert Silence", loudness, and macro controls for keyboard-only editing.
- Generated TTS preview audio plays through your speakers and will overlap with your screen reader's speech. See the note in the TTS documentation for how to handle this.

**Recommended setup:** NVDA or JAWS on Windows + Chrome. Browse mode (the default) handles page navigation; the app will flip into focus mode automatically when you enter the tablist, a form control, or the alert-details dialog.
