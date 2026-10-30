<!-- GENERATED FILE: edit credits.html, then run make docs. -->

# EAS Tools - Credits/Acknoledgements

## Credits/Acknowledgements

Special thanks goes out to the following individuals, resources, and packages/organizations for their contributions to the development of EAS Tools:

### Libraries & Packages

- [Hack font](https://github.com/source-foundry/Hack): Monospace font used for the site's UI typography.
- [wavefile.js](https://rochars.github.io/wavefile/): WAV file writer used for generating downloadable WAV audio files in the Encoder and Audio Splicer tools.
- [wave-resampler.js](https://github.com/rochars/wave-resampler): Audio resampling library used for converting audio sample rates in the Encoder and Audio Splicer tools.
- [gifenc](https://github.com/mattdesl/gifenc): Fast pure-JavaScript GIF encoder used to export text crawl animations as GIF files in the Text Crawl Generator.
- [Mediabunny](https://mediabunny.dev/) (MPL-2.0): WebCodecs-based media toolkit used to encode and mux MP4 (H.264) and WebM (VP9/VP8) video exports in the Text Crawl Generator, and FLAC, MP3 and Opus exports in the Audio Splicer.
- [LAME MP3 Encoder](https://lame.sourceforge.io/) (LGPL, via Mediabunny's [MP3 encoder extension](https://mediabunny.dev/guide/extensions/mp3-encoder)): encodes MP3 exports in the Audio Splicer.
- [libFLAC](https://xiph.org/flac/) (BSD, via Mediabunny's [FLAC encoder extension](https://mediabunny.dev/guide/extensions/flac-encoder)): encodes FLAC exports in the Audio Splicer.
- [h264-mp4-encoder](https://github.com/TrevorSundberg/h264-mp4-encoder): WebAssembly software H.264/MP4 encoder used as the Text Crawl Generator's video export fallback on browsers without WebCodecs.
- [piper.tts.js](https://github.com/Mintplex-Labs/piper-tts-web): WebAssembly-based TTS voice engine used for local in-browser speech synthesis in the Encoder and Audio Splicer tools.
- nanotts.js: Additional WebAssembly TTS voice engine used alongside piper.tts.js for local in-browser speech synthesis.
- [eSpeak NG](https://github.com/espeak-ng/espeak-ng): Formant-synthesis TTS engine compiled to WebAssembly, providing the local `[eSpeak]` voices in the Encoder and Audio Splicer tools.
- [CodeMirror](https://codemirror.net/): Code editor component used for input areas across multiple tools.
- [E2T-NG](https://github.com/wagwan-piffting-blud/E2T-NG) (JS port by wagwan-piffting-blud, originally by Newton Communications, see below for link): Converts SAME headers into human-readable alert text; used in the Decoder and Text Crawl Generator.
- [sox-emscripten](https://github.com/rameshvarun/sox-emscripten): SoX audio processing compiled to WebAssembly, used for audio manipulation in the Audio Splicer tool.
- [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm): FFmpeg compiled to WebAssembly, used for combining video and audio files in the Video/Audio Muxer tool.
- [phonemeize](https://github.com/hans00/phonemize): Phoneme conversion library used for converting text into phoneme representations in the Phoneme Converter/Generator tool.
- [EAS.js](https://github.com/globaleas/EAS.js/) (by [GWES](https://globaleas.org/)): Reference implementation used for ENDEC profile logic in the Decoder and Encoder tools.
- Original SAME decoding/encoding logic by CryptoDude3 (GitHub Pages site removed), maintained and expanded by wagwan-piffting-blud.
- [velocityjs](https://github.com/shepherdwind/velocity.js): JavaScript port of Apache Velocity; renders the NWS WarnGen `.vm` templates unchanged, with seven small compatibility patches applied at preprocess time.
- [Leaflet](https://leafletjs.com/): Open-source interactive map library powering the polygon-drawing surface and the county GeoJSON overlay.
- [Leaflet.draw](https://github.com/Leaflet/Leaflet.draw): Leaflet plugin providing the polygon-drawing, vertex-editing, and clearing tools.
- [PMTiles](https://github.com/protomaps/PMTiles): Single-file tile archive format and reader; serves the WarnGen satellite layer from one file with HTTP range requests.
- [USGS The National Map: Orthoimagery](https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer): Public-domain imagery behind the WarnGen satellite layer (USDA NAIP over the lower 48, Landsat and Blue Marble at small scales).
- [us-atlas](https://github.com/topojson/us-atlas): Pre-built TopoJSON of the U.S. Census 2017 cartographic boundary shapefiles; source of the 3,231-county national GeoJSON after build-time conversion.
- [topojson-client](https://github.com/topojson/topojson-client): TopoJSON-to-GeoJSON converter used at build time to prepare the county dataset.
- [NSF Unidata AWIPS EDEX](https://www.unidata.ucar.edu/data/awips-edex-access) via [python-awips](https://unidata.github.io/python-awips/): Source of the AWIPS `mapdata.warngenloc` table, WarnGen's own point source, filtered to WARNGENLEV 1–4 on land and spatial-joined to county FIPS at build time to produce the \~62,700-location lookup.
- [shapefile](https://github.com/mbostock/shapefile): DBF/SHP parser used to extract FIPS→CWA mappings from the NWS County Warning Area shapefile.
- [marked](https://github.com/markedjs/marked): Markdown parser used to render `CHANGES.md` on the Change Log page.
- NWS WarnGen Velocity templates: The CRS-era `.vm` and `.xml` template files derived from public-domain NWS originals that drive the bulletin generation engine. Sourced from the [NWR Reference Discord server](https://discord.gg/YNuDM8kjR9).
- [U.S. Census Bureau TIGER/Cartographic Boundary Shapefiles](https://www.census.gov/cgi-bin/geo/shapefiles/index.php): Source of the county geometries, FIPS codes, and state assignments (delivered via us-atlas).
- [NOAA / National Weather Service County Warning Area Shapefile](https://www.weather.gov/gis/ZoneCounty) (`c_*.zip`): Source of the FIPS→WFO assignment for all \~3,200 U.S. counties across 125 CWAs.

### Inspiration & References

- [BunnyTub](https://bunnytub.com/) for the new EAS Tools "Toolbox" Logo
- [nicksmadscience SAME Encoder](https://github.com/nicksmadscience/eas-same-encoder) (Python): Early reference for SAME header encoding logic.
- [Mab879 C++ SAME Encoder](https://github.com/Mab879/eas%5Fencoder): Additional reference implementation for EAS/SAME encoding.
- [Anon64 EAS Header Generator](https://github.anon64.dev/eas-gen/): Additional reference for header generation.
- [EAS2Text](https://github.com/Newton-Communications/E2T/) (by Newton Communications): Original Python EAS-to-text library that E2T-NG is based on.
- CryptoDude3 GitHub Pages site (removed): Source of the original encoder/decoder logic and the basis for the current page design.
- [AWIPS](https://www.weather.gov/cp/AWIPSWorking): The official NWS forecaster tool. WarnGen is a browser-based reimagination of a small portion of AWIPS functionality.
- [NWSI 10-17](https://www.weather.gov/directives/010#:~:text=NDS%2010%2D17%20Dissemination): NWS Instruction list. These dictate how warnings are disseminated and how they should be formatted.
- [jacklefucksnetwork](https://www.youtube.com/channel/UCxdYMkg8HS1CrFy7k3GtwTg): Creator of the BC370CRS weather radio sound effects used in the Decoder tool.

## Page last updated: October 10th, 2026
