2026-05-23:

- Update phonemizer tool to handle more edge cases (the word "Louisville", for example, no longer causes an error). Thank you to Jasmine in the GWES Discord for reporting this issue.

---

2026-05-21:

- Improve accessibility of the website by adding ARIA labels to interactive elements and ensuring that all content is properly structured for screen readers. This includes adding appropriate roles and labels to buttons, links, and form elements, as well as ensuring that the overall structure of the page is logical and easy to navigate for users with assistive technologies. These improvements will help make the website more inclusive and usable for a wider range of users, including those with visual impairments or other disabilities. **NOTE: If you use a screen reader and notice any issues with the accessibility of the website after this change, please let me know so I can address them!**

---

2026-05-17:

- Add extra 1 second of silence to the beginning and end of NWS_CRS mode. This is because CRS tones have this extra silence built in, so adding it to the generated tones makes them sound more natural and similar to actual CRS tones.
- Update "National Emergency Action Notification" (EAN code) to "National Emergency Message". The FCC made this change in 2022, but the same_us.json file still had the old name. This update ensures that the phrasing of EAN products in the encoder is accurate and consistent with the current terminology used by the FCC.
- Update FE_AREA data from c_16ap26.dbf (3352 rows) and run the partOfParentRegion repair on the geojson. The repair process updates the partOfParentRegion property for each feature in the geojson based on the FE_AREA code from the shapefile. Results can be found in warngen/tools/output/repair_report.md. TL;DR: More accurate "x County in FE_AREA State" phrasing for almost all counties in the continental US. For example, "Scott County in FE_AREA Tennessee". FE_AREA previously was "northeastern", but has since been updated to be "east" because the data was "empirically derived" before, it is now "single source of truth" based on c_16ap26.dbf. This should make the phrasing of affected areas in products more accurate and consistent with the actual FE_AREA codes used by the NWS. The repair process also identified some discrepancies between the original geojson and the shapefile data, which have been corrected in the updated geojson. Overall, this update should improve the accuracy and reliability of the geographic data used in WarnGen for determining affected areas and generating product text.

---

2026-05-07:

- Update GitHub Pages deployment action to remove deprecation warning for Node.js 20.

---

2026-04-26:

- Added WarnGen to tools. WarnGen is a web-based AWIPS CAVE WarnGen clone with a focus on ease of use and accessibility. It is designed to be a lightweight alternative to the original WarnGen, with a simplified interface and reduced feature set compared to AWIPS CAVE (which is a full, desktop-only Java application.) The goal of WarnGen is to provide a tool that can be used by anyone, regardless of their technical expertise, to create and edit AWIPS/VTEC products. WarnGen is built using JavaScript and runs in the browser, making it accessible on a wide range of devices without the need for installation. It includes features such as a map interface for selecting affected areas, a form-based interface for entering product details, and the ability to export products in the standard .kml/.txt format. WarnGen is intended to be a user-friendly tool that can be used by both experienced meteorologists and those new to AWIPS/VTEC product creation. It even uses the same template system as AWIPS CAVE, so users familiar with CAVE will find the interface and workflow familiar. WarnGen is a great option for those who need to create AWIPS/VTEC products but do not have access to the full AWIPS CAVE application or prefer a simpler, more streamlined tool for product creation. NOTE: "Long-fused" products (such as Blizzard Warnings, Severe Thunderstorm/Tornado Watches, etc.) are not currently supported in this version of WarnGen! For now, WarnGen is focused on "short-fused" products (such as Tornado Warnings, Flash Flood Warnings, etc.) that are typically issued with a shorter lead time and require more frequent updates. If demand is high enough, long-fused products may be added in a future update (or made into a separate tool due to the templates/workflow being completely different), but for now, WarnGen is able to provide both CRS and BMH-based products for short-fused events, which are the most commonly used product types in AWIPS/VTEC. If you notice any anachronisms in the product templates (such as outdated office names, etc.) please let me know so I can update them! The templates are based on the most recent versions available in AWIPS CAVE, but there may be some discrepancies due to changes in AWIPS CAVE over time or differences between the template versions used by different offices. If you have any suggestions for improvements or new features, please let me know!
- Updated README to cover WarnGen and provide basic instructions for use.
- Updated FAQ to cover WarnGen and provide answers to common questions about the tool.

---

2026-04-24:

- Introduced CHANGES.md to track changes and updates to the project.
- Updated same-us.json with City of St. Louis, MO (Reordered to make it easier to find the city in the list).
- Updated demos/voice list to match current TTS system status (change 1/2). Change 2/2 will immediately follow this one.
- The aforementioned change 2/2 (add back ScanSoft Tom).
