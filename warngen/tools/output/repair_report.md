# Geojson partOfParentRegion repair from AWIPS FE_AREA

Run: 2026-05-18T01:53:42.965Z
Source: c_16ap26.dbf (3352 rows)
Geojson: 3231 features

- changed: **1571**
- unchanged: 1658
- not found in shapefile: 2
- unknown FE_AREA code: 0

## Counties in geojson but not in shapefile (2)
- 02261 Valdez-Cordova AK
- 15005 Kalawao HI

## Changes by (state, before → after) — top 50 groups

- **TX :: [EAST,CENTRAL] → [SOUTH,EAST]** — 23× (Walker (48471), San Jacinto (48407), Madison (48313), Orange (48361), Chambers (48071), …)
- **TX :: [CENTRAL] → [WEST,CENTRAL]** — 22× (Shackelford (48417), Tom Green (48451), Taylor (48441), Irion (48235), Runnels (48399), …)
- **TX :: [NORTH,CENTRAL] → [PA]** — 20× (Armstrong (48011), Hutchinson (48233), Childress (48075), Hansford (48195), Potter (48375), …)
- **MI :: [EAST,CENTRAL] → [NORTH]** — 18× (Ogemaw (26129), Crawford (26039), Montmorency (26119), Gladwin (26051), Oscoda (26135), …)
- **GA :: [NORTH,WEST] → [NORTH,CENTRAL]** — 17× (Douglas (13097), Fannin (13111), DeKalb (13089), Rockdale (13247), Cherokee (13057), …)
- **TN :: [NORTH,EAST] → [EA]** — 16× (Scott (47151), Washington (47179), Hancock (47067), Johnson (47091), Grainger (47057), …)
- **TX :: [NORTH,EAST] → [NORTH,CENTRAL]** — 15× (Wise (48497), Hunt (48231), Collin (48085), Cooke (48097), Hopkins (48223), …)
- **TX :: [SOUTH,EAST] → [SOUTH,CENTRAL]** — 15× (Goliad (48175), Wilson (48493), Lavaca (48285), Aransas (48007), Gonzales (48177), …)
- **GA :: [NORTH,CENTRAL] → [NORTH,EAST]** — 14× (Clarke (13059), Madison (13195), White (13311), Hart (13147), Franklin (13119), …)
- **TX :: [EAST,CENTRAL] → [CENTRAL]** — 14× (Falls (48145), Hamilton (48193), Limestone (48293), Coryell (48099), Bell (48027), …)
- **TN :: [NORTH,CENTRAL] → [MI]** — 14× (Trousdale (47169), Smith (47159), Sumner (47165), Clay (47027), Fentress (47049), …)
- **KY :: [SOUTH,WEST] → [WEST]** — 13× (Graves (21083), Livingston (21139), McCracken (21145), Trigg (21221), Crittenden (21055), …)
- **TX :: [NORTH,CENTRAL] → [NORTH,WEST]** — 12× (Cottle (48101), Dickens (48125), Hale (48189), King (48269), Motley (48345), …)
- **NY :: [WEST,CENTRAL] → [WEST]** — 12× (Orleans (36073), Wayne (36117), Allegany (36003), Monroe (36055), Livingston (36051), …)
- **TX :: [CENTRAL] → [SOUTH,CENTRAL]** — 11× (Gillespie (48171), Kerr (48265), Blanco (48031), Llano (48299), Comal (48091), …)
- **NC :: [NORTH,CENTRAL] → [CENTRAL]** — 11× (Randolph (37151), Orange (37135), Guilford (37081), Person (37145), Forsyth (37067), …)
- **VA :: [NORTH,EAST] → [NORTH]** — 11× (Falls Church (51610), Loudoun (51107), Manassas Park (51685), Arlington (51013), Culpeper (51047), …)
- **TX :: [CENTRAL] → [WEST]** — 10× (Mitchell (48335), Martin (48317), Upton (48461), Midland (48329), Glasscock (48173), …)
- **TN :: [WEST,CENTRAL] → [WE]** — 10× (Gibson (47053), Benton (47005), Madison (47113), Crockett (47033), Henderson (47077), …)
- **MO :: [NORTH,CENTRAL] → [NORTH,EAST]** — 10× (Scotland (29199), Shelby (29205), Adair (29001), Marion (29127), Ralls (29173), …)
- **FL :: [NORTH,CENTRAL] → [BB]** — 10× (Dixie (12029), Lafayette (12067), Madison (12079), Franklin (12037), Gadsden (12039), …)
- **GA :: [EAST,CENTRAL] → [SOUTH,EAST]** — 10× (Evans (13109), Bryan (13029), Effingham (13103), Toombs (13279), Bulloch (13031), …)
- **NC :: [EAST,CENTRAL] → [EAST]** — 10× (Lenoir (37107), Craven (37049), Pitt (37147), Jones (37103), Greene (37079), …)
- **NC :: [WEST,CENTRAL] → [WEST]** — 10× (Transylvania (37175), Polk (37149), Haywood (37087), Rutherford (37161), Swain (37173), …)
- **AR :: [NORTH,EAST] → [EAST]** — 9× (Cross (05037), Poinsett (05111), Mississippi (05093), Jackson (05067), Lawrence (05075), …)
- **MI :: [SOUTH,CENTRAL] → [SOUTH,WEST]** — 9× (Kalamazoo (26077), Barry (26015), St. Joseph (26149), Ottawa (26139), Cass (26027), …)
- **TX :: [WEST,CENTRAL] → [WEST]** — 9× (Gaines (48165), Andrews (48003), Winkler (48495), Crane (48103), Ward (48475), …)
- **MS :: [NORTH,CENTRAL] → [NORTH,WEST]** — 9× (Quitman (28119), Lafayette (28071), DeSoto (28033), Marshall (28093), Tunica (28143), …)
- **TN :: [CENTRAL] → [MI]** — 9× (Maury (47119), Warren (47177), DeKalb (47041), White (47185), Williamson (47187), …)
- **CA :: [WEST,CENTRAL] → [NORTH]** — 9× (Contra Costa (06013), Sonoma (06097), San Francisco (06075), Marin (06041), Santa Clara (06085), …)
- **WI :: [EAST,CENTRAL] → [NORTH,EAST]** — 8× (Marinette (55075), Menominee (55078), Outagamie (55087), Kewaunee (55061), Door (55029), …)
- **UT :: [NORTH,CENTRAL] → [NORTH]** — 8× (Summit (49043), Morgan (49029), Cache (49005), Davis (49011), Rich (49033), …)
- **OK :: [NORTH,CENTRAL] → [NORTH,WEST]** — 8× (Blaine (40011), Alfalfa (40003), Woods (40151), Woodward (40153), Ellis (40045), …)
- **MN :: [SOUTH,CENTRAL] → [EAST,CENTRAL]** — 8× (Carver (27019), Washington (27163), Chisago (27025), Ramsey (27123), Scott (27139), …)
- **SC :: [NORTH,WEST] → [UP]** — 8× (Greenville (45045), Anderson (45007), Greenwood (45047), Pickens (45077), Abbeville (45001), …)
- **TN :: [SOUTH,CENTRAL] → [MI]** — 8× (Giles (47055), Coffee (47031), Franklin (47051), Grundy (47061), Moore (47127), …)
- **TX :: [NORTH,CENTRAL] → [NORTH]** — 8× (Baylor (48023), Knox (48275), Clay (48077), Foard (48155), Wilbarger (48487), …)
- **TX :: [EAST,CENTRAL] → [NORTH,CENTRAL]** — 8× (Van Zandt (48467), Hood (48221), Ellis (48139), Kaufman (48257), Dallas (48113), …)
- **WV :: [NORTH,CENTRAL] → [NORTH]** — 8× (Wetzel (54103), Marshall (54051), Brooke (54009), Tyler (54095), Marion (54049), …)
- **LA :: [NORTH,CENTRAL] → [NORTH,EAST]** — 8× (East Carroll (22035), Richland (22083), Tensas (22107), Madison (22065), Morehouse (22067), …)
- **TX :: [EAST,CENTRAL] → [SOUTH,CENTRAL]** — 8× (Williamson (48491), Fayette (48149), Caldwell (48055), Travis (48453), Bastrop (48021), …)
- **CA :: [WEST,CENTRAL] → [CENTRAL]** — 7× (San Benito (06069), Monterey (06053), Stanislaus (06099), San Joaquin (06077), Sacramento (06067), …)
- **ID :: [NORTH,WEST] → [PA]** — 7× (Benewah (16009), Boundary (16021), Shoshone (16079), Kootenai (16055), Bonner (16017), …)
- **MO :: [SOUTH,CENTRAL] → [SOUTH,WEST]** — 7× (Webster (29225), Christian (29043), Douglas (29067), Wright (29229), Greene (29077), …)
- **NC :: [NORTH,EAST] → [CENTRAL]** — 7× (Franklin (37069), Vance (37181), Edgecombe (37065), Halifax (37083), Warren (37185), …)
- **TX :: [EAST,CENTRAL] → [NORTH,EAST]** — 7× (Panola (48365), Gregg (48183), Upshur (48459), Smith (48423), Rusk (48401), …)
- **TN :: [SOUTH,WEST] → [WE]** — 7× (Chester (47023), Shelby (47157), Tipton (47167), McNairy (47109), Hardeman (47069), …)
- **KY :: [EAST,CENTRAL] → [SOUTH,EAST]** — 7× (Lee (21129), Magoffin (21153), Pike (21195), Wolfe (21237), Floyd (21071), …)
- **VA :: [EAST,CENTRAL] → [CENTRAL]** — 7× (King George (51099), Louisa (51109), Goochland (51075), Orange (51137), Hanover (51085), …)
- **MO :: [NORTH,WEST] → [NORTH,CENTRAL]** — 7× (Livingston (29117), Daviess (29061), Caldwell (29025), Carroll (29033), Harrison (29081), …)
