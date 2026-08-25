import fs from 'node:fs';

const cities = JSON.parse(fs.readFileSync('D:/laragon/www/eas-tools/warngen/data/us_cities.json', 'utf8'));
const arr = Array.isArray(cities) ? cities : (cities.cities || Object.values(cities)[0]);

// True WGS84 coordinates for well-known places, to pair against the inset ones in us_cities.json.
const TRUE = {
    AK: {
        Anchorage: [61.2181, -149.9003], Fairbanks: [64.8378, -147.7164],
        Juneau: [58.3019, -134.4197], Nome: [64.5011, -165.4064],
        Ketchikan: [55.3422, -131.6461], Bethel: [60.7922, -161.7558],
        Kodiak: [57.7900, -152.4072], Sitka: [57.0531, -135.3300],
        Kenai: [60.5544, -151.2583], Palmer: [61.5994, -149.1145],
        Wasilla: [61.5814, -149.4394], Homer: [59.6425, -151.5483],
        Valdez: [61.1308, -146.3483], Cordova: [60.5425, -145.7575],
        Dillingham: [59.0397, -158.4575], Unalaska: [53.8743, -166.5372]
    },
    HI: {
        Honolulu: [21.3069, -157.8583], Hilo: [19.7297, -155.0900],
        Kailua: [21.4022, -157.7394], Kaneohe: [21.4181, -157.8036],
        Waipahu: [21.3866, -158.0092], Kahului: [20.8893, -156.4729],
        Kihei: [20.7644, -156.4450], Wailuku: [20.8836, -156.5047]
    },
    PR: {
        'San Juan': [18.4655, -66.1057], Bayamon: [18.3985, -66.1614],
        Ponce: [18.0111, -66.6141], Carolina: [18.3808, -65.9574],
        Caguas: [18.2341, -66.0485], Mayaguez: [18.2013, -67.1397],
        Arecibo: [18.4725, -66.7156], Guaynabo: [18.3569, -66.1110]
    }
};

/** Least-squares fit of true -> inset as lat' = a*lat + b, lon' = c*lon + d (per axis). */
function fitAxis(pairs) {
    const n = pairs.length;
    const sx = pairs.reduce((s, p) => s + p[0], 0);
    const sy = pairs.reduce((s, p) => s + p[1], 0);
    const sxx = pairs.reduce((s, p) => s + p[0] * p[0], 0);
    const sxy = pairs.reduce((s, p) => s + p[0] * p[1], 0);
    const denom = n * sxx - sx * sx;
    const a = (n * sxy - sx * sy) / denom;
    const b = (sy - a * sx) / n;
    return [a, b];
}

for (const state of Object.keys(TRUE)) {
    const latPairs = [];
    const lonPairs = [];
    const used = [];
    for (const [name, [tLat, tLon]] of Object.entries(TRUE[state])) {
        const c = arr.find(x => x.state === state && x.name.toLowerCase() === name.toLowerCase());
        if (!c) continue;
        latPairs.push([tLat, c.lat]);
        lonPairs.push([tLon, c.lon]);
        used.push(name);
    }
    if (latPairs.length < 3) {
        console.log(state + ': only ' + latPairs.length + ' anchors, skipping');
        continue;
    }
    const [a, b] = fitAxis(latPairs);
    const [c, d] = fitAxis(lonPairs);

    let maxLat = 0;
    let maxLon = 0;
    latPairs.forEach((p, i) => {
        maxLat = Math.max(maxLat, Math.abs(a * p[0] + b - p[1]));
        maxLon = Math.max(maxLon, Math.abs(c * lonPairs[i][0] + d - lonPairs[i][1]));
    });

    console.log(state + '  anchors=' + latPairs.length);
    console.log('   lat\' = ' + a.toFixed(6) + ' * lat + ' + b.toFixed(6));
    console.log('   lon\' = ' + c.toFixed(6) + ' * lon + ' + d.toFixed(6));
    console.log('   max residual: lat ' + maxLat.toFixed(4) + '  lon ' + maxLon.toFixed(4));
    console.log('   used: ' + used.join(', '));
    console.log();
}
