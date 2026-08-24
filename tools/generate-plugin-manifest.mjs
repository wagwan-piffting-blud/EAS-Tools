// Regenerates assets/audacity_plugins/manifest.json from the DLLs on disk, the way
// generate-macro-manifest.mjs does for macros: existing entries keep their order and their
// hand-set norms, missing files drop out, new files are appended sorted.
//
// Each entry is {file, norm, kind}. `norm` is what audacity-macro-engine.js matches a macro
// command against (lowercased, non-alphanumerics stripped); `kind` comes from the DLL's export
// table - ladspa_descriptor means the LADSPA host, VSTPluginMain/main means the VST host.
//
//   node tools/generate-plugin-manifest.mjs             write the manifest
//   node tools/generate-plugin-manifest.mjs --check     exit 1 if it is out of date, write nothing
//   node tools/generate-plugin-manifest.mjs --verbose   list every resolved entry
//   node tools/generate-plugin-manifest.mjs --strict    treat warnings as failures
//
// Warnings cover things worth knowing but not worth blocking on: two files claiming one norm
// (the engine resolves the first, so the rest are dead), MSVC Debug builds, and x64 binaries
// the 32-bit emulator cannot run.
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pluginDir = join(here, '..', 'assets', 'audacity_plugins');
const manifestPath = join(pluginDir, 'manifest.json');

const args = new Set(process.argv.slice(2));
const checkOnly = args.has('--check');
const verbose = args.has('--verbose');
const strict = args.has('--strict');
const annotate = args.has('--annotate') || !!process.env.GITHUB_ACTIONS;

const RTC_POISON = Buffer.from([0xb8, 0xcc, 0xcc, 0xcc, 0xcc, 0xf3, 0xab]);
const LFS_POINTER = 'version https://git-lfs';

// Norms that cannot be derived from the filename. Macros call LADSPA plugins by their Audacity
// effect name, not their .dll name, so those are pinned here rather than guessed.
const NORM_OVERRIDES = {
    'sc4_1882.dll': 'sc4',
    'chebstortion_1430.dll': 'chebyshevdistortion',
};

// Extra norms that resolve to a file whose own norm is different - the macro command spelling.
// These outlive the file they used to point at, so they live here instead of being inherited
// from the previous manifest.
const ALIASES = [
    { norm: 'talkbox', file: 'mdaTalkBox.dll' },
];

function norm(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function readU16(buf, off) { return buf.readUInt16LE(off); }
function readU32(buf, off) { return buf.readUInt32LE(off); }

function parsePe(buf) {
    if (buf.length < 0x40 || buf.readUInt16LE(0) !== 0x5a4d) return { error: 'not a PE image' };
    const peOff = readU32(buf, 0x3c);
    if (peOff + 24 > buf.length || readU32(buf, peOff) !== 0x00004550) return { error: 'bad PE signature' };

    const coff = peOff + 4;
    const machine = readU16(buf, coff);
    const numSections = readU16(buf, coff + 2);
    const sizeOfOptional = readU16(buf, coff + 16);
    const opt = coff + 20;
    const magic = readU16(buf, opt);
    const pe32Plus = magic === 0x20b;
    const dirOff = opt + (pe32Plus ? 112 : 96);
    const numDirs = readU32(buf, opt + (pe32Plus ? 108 : 92));

    const sections = [];
    const secOff = opt + sizeOfOptional;
    for (let i = 0; i < numSections; i++) {
        const s = secOff + i * 40;
        if (s + 40 > buf.length) break;
        sections.push({
            name: buf.slice(s, s + 8).toString('latin1').replace(/\0+$/, ''),
            virtualSize: readU32(buf, s + 8),
            virtualAddress: readU32(buf, s + 12),
            rawSize: readU32(buf, s + 16),
            rawOffset: readU32(buf, s + 20),
        });
    }

    const rvaToOffset = (rva) => {
        for (const s of sections) {
            const size = Math.max(s.virtualSize, s.rawSize);
            if (rva >= s.virtualAddress && rva < s.virtualAddress + size) {
                return s.rawOffset + (rva - s.virtualAddress);
            }
        }
        return -1;
    };

    const dir = (index) => {
        if (index >= numDirs) return { rva: 0, size: 0 };
        const d = dirOff + index * 8;
        if (d + 8 > buf.length) return { rva: 0, size: 0 };
        return { rva: readU32(buf, d), size: readU32(buf, d + 4) };
    };

    const exports = [];
    const exp = dir(0);
    if (exp.rva) {
        const eo = rvaToOffset(exp.rva);
        if (eo >= 0 && eo + 40 <= buf.length) {
            const numNames = readU32(buf, eo + 24);
            const namesRva = readU32(buf, eo + 32);
            const namesOff = rvaToOffset(namesRva);
            if (namesOff >= 0) {
                for (let i = 0; i < numNames && i < 4096; i++) {
                    const p = namesOff + i * 4;
                    if (p + 4 > buf.length) break;
                    const strOff = rvaToOffset(readU32(buf, p));
                    if (strOff < 0 || strOff >= buf.length) continue;
                    const end = buf.indexOf(0, strOff);
                    exports.push(buf.slice(strOff, end < 0 ? buf.length : end).toString('latin1'));
                }
            }
        }
    }

    let pdb = '';
    const dbg = dir(6);
    if (dbg.rva) {
        const base = rvaToOffset(dbg.rva);
        if (base >= 0) {
            for (let i = 0; i * 28 < dbg.size; i++) {
                const e = base + i * 28;
                if (e + 28 > buf.length) break;
                if (readU32(buf, e + 12) !== 2) continue;      // IMAGE_DEBUG_TYPE_CODEVIEW
                const cv = readU32(buf, e + 24);               // PointerToRawData
                if (cv + 24 > buf.length) continue;
                if (buf.slice(cv, cv + 4).toString('latin1') !== 'RSDS') continue;
                const end = buf.indexOf(0, cv + 24);
                pdb = buf.slice(cv + 24, end < 0 ? buf.length : end).toString('latin1');
                break;
            }
        }
    }

    const text = sections.find((s) => s.name === '.text' || s.name === 'CODE');
    let poison = 0;
    if (text && text.rawSize) {
        const slice = buf.slice(text.rawOffset, text.rawOffset + text.rawSize);
        let at = slice.indexOf(RTC_POISON);
        while (at !== -1) {
            poison++;
            at = slice.indexOf(RTC_POISON, at + 1);
        }
    }

    return {
        machine: machine === 0x8664 ? 'x64' : machine === 0x14c ? 'x86' : '0x' + machine.toString(16),
        exports,
        pdb,
        rtcPoison: poison,
    };
}

function inspect(file) {
    const buf = readFileSync(join(pluginDir, file));
    if (buf.slice(0, LFS_POINTER.length).toString('latin1') === LFS_POINTER) {
        return { file, error: 'Git LFS pointer, not a real DLL (run `git lfs pull`)' };
    }
    const pe = parsePe(buf);
    if (pe.error) return { file, error: pe.error };

    const has = (name) => pe.exports.includes(name);
    const kind = has('ladspa_descriptor') ? 'ladspa'
        : has('vampGetPluginDescriptor') ? 'vamp'
            : (has('VSTPluginMain') || has('main')) ? 'vst'
                : '';

    const warnings = [];
    if (!kind) warnings.push('no VST/LADSPA entry point (exports: ' + (pe.exports.slice(0, 3).join(', ') || 'none') + ')');
    if (pe.machine !== 'x86') warnings.push(pe.machine + ' binary; the emulator runs 32-bit guests only');
    if (/[\\/][Dd]ebug[\\/]/.test(pe.pdb)) warnings.push('MSVC Debug build (pdb: ' + pe.pdb + ')');
    else if (pe.rtcPoison >= 10) warnings.push('/RTC1 frame poison x' + pe.rtcPoison + ' - looks like a Debug build');

    return { file, kind, machine: pe.machine, warnings };
}

const files = readdirSync(pluginDir, { withFileTypes: true })
    .filter((d) => d.isFile() && /\.dll$/i.test(d.name))
    .map((d) => d.name);

let existing = [];
if (existsSync(manifestPath)) {
    try {
        const parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
        if (Array.isArray(parsed)) existing = parsed;
    } catch {
        existing = [];
    }
}

const present = new Set(files);
const kept = existing.filter((e) => e && typeof e.file === 'string' && present.has(e.file));
const dropped = existing.filter((e) => !kept.includes(e));
const covered = new Set(kept.map((e) => e.file));
const added = files.filter((f) => !covered.has(f)).sort((a, b) => a.localeCompare(b));

const problems = [];
const notes = [];
const inspected = new Map();

for (const file of files) {
    const info = inspect(file);
    inspected.set(file, info);
    if (info.error) problems.push(`${file}: ${info.error}`);
    for (const w of info.warnings || []) notes.push(`${file}: ${w}`);
}

const entries = kept.map((e) => {
    const info = inspected.get(e.file);
    const kind = info && info.kind ? info.kind : e.kind;
    if (info && info.kind && e.kind && info.kind !== e.kind) {
        notes.push(`${e.file}: kind changed ${e.kind} -> ${info.kind}`);
    }
    return { file: e.file, norm: e.norm, kind };
});

for (const file of added) {
    const info = inspected.get(file);
    if (info.error) continue;
    const derived = NORM_OVERRIDES[file] || norm(basename(file, '.dll'));
    entries.push({ file, norm: derived, kind: info.kind || 'vst' });
    if (!NORM_OVERRIDES[file] && (info.kind === 'ladspa' || info.kind === 'vamp')) {
        notes.push(`${file}: ${info.kind} plugin added with norm "${derived}" - macros call these by their Audacity effect name, so add a NORM_OVERRIDES entry if it differs`);
    }
}

for (const alias of ALIASES) {
    if (!present.has(alias.file)) {
        problems.push(`alias norm "${alias.norm}" points at ${alias.file}, which is not in the plugin folder`);
        continue;
    }
    if (entries.some((e) => e.norm === alias.norm && e.file === alias.file)) continue;
    const target = entries.find((e) => e.file === alias.file);
    const at = target ? entries.indexOf(target) + 1 : entries.length;
    entries.splice(at, 0, { file: alias.file, norm: alias.norm, kind: (target && target.kind) || 'vst' });
}

const byNorm = new Map();
for (const e of entries) {
    const list = byNorm.get(e.norm) || [];
    list.push(e.file);
    byNorm.set(e.norm, list);
}
for (const [n, list] of byNorm) {
    const unique = [...new Set(list)];
    if (unique.length > 1) {
        const [winner, ...shadowed] = unique;
        notes.push(`norm "${n}" maps to ${unique.length} files - macros calling it get "${winner}"; ${shadowed.join(', ')} ${shadowed.length > 1 ? 'are' : 'is'} unreachable`);
    }
}

const serialized = JSON.stringify(entries);
const current = existsSync(manifestPath) ? readFileSync(manifestPath, 'utf8') : '';
const drift = serialized !== current;

for (const n of notes) console.log(annotate ? `::warning::${n}` : `  note: ${n}`);
for (const p of problems) console.error(annotate ? `::error::${p}` : `  ERROR: ${p}`);

if (verbose) {
    for (const e of entries) console.log(`  ${e.file} -> norm=${e.norm} kind=${e.kind}`);
}

if (problems.length) {
    console.error(`\n${problems.length} problem(s); manifest not written.`);
    process.exit(1);
}

if (strict && notes.length) {
    console.error(`\n--strict: ${notes.length} warning(s) treated as failures.`);
    process.exit(1);
}

if (checkOnly) {
    if (drift) {
        console.error(`\n${manifestPath} is out of date. Run: node tools/generate-plugin-manifest.mjs`);
        process.exit(1);
    }
    console.log(`Manifest is up to date (${entries.length} entries, ${present.size} DLLs).`);
    process.exit(0);
}

if (drift) writeFileSync(manifestPath, serialized);

const aliases = entries.length - new Set(entries.map((e) => e.file)).size;
console.log(`${drift ? 'Wrote' : 'Unchanged:'} ${entries.length} entries for ${present.size} DLLs in ${manifestPath}`);
console.log(`  ${added.length} added, ${dropped.length} removed, ${kept.length} kept in order, ${aliases} alias norm(s)`);
if (dropped.length) console.log(`  removed: ${dropped.map((e) => e.file + ' (' + e.norm + ')').join(', ')}`);
