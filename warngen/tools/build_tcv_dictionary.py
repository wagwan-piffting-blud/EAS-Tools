#!/usr/bin/env python3
"""
Build warngen/data/tcv_dictionary.json from AWIPS GFE's TCVDictionary.py (threat statements,
potential impact statements, evacuation/preparedness lines) plus the threat phrases and impact
levels Hazard_TCV.py hard-codes.

    python warngen/tools/build_tcv_dictionary.py [path/to/TCVDictionary.py]

Without an argument the file is fetched from Unidata/awips2 (unidata_23.4.3).
"""

import json
import os
import sys
import urllib.request

SRC = ("https://raw.githubusercontent.com/Unidata/awips2/unidata_23.4.3/cave/com.raytheon.viz.gfe/"
       "localization/gfe/userPython/utilities/TCVDictionary.py")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "tcv_dictionary.json")

# Hazard_TCV.Definition["threatPhrase"]
THREAT_PHRASE = {
    "Wind": {
        "Extreme": "Potential for wind greater than 110 mph",
        "High": "Potential for wind 74 to 110 mph",
        "Mod": "Potential for wind 58 to 73 mph",
        "Elevated": "Potential for wind 39 to 57 mph",
        "None": "Wind less than 39 mph",
    },
    "Storm Surge": {
        "Extreme": "Potential for storm surge flooding greater than 9 feet above ground",
        "High": "Potential for storm surge flooding greater than 6 feet above ground",
        "Mod": "Potential for storm surge flooding greater than 3 feet above ground",
        "Elevated": "Potential for storm surge flooding greater than 1 foot above ground",
        "None": "Little to no storm surge flooding",
    },
    "Flooding Rain": {
        "Extreme": "Potential for extreme flooding rain",
        "High": "Potential for major flooding rain",
        "Mod": "Potential for moderate flooding rain",
        "Elevated": "Potential for localized flooding rain",
        "None": "Little or no potential for flooding rain",
    },
    "Tornado": {
        "Extreme": "Potential for an outbreak of tornadoes",
        "High": "Potential for many tornadoes",
        "Mod": "Potential for several tornadoes",
        "Elevated": "Potential for a few tornadoes",
        "None": "Tornadoes not expected",
    },
}

# SectionCommon._getPotentialImpactsSummaryText
IMPACT_LEVEL = {"Extreme": "Devastating to Catastrophic", "High": "Extensive", "Mod": "Significant",
                "Elevated": "Limited", "None": "Little to None"}


def main():
    if len(sys.argv) > 1:
        text = open(sys.argv[1], encoding="utf-8").read()
    else:
        req = urllib.request.Request(SRC, headers={"User-Agent": "eas.tools WarnGen build"})
        text = urllib.request.urlopen(req, timeout=60).read().decode("utf-8")
    ns = {}
    exec(text, ns)
    out = {
        "_source": "Unidata/awips2 TCVDictionary.py + Hazard_TCV.py threatPhrase",
        "threatStatements": ns["ThreatStatements"],
        "potentialImpactStatements": ns["PotentialImpactStatements"],
        "evacuationStatements": ns["EvacuationStatements"],
        "otherPreparednessActions": ns["OtherPreparednessActions"],
        "additionalSources": ns["AdditionalSources"],
        "threatPhrase": THREAT_PHRASE,
        "impactLevel": IMPACT_LEVEL,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
    print("sections:", list(ns["ThreatStatements"]), "->", os.path.abspath(OUT))
    wind = ns["ThreatStatements"]["Wind"]
    print("wind levels:", list(wind), "timing keys:", list(next(iter(wind.values()))))


if __name__ == "__main__":
    main()
