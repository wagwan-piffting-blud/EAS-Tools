(function (root) {
    const JIT_OK = 0, JIT_DEOPT = 1, JIT_FAULT = 2;
    const EAX = 0, ECX = 1, ESP = 4, ESI = 6, EDI = 7;

    function decodeString(op2, rep) {
        switch (op2) {
            case 0xA4: return { kind: 'str', strop: 'movs', sz: 1, rep, len: 1 };
            case 0xA5: return { kind: 'str', strop: 'movs', sz: 4, rep, len: 1 };
            case 0xAA: return { kind: 'str', strop: 'stos', sz: 1, rep, len: 1 };
            case 0xAB: return { kind: 'str', strop: 'stos', sz: 4, rep, len: 1 };
        }
        return null;
    }

    const IS_PREFIX = (function () {
        const a = new Uint8Array(256);
        [0x66, 0x67, 0xF0, 0xF2, 0xF3, 0x2E, 0x36, 0x3E, 0x26, 0x64, 0x65].forEach(x => a[x] = 1);
        return a;
    })();

    const ALU2 = {
        0x01: ['add', 'rm_r'], 0x03: ['add', 'r_rm'], 0x05: ['add', 'eax_imm'],
        0x09: ['or', 'rm_r'], 0x0B: ['or', 'r_rm'], 0x0D: ['or', 'eax_imm'],
        0x21: ['and', 'rm_r'], 0x23: ['and', 'r_rm'], 0x25: ['and', 'eax_imm'],
        0x29: ['sub', 'rm_r'], 0x2B: ['sub', 'r_rm'], 0x2D: ['sub', 'eax_imm'],
        0x31: ['xor', 'rm_r'], 0x33: ['xor', 'r_rm'], 0x35: ['xor', 'eax_imm'],
        0x39: ['cmp', 'rm_r'], 0x3B: ['cmp', 'r_rm'], 0x3D: ['cmp', 'eax_imm'],
    };
    const GRP1 = ['add', 'or', 'adc', 'sbb', 'and', 'sub', 'xor', 'cmp'];

    function makeReader(M, pagemapBase) {
        const pmW = pagemapBase >>> 2;
        return function (a) {
            a >>>= 0;
            const H32 = M.HEAPU32, H8 = M.HEAPU8;
            const pb = H32[pmW + (a >>> 12)];
            return pb ? H8[(pb + (a & 0xfff)) >>> 0] : 0;
        };
    }
    function rd8s(rd, a) { const b = rd(a); return b < 128 ? b : b - 256; }
    function rd32s(rd, a) { return (rd(a) | (rd(a + 1) << 8) | (rd(a + 2) << 16) | (rd(a + 3) << 24)); }

    function decodeModrm(rd, eip, p) {
        let i = p;
        const b = rd(eip + i); i++;
        const mod = b >> 6, reg = (b >> 3) & 7, rm = b & 7;
        if (mod === 3) return { mod, reg, rm, isMem: false, len: i - p };
        let base = -1, index = -1, scale = 0, disp = 0;
        if (rm === 4) {
            const sib = rd(eip + i); i++;
            scale = sib >> 6; const idx = (sib >> 3) & 7, bas = sib & 7;
            index = (idx === 4) ? -1 : idx;
            if (bas === 5 && mod === 0) { disp = rd32s(rd, eip + i); i += 4; base = -1; }
            else base = bas;
        } else if (rm === 5 && mod === 0) { disp = rd32s(rd, eip + i); i += 4; }
        else base = rm;
        if (mod === 1) { disp = (disp + rd8s(rd, eip + i)) | 0; i++; }
        else if (mod === 2) { disp = (disp + rd32s(rd, eip + i)) | 0; i += 4; }
        return { mod, reg, rm, isMem: true, base, index, scale, disp, len: i - p };
    }

    function locRM(m) { return m.isMem ? { t: 'mem' } : { t: 'reg', i: m.rm }; }

    const FCONST = { 0xE8: 1.0, 0xE9: 3.321928094887362, 0xEA: 1.442695040888963, 0xEB: 3.141592653589793, 0xEC: 0.301029995663981, 0xED: 0.693147180559945, 0xEE: 0.0 };

    function decodeX87(rd, eip, op) {
        const m = decodeModrm(rd, eip, 1);
        const len = 1 + m.len;
        const reg = m.reg, rm = m.rm;
        if (m.isMem) {
            switch (op) {
                case 0xD9:
                    if (reg === 0) return { kind: 'x87', sub: 'fld_m', width: 32, m, len };
                    if (reg === 2) return { kind: 'x87', sub: 'fst_m', width: 32, m, len };
                    if (reg === 3) return { kind: 'x87', sub: 'fstp_m', width: 32, m, len };
                    if (reg === 5) return { kind: 'x87', sub: 'fldcw', m, len };
                    if (reg === 7) return { kind: 'x87', sub: 'fnstcw', m, len };
                    return null;
                case 0xDD:
                    if (reg === 0) return { kind: 'x87', sub: 'fld_m', width: 64, m, len };
                    if (reg === 2) return { kind: 'x87', sub: 'fst_m', width: 64, m, len };
                    if (reg === 3) return { kind: 'x87', sub: 'fstp_m', width: 64, m, len };
                    if (reg === 7) return { kind: 'x87', sub: 'fnstsw_m', m, len };
                    return null;
                case 0xDB:
                    if (reg === 0) return { kind: 'x87', sub: 'fild_m', width: 32, m, len };
                    if (reg === 2) return { kind: 'x87', sub: 'fist_m', width: 32, pop: false, m, len };
                    if (reg === 3) return { kind: 'x87', sub: 'fist_m', width: 32, pop: true, m, len };
                    return null;
                case 0xDF:
                    if (reg === 0) return { kind: 'x87', sub: 'fild_m', width: 16, m, len };
                    if (reg === 2) return { kind: 'x87', sub: 'fist_m', width: 16, pop: false, m, len };
                    if (reg === 3) return { kind: 'x87', sub: 'fist_m', width: 16, pop: true, m, len };
                    return null;
                case 0xD8: case 0xDC: case 0xDA:
                    if (reg === 2 || reg === 3) {
                        if (op === 0xDA) return null;
                        return { kind: 'x87', sub: 'fcom_m', srcW: op === 0xD8 ? 'f32' : 'f64', pop: reg === 3, m, len };
                    }
                    return { kind: 'x87', sub: 'farith_m', aluReg: reg, srcW: op === 0xD8 ? 'f32' : op === 0xDC ? 'f64' : 'i32', m, len };
            }
            return null;
        }
        const full = (0xC0 | (reg << 3) | rm) & 0xff;
        switch (op) {
            case 0xD8: if (reg === 2 || reg === 3) return { kind: 'x87', sub: 'fcom_st', i: rm, pop: reg === 3, len }; return { kind: 'x87', sub: 'farith_st', form: 'd8', aluReg: reg, i: rm, len };
            case 0xDC: if (reg === 2 || reg === 3) return { kind: 'x87', sub: 'fcom_st', i: rm, pop: false, len }; return { kind: 'x87', sub: 'farith_st', form: 'dc', aluReg: reg, i: rm, len };
            case 0xDE: if (full === 0xD9) return { kind: 'x87', sub: 'fcompp', len }; if (reg === 2 || reg === 3) return null; return { kind: 'x87', sub: 'farith_st', form: 'de', aluReg: reg, i: rm, len };
            case 0xDA: if (full === 0xE9) return { kind: 'x87', sub: 'fcompp', len }; return null;
            case 0xD9:
                if (reg === 0) return { kind: 'x87', sub: 'fld_st', i: rm, len };
                if (reg === 1) return { kind: 'x87', sub: 'fxch', i: rm, len };
                if (full === 0xE0) return { kind: 'x87', sub: 'fchs', len };
                if (full === 0xE1) return { kind: 'x87', sub: 'fabs', len };
                if (full === 0xFA) return { kind: 'x87', sub: 'fsqrt', len };
                if (full === 0xF0) return { kind: 'x87', sub: 'ftrans', op: 'f2xm1', len };
                if (full === 0xFC) return { kind: 'x87', sub: 'ftrans', op: 'frndint', len };
                if (full === 0xFE) return { kind: 'x87', sub: 'ftrans', op: 'fsin', len };
                if (full === 0xFF) return { kind: 'x87', sub: 'ftrans', op: 'fcos', len };
                if (full === 0xF2) return { kind: 'x87', sub: 'fptan', len };
                if (full === 0xF1) return { kind: 'x87', sub: 'fbinpop', op: 'fyl2x', len };
                if (full === 0xF3) return { kind: 'x87', sub: 'fbinpop', op: 'fpatan', len };
                if (full === 0xFD) return { kind: 'x87', sub: 'fscale', len };
                if (FCONST[full] !== undefined) return { kind: 'x87', sub: 'fconst', val: FCONST[full], len };
                return null;
            case 0xDD:
                if (reg === 2) return { kind: 'x87', sub: 'fst_st', i: rm, len };
                if (reg === 3) return { kind: 'x87', sub: 'fstp_st', i: rm, len };
                if (reg === 4) return { kind: 'x87', sub: 'fcom_st', i: rm, pop: false, len };
                if (reg === 5) return { kind: 'x87', sub: 'fcom_st', i: rm, pop: true, len };
                return null;
        }
        return null;
    }

    function decodeSSE(rd, eip, op2, p, mo) {
        const m = decodeModrm(rd, eip, mo);
        const len = mo + m.len;
        switch (op2) {
            case 0x10: return { kind: 'sse', sub: 'mov_ld', p, m, len };
            case 0x11: return { kind: 'sse', sub: 'mov_st', p, m, len };
            case 0x28: return { kind: 'sse', sub: 'mov128_ld', m, len };
            case 0x29: return { kind: 'sse', sub: 'mov128_st', m, len };
            case 0x2A: if (p === 2 || p === 3) return { kind: 'sse', sub: 'cvtsi2s', p, m, len }; return null;
            case 0x2E: case 0x2F: if (p === 0 || p === 1) return { kind: 'sse', sub: 'comis', p, m, len }; return null;
            case 0x51: case 0x52: case 0x53: case 0x58: case 0x59: case 0x5C: case 0x5D: case 0x5E: case 0x5F:
                if (p === 2 || p === 3) return { kind: 'sse', sub: 'arith', op2, p, m, len };
                return null;
            case 0x54: case 0x55: case 0x56: case 0x57: return { kind: 'sse', sub: 'logic', op2, m, len };
            case 0x5A: if (p === 2 || p === 3) return { kind: 'sse', sub: 'cvtss2sd', p, m, len }; return null;
        }
        return null;
    }

    function decodeInsn(rd, eip) {
        const op = rd(eip);
        if (op === 0xF3 || op === 0xF2) {
            const n = rd(eip + 1);
            if (n === 0x0F) return decodeSSE(rd, eip, rd(eip + 2), op === 0xF3 ? 2 : 3, 3);
            const s = decodeString(n, true); if (s) { s.len += 1; return s; } return null;
        }
        if (op === 0x66) { if (rd(eip + 1) === 0x0F) return decodeSSE(rd, eip, rd(eip + 2), 1, 3); return null; }
        if (IS_PREFIX[op]) return null;
        if (op >= 0xD8 && op <= 0xDF) return decodeX87(rd, eip, op);

        if (ALU2[op]) {
            const [aop, form] = ALU2[op];
            if (form === 'eax_imm') {
                return { kind: 'alu', op: aop, aLoc: { t: 'reg', i: EAX }, bLoc: { t: 'imm', v: rd32s(rd, eip + 1) }, writeBack: aop !== 'cmp', m: null, len: 5 };
            }
            const m = decodeModrm(rd, eip, 1);
            const wb = aop !== 'cmp';
            let aLoc, bLoc;
            if (form === 'rm_r') { aLoc = locRM(m); bLoc = { t: 'reg', i: m.reg }; }
            else { aLoc = { t: 'reg', i: m.reg }; bLoc = locRM(m); }
            return { kind: 'alu', op: aop, aLoc, bLoc, writeBack: wb, m, len: 1 + m.len };
        }
        if (op >= 0x40 && op <= 0x47) return { kind: 'alu', op: 'inc', aLoc: { t: 'reg', i: op - 0x40 }, bLoc: { t: 'one' }, writeBack: true, m: null, len: 1 };
        if (op >= 0x48 && op <= 0x4F) return { kind: 'alu', op: 'dec', aLoc: { t: 'reg', i: op - 0x48 }, bLoc: { t: 'one' }, writeBack: true, m: null, len: 1 };
        if (op >= 0xB8 && op <= 0xBF) return { kind: 'mov_r_imm', reg: op - 0xB8, imm: rd32s(rd, eip + 1), len: 5 };
        if (op >= 0xB0 && op <= 0xB7) return { kind: 'mov8_r_imm', reg: op - 0xB0, imm: rd(eip + 1), len: 2 };
        if (op >= 0x50 && op <= 0x57) { const reg = op - 0x50; if (reg === ESP) return null; return { kind: 'push_r', reg, len: 1 }; }
        if (op >= 0x58 && op <= 0x5F) { const reg = op - 0x58; if (reg === ESP) return null; return { kind: 'pop_r', reg, len: 1 }; }
        if (op >= 0x70 && op <= 0x7F) { const d = rd8s(rd, eip + 1); return { kind: 'jcc', cc: op - 0x70, target: (eip + 2 + d) >>> 0, fall: (eip + 2) >>> 0, terminates: true, len: 2 }; }

        switch (op) {
            case 0x90: case 0x9B: return { kind: 'nop', len: 1 };
            case 0x88: { const m = decodeModrm(rd, eip, 1); return { kind: 'mov8_rm_r', m, len: 1 + m.len }; }
            case 0x8A: { const m = decodeModrm(rd, eip, 1); return { kind: 'mov8_r_rm', m, len: 1 + m.len }; }
            case 0xC6: { const m = decodeModrm(rd, eip, 1); if (m.reg !== 0) return null; const imm = rd(eip + 1 + m.len); return { kind: 'mov8_rm_imm', m, imm, len: 1 + m.len + 1 }; }
            case 0x89: { const m = decodeModrm(rd, eip, 1); return { kind: 'mov_rm_r', m, len: 1 + m.len }; }
            case 0x8B: { const m = decodeModrm(rd, eip, 1); return { kind: 'mov_r_rm', m, len: 1 + m.len }; }
            case 0x8D: { const m = decodeModrm(rd, eip, 1); if (!m.isMem) return null; return { kind: 'lea', m, len: 1 + m.len }; }
            case 0x85: { const m = decodeModrm(rd, eip, 1); return { kind: 'alu', op: 'test', aLoc: (m.isMem ? { t: 'mem' } : { t: 'reg', i: m.rm }), bLoc: { t: 'reg', i: m.reg }, writeBack: false, m, len: 1 + m.len }; }
            case 0xA9: return { kind: 'alu', op: 'test', aLoc: { t: 'reg', i: EAX }, bLoc: { t: 'imm', v: rd32s(rd, eip + 1) }, writeBack: false, m: null, len: 5 };
            case 0x81: { const m = decodeModrm(rd, eip, 1); const aop = GRP1[m.reg]; if (aop === 'adc' || aop === 'sbb') return null; const imm = rd32s(rd, eip + 1 + m.len); return { kind: 'alu', op: aop, aLoc: locRM(m), bLoc: { t: 'imm', v: imm }, writeBack: aop !== 'cmp', m, len: 1 + m.len + 4 }; }
            case 0x83: { const m = decodeModrm(rd, eip, 1); const aop = GRP1[m.reg]; if (aop === 'adc' || aop === 'sbb') return null; const imm = rd8s(rd, eip + 1 + m.len); return { kind: 'alu', op: aop, aLoc: locRM(m), bLoc: { t: 'imm', v: imm }, writeBack: aop !== 'cmp', m, len: 1 + m.len + 1 }; }
            case 0xC7: { const m = decodeModrm(rd, eip, 1); if (m.reg !== 0) return null; const imm = rd32s(rd, eip + 1 + m.len); return { kind: 'mov_rm_imm', m, imm, len: 1 + m.len + 4 }; }
            case 0xF7: { const m = decodeModrm(rd, eip, 1); const r = m.reg; if (r === 0 || r === 1) { const imm = rd32s(rd, eip + 1 + m.len); return { kind: 'alu', op: 'test', aLoc: locRM(m), bLoc: { t: 'imm', v: imm }, writeBack: false, m, len: 1 + m.len + 4 }; } if (r === 2) return { kind: 'alu', op: 'not', m, len: 1 + m.len }; if (r === 3) return { kind: 'alu', op: 'neg', m, len: 1 + m.len }; return null; }
            case 0xFF: { const m = decodeModrm(rd, eip, 1); if (m.reg === 0) return { kind: 'alu', op: 'inc', aLoc: locRM(m), bLoc: { t: 'one' }, writeBack: true, m, len: 1 + m.len }; if (m.reg === 1) return { kind: 'alu', op: 'dec', aLoc: locRM(m), bLoc: { t: 'one' }, writeBack: true, m, len: 1 + m.len }; return null; }
            case 0x68: return { kind: 'push_imm', imm: rd32s(rd, eip + 1), len: 5 };
            case 0x6A: return { kind: 'push_imm', imm: rd8s(rd, eip + 1), len: 2 };
            case 0xA4: case 0xA5: case 0xAA: case 0xAB: return decodeString(op, false);
            case 0xEB: { const d = rd8s(rd, eip + 1); return { kind: 'jmp', target: (eip + 2 + d) >>> 0, terminates: true, len: 2 }; }
            case 0xE9: { const d = rd32s(rd, eip + 1); return { kind: 'jmp', target: (eip + 5 + d) >>> 0, terminates: true, len: 5 }; }
            case 0x0F: {
                const op2 = rd(eip + 1);
                if (op2 >= 0x80 && op2 <= 0x8F) { const d = rd32s(rd, eip + 2); return { kind: 'jcc', cc: op2 - 0x80, target: (eip + 6 + d) >>> 0, fall: (eip + 6) >>> 0, terminates: true, len: 6 }; }
                if (op2 === 0xB6 || op2 === 0xB7 || op2 === 0xBE || op2 === 0xBF) {
                    const m = decodeModrm(rd, eip, 2); if (!m.isMem) return null;
                    const size = (op2 === 0xB6 || op2 === 0xBE) ? 1 : 2;
                    const signed = (op2 === 0xBE || op2 === 0xBF);
                    return { kind: signed ? 'movsx' : 'movzx', size, m, len: 2 + m.len };
                }
                { const s = decodeSSE(rd, eip, op2, 0, 2); if (s) return s; }
                return null;
            }
        }
        return null;
    }

    function decodeBlock(rd, startEip) {
        const insns = []; let cur = startEip >>> 0;
        for (let k = 0; k < 256; k++) {
            const ins = decodeInsn(rd, cur);
            if (!ins) break;
            ins.eip = cur; cur = (cur + ins.len) >>> 0;
            insns.push(ins);
            if (ins.terminates) break;
        }
        return { insns, endEip: cur >>> 0 };
    }

    const OB_MODRM = (function () {
        const a = new Uint8Array(256);
        [0x00, 0x01, 0x02, 0x03, 0x08, 0x09, 0x0A, 0x0B, 0x10, 0x11, 0x12, 0x13, 0x18, 0x19, 0x1A, 0x1B,
         0x20, 0x21, 0x22, 0x23, 0x28, 0x29, 0x2A, 0x2B, 0x30, 0x31, 0x32, 0x33, 0x38, 0x39, 0x3A, 0x3B,
         0x62, 0x63, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8A, 0x8B, 0x8C, 0x8D, 0x8E, 0x8F,
         0xC4, 0xC5, 0xD0, 0xD1, 0xD2, 0xD3, 0xD8, 0xD9, 0xDA, 0xDB, 0xDC, 0xDD, 0xDE, 0xDF, 0xFE, 0xFF].forEach(x => a[x] = 1);
        return a;
    })();
    const OB_MODRM_IMM8 = (function () { const a = new Uint8Array(256); [0x80, 0x82, 0x83, 0xC0, 0xC1, 0xC6, 0x6B].forEach(x => a[x] = 1); return a; })();
    const OB_MODRM_IMMV = (function () { const a = new Uint8Array(256); [0x81, 0x69, 0xC7].forEach(x => a[x] = 1); return a; })();
    const OB_IMM8 = (function () { const a = new Uint8Array(256); [0x04, 0x0C, 0x14, 0x1C, 0x24, 0x2C, 0x34, 0x3C, 0x6A, 0xA8, 0xCD, 0xD4, 0xD5, 0xE4, 0xE5, 0xE6, 0xE7, 0xEB].forEach(x => a[x] = 1); for (let o = 0x70; o <= 0x7F; o++) a[o] = 1; for (let o = 0xB0; o <= 0xB7; o++) a[o] = 1; for (let o = 0xE0; o <= 0xE3; o++) a[o] = 1; return a; })();
    const OB_IMMV = (function () { const a = new Uint8Array(256); [0x05, 0x0D, 0x15, 0x1D, 0x25, 0x2D, 0x35, 0x3D, 0x68, 0xA9, 0xE8, 0xE9].forEach(x => a[x] = 1); for (let o = 0xB8; o <= 0xBF; o++) a[o] = 1; return a; })();
    const OB_IMM16 = (function () { const a = new Uint8Array(256); [0xC2, 0xCA].forEach(x => a[x] = 1); return a; })();
    const OB_NONE = (function () {
        const a = new Uint8Array(256);
        [0x06, 0x07, 0x0E, 0x16, 0x17, 0x1E, 0x1F, 0x27, 0x2F, 0x37, 0x3F, 0x60, 0x61,
         0x6C, 0x6D, 0x6E, 0x6F, 0x90, 0x91, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9B, 0x9C, 0x9D, 0x9E, 0x9F,
         0xA4, 0xA5, 0xA6, 0xA7, 0xAA, 0xAB, 0xAC, 0xAD, 0xAE, 0xAF, 0xC3, 0xC9, 0xCB, 0xCC, 0xCE, 0xCF,
         0xD7, 0xF1, 0xF4, 0xF5, 0xF8, 0xF9, 0xFA, 0xFB, 0xFC, 0xFD, 0xEC, 0xED, 0xEE, 0xEF].forEach(x => a[x] = 1);
        for (let o = 0x40; o <= 0x5F; o++) a[o] = 1;
        return a;
    })();
    const TB_MODRM = (function () {
        const a = new Uint8Array(256);
        for (let o = 0x10; o <= 0x17; o++) a[o] = 1; for (let o = 0x18; o <= 0x1F; o++) a[o] = 1;
        for (let o = 0x28; o <= 0x2F; o++) a[o] = 1; for (let o = 0x40; o <= 0x4F; o++) a[o] = 1;
        for (let o = 0x50; o <= 0x6F; o++) a[o] = 1; for (let o = 0x90; o <= 0x9F; o++) a[o] = 1;
        for (let o = 0xD0; o <= 0xFE; o++) a[o] = 1;
        [0x74, 0x75, 0x76, 0x7E, 0x7F, 0xA3, 0xAB, 0xA5, 0xAD, 0xAF, 0xB0, 0xB1, 0xB3, 0xBB, 0xB6, 0xB7, 0xBE, 0xBF, 0xBC, 0xBD, 0xC0, 0xC1].forEach(x => a[x] = 1);
        return a;
    })();
    const TB_MODRM_IMM8 = (function () { const a = new Uint8Array(256); [0x70, 0x71, 0x72, 0x73, 0xA4, 0xAC, 0xBA, 0xC2, 0xC4, 0xC5, 0xC6].forEach(x => a[x] = 1); return a; })();
    const TB_NONE = (function () { const a = new Uint8Array(256); [0x05, 0x06, 0x07, 0x08, 0x09, 0x0B, 0x0E, 0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x77, 0xA0, 0xA1, 0xA2, 0xA8, 0xA9, 0xAA].forEach(x => a[x] = 1); for (let o = 0xC8; o <= 0xCF; o++) a[o] = 1; return a; })();

    function insnLen(rd, eip) {
        let i = 0, op66 = false, op67 = false;
        for (; ;) {
            const b = rd(eip + i);
            if (b === 0x66) { op66 = true; i++; continue; }
            if (b === 0x67) { op67 = true; i++; continue; }
            if (b === 0xF0 || b === 0xF2 || b === 0xF3 || b === 0x2E || b === 0x36 || b === 0x3E || b === 0x26 || b === 0x64 || b === 0x65) { i++; continue; }
            break;
        }
        const immV = op66 ? 2 : 4;
        const op = rd(eip + i); i++;
        const mlen = () => decodeModrm(rd, eip, i).len;
        if (op === 0x0F) {
            const o2 = rd(eip + i); i++;
            if (o2 >= 0x80 && o2 <= 0x8F) return i + immV;
            if (TB_MODRM_IMM8[o2]) return i + mlen() + 1;
            if (TB_MODRM[o2]) return i + mlen();
            if (TB_NONE[o2]) return i;
            return 0;
        }
        if (op === 0xF6) { const reg = (rd(eip + i) >> 3) & 7; const ml = mlen(); return i + ml + (reg <= 1 ? 1 : 0); }
        if (op === 0xF7) { const reg = (rd(eip + i) >> 3) & 7; const ml = mlen(); return i + ml + (reg <= 1 ? immV : 0); }
        if (OB_MODRM[op]) return i + mlen();
        if (OB_MODRM_IMM8[op]) return i + mlen() + 1;
        if (OB_MODRM_IMMV[op]) return i + mlen() + immV;
        if (OB_IMM8[op]) return i + 1;
        if (OB_IMMV[op]) return i + immV;
        if (OB_IMM16[op]) return i + 2;
        if (OB_NONE[op]) return i;
        if (op === 0x9A || op === 0xEA) return i + immV + 2;
        if (op === 0xC8) return i + 3;
        if (op === 0xA0 || op === 0xA1 || op === 0xA2 || op === 0xA3) return i + (op67 ? 2 : 4);
        return 0;
    }

    const REGION_MAX = 32;
    const JITMAP_MASK = 0x1FFFF;

    const moduleCache = new Map();
    let oomHalt = false;
    function bytesEq(a, b) { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; }
    function cachedModule(bytes) {
        const max = (root.EAS_JIT_MODULE_CACHE_MAX | 0) || 2048;
        let h = 2166136261 >>> 0;
        for (let i = 0; i < bytes.length; i++) { h = Math.imul(h ^ bytes[i], 16777619); }
        const key = (h >>> 0) + '_' + bytes.length;
        if (!root.EAS_JIT_NO_MODULE_CACHE) {
            const hit = moduleCache.get(key);
            if (hit && bytesEq(hit.b, bytes)) { moduleCache.delete(key); moduleCache.set(key, hit); return hit.m; }
        }
        if (oomHalt) return null;
        let m;
        try { m = new WebAssembly.Module(bytes); }
        catch (e) { oomHalt = true; if (root.console) console.warn('jit: WASM exec-memory exhausted, halting new compiles (cache reuse continues)'); return null; }
        if (!root.EAS_JIT_NO_MODULE_CACHE) {
            moduleCache.set(key, { b: bytes, m });
            while (moduleCache.size > max) { const fk = moduleCache.keys().next().value; if (fk === key) break; moduleCache.delete(fk); }
        }
        return m;
    }

    function makeCompiler(M, E) {
        const I32 = 'i32_load', S32 = 'i32_store';
        let tailCallsOK = false;
        try { tailCallsOK = WebAssembly.validate(E.buildModule({ types: [{ params: [], results: [E.VT.i32] }], funcs: [{ typeIdx: 0, locals: [], body: [E.OP.return_call, 0x00] }] })); } catch (e) { }
        const jitSlots = [], jitInsts = [];
        M.__jit_flush = function () {
            for (let k = 0; k < jitSlots.length; k++) { try { M.wasmTable.set(jitSlots[k], null); } catch (e) { } }
            jitSlots.length = 0; jitInsts.length = 0;
            oomHalt = false;
        };

        return function (eip) {
            try {
                const budget = (root.EAS_JIT_MODULE_BUDGET | 0);
                if (budget && jitInsts.length >= budget) return -1;
                const CPU = M._jit_cpu_addr() >>> 0;
                const PM = M._jit_pagemap_base() >>> 0;
                if (!PM) return -1;
                const lw = M._jit_layout() >>> 2;
                const H32 = M.HEAPU32;
                const EIP_OFF = H32[lw + 1], EFLAGS_OFF = H32[lw + 2], ST_OFF = H32[lw + 5], FPUTOP_OFF = H32[lw + 6], FPUSW_OFF = H32[lw + 7], FPUCW_OFF = H32[lw + 8], XMM_OFF = H32[lw + 9], HALTED_OFF = H32[lw + 11], FAULTADDR_OFF = H32[lw + 12], FAULTED_OFF = H32[lw + 13];
                const ST_BASE = (CPU + ST_OFF) >>> 0;
                const hb = M._jit_helpers() >>> 2;
                const HF2I = H32[hb], HRND = H32[hb + 1], HF2XM1 = H32[hb + 2], HYL2X = H32[hb + 3], HTAN = H32[hb + 4], HPATAN = H32[hb + 5], HSIN = H32[hb + 6], HCOS = H32[hb + 7], HSCALE = H32[hb + 8];
                const JM = M._jit_jitmap_base() >>> 0;
                const rd = makeReader(M, PM);
                const reqEip = eip >>> 0;

                const jitmapEntryW = (e) => (JM + ((e >>> 1) & JITMAP_MASK) * 12) >>> 2;
                const alreadyCompiled = (e) => {
                    const w = jitmapEntryW(e);
                    return M.HEAPU32[w] === (e >>> 0) && M.HEAPU32[w + 1] < 0x80000000;
                };

                function translateBlock(blk) {
                    const insns = blk.insns, endEip = blk.endEip;
                    if (insns.length === 0) return null;
                    const last = insns[insns.length - 1];
                    const branchEnds = !!(last && last.terminates);
                    const usesX87 = insns.some(i => i.kind === 'x87');
                    let usesHelper = false, usesLink = false;
                    const linkOK = false;

                    const e = new E.Emitter();
                    const L_VA = 0, L_PP = 1, L_EA = 2, L_VAL = 3, L_FA = 4, L_FB = 5, L_FR = 6, L_TOP0 = 7, L_FT = 8, L_FT2 = 9;
                    let delta = 0;
                    const regAddr = (idx) => (CPU + idx * 4) >>> 0;
                    const loadReg = (idx) => { e.i32const(regAddr(idx)); e.load(I32, 0, 0); };
                    const setRegConst = (idx, v) => { e.i32const(regAddr(idx)); e.i32const(v | 0); e.store(S32, 0, 0); };
                    const loadReg8 = (idx) => {
                        if (idx < 4) { e.i32const(regAddr(idx)); e.load(I32, 0, 0); e.i32const(0xff); e.op('i32_and'); }
                        else { e.i32const(regAddr(idx - 4)); e.load(I32, 0, 0); e.i32const(8); e.op('i32_shr_u'); e.i32const(0xff); e.op('i32_and'); }
                    };
                    const setReg8 = (idx, valThunk) => {
                        const base = idx < 4 ? idx : idx - 4, shift = idx < 4 ? 0 : 8, clearMask = idx < 4 ? 0xffffff00 : 0xffff00ff;
                        e.i32const(regAddr(base));
                        e.i32const(regAddr(base)); e.load(I32, 0, 0); e.i32const(clearMask | 0); e.op('i32_and');
                        valThunk(); e.i32const(0xff); e.op('i32_and'); if (shift) { e.i32const(shift); e.op('i32_shl'); } e.op('i32_or');
                        e.store(S32, 0, 0);
                    };
                    const addrExpr = (m) => {
                        let pushed = false;
                        if (m.base >= 0) { loadReg(m.base); pushed = true; }
                        if (m.index >= 0) { loadReg(m.index); if (m.scale) { e.i32const(m.scale); e.op('i32_shl'); } if (pushed) e.op('i32_add'); pushed = true; }
                        if (m.disp !== 0 || !pushed) { e.i32const(m.disp | 0); if (pushed) e.op('i32_add'); pushed = true; }
                    };
                    const faultSeq = (insnEip) => {
                        e.i32const((CPU + EIP_OFF) >>> 0); e.i32const(insnEip | 0); e.store(S32, 0, 0);
                        e.i32const((CPU + FAULTADDR_OFF) >>> 0); e.localGet(L_VA); e.store(S32, 0, 0);
                        e.i32const((CPU + FAULTED_OFF) >>> 0); e.i32const(1); e.store(S32, 0, 0);
                        e.i32const((CPU + HALTED_OFF) >>> 0); e.i32const(1); e.store(S32, 0, 0);
                        e.i32const(JIT_FAULT); e.ret();
                    };
                    const translateVA = (insnEip) => {
                        e.localGet(L_VA); e.i32const(12); e.op('i32_shr_u'); e.i32const(2); e.op('i32_shl');
                        e.load(I32, 0, PM); e.localTee(L_PP); e.op('i32_eqz'); e.ifBlk(); faultSeq(insnEip); e.end();
                        e.localGet(L_PP); e.localGet(L_VA); e.i32const(0xfff); e.op('i32_and'); e.op('i32_add'); e.localSet(L_EA);
                    };
                    const memVA = (m) => { addrExpr(m); e.localSet(L_VA); };
                    const pushLoc = (loc) => {
                        if (loc.t === 'reg') loadReg(loc.i);
                        else if (loc.t === 'mem') { e.localGet(L_EA); e.load(I32, 0, 0); }
                        else if (loc.t === 'imm') e.i32const(loc.v | 0);
                        else e.i32const(1);
                    };
                    const writeLoc = (loc) => {
                        if (loc.t === 'reg') { e.i32const(regAddr(loc.i)); e.localGet(L_FR); e.store(S32, 0, 0); }
                        else { e.localGet(L_EA); e.localGet(L_FR); e.store(S32, 0, 0); }
                    };
                    const flag = (bit) => { e.i32const((CPU + EFLAGS_OFF) >>> 0); e.load(I32, 0, 0); e.i32const(bit); e.op('i32_shr_u'); e.i32const(1); e.op('i32_and'); };
                    const emitCond = (cc) => {
                        switch (cc) {
                            case 0: flag(11); break;
                            case 1: flag(11); e.op('i32_eqz'); break;
                            case 2: flag(0); break;
                            case 3: flag(0); e.op('i32_eqz'); break;
                            case 4: flag(6); break;
                            case 5: flag(6); e.op('i32_eqz'); break;
                            case 6: flag(0); flag(6); e.op('i32_or'); break;
                            case 7: flag(0); flag(6); e.op('i32_or'); e.op('i32_eqz'); break;
                            case 8: flag(7); break;
                            case 9: flag(7); e.op('i32_eqz'); break;
                            case 10: flag(2); break;
                            case 11: flag(2); e.op('i32_eqz'); break;
                            case 12: flag(7); flag(11); e.op('i32_ne'); break;
                            case 13: flag(7); flag(11); e.op('i32_eq'); break;
                            case 14: flag(6); flag(7); flag(11); e.op('i32_ne'); e.op('i32_or'); break;
                            case 15: flag(6); flag(7); flag(11); e.op('i32_ne'); e.op('i32_or'); e.op('i32_eqz'); break;
                        }
                    };
                    const emitFlags = (kind) => {
                        const mask = (kind === 'inc' || kind === 'dec') ? 0x08D4 : 0x08D5;
                        e.i32const((CPU + EFLAGS_OFF) >>> 0);
                        e.i32const((CPU + EFLAGS_OFF) >>> 0); e.load(I32, 0, 0); e.i32const((~mask) | 0); e.op('i32_and');
                        e.localGet(L_FR); e.op('i32_eqz'); e.i32const(6); e.op('i32_shl'); e.op('i32_or');
                        e.localGet(L_FR); e.i32const(24); e.op('i32_shr_u'); e.i32const(0x80); e.op('i32_and'); e.op('i32_or');
                        e.localGet(L_FR); e.i32const(0xff); e.op('i32_and'); e.op('i32_popcnt'); e.i32const(1); e.op('i32_and'); e.i32const(1); e.op('i32_xor'); e.i32const(2); e.op('i32_shl'); e.op('i32_or');
                        if (kind === 'add') {
                            e.localGet(L_FR); e.localGet(L_FA); e.op('i32_lt_u'); e.op('i32_or');
                            e.localGet(L_FA); e.localGet(L_FB); e.op('i32_xor'); e.localGet(L_FR); e.op('i32_xor'); e.i32const(0x10); e.op('i32_and'); e.op('i32_or');
                            e.localGet(L_FA); e.localGet(L_FB); e.op('i32_xor'); e.i32const(-1); e.op('i32_xor'); e.localGet(L_FA); e.localGet(L_FR); e.op('i32_xor'); e.op('i32_and'); e.i32const(-2147483648); e.op('i32_and'); e.i32const(20); e.op('i32_shr_u'); e.op('i32_or');
                        } else if (kind === 'sub') {
                            e.localGet(L_FA); e.localGet(L_FB); e.op('i32_lt_u'); e.op('i32_or');
                            e.localGet(L_FA); e.localGet(L_FB); e.op('i32_xor'); e.localGet(L_FR); e.op('i32_xor'); e.i32const(0x10); e.op('i32_and'); e.op('i32_or');
                            e.localGet(L_FA); e.localGet(L_FB); e.op('i32_xor'); e.localGet(L_FA); e.localGet(L_FR); e.op('i32_xor'); e.op('i32_and'); e.i32const(-2147483648); e.op('i32_and'); e.i32const(20); e.op('i32_shr_u'); e.op('i32_or');
                        } else if (kind === 'inc') {
                            e.localGet(L_FA); e.localGet(L_FB); e.op('i32_xor'); e.localGet(L_FR); e.op('i32_xor'); e.i32const(0x10); e.op('i32_and'); e.op('i32_or');
                            e.localGet(L_FA); e.i32const(0x7fffffff); e.op('i32_eq'); e.i32const(11); e.op('i32_shl'); e.op('i32_or');
                        } else if (kind === 'dec') {
                            e.localGet(L_FA); e.localGet(L_FB); e.op('i32_xor'); e.localGet(L_FR); e.op('i32_xor'); e.i32const(0x10); e.op('i32_and'); e.op('i32_or');
                            e.localGet(L_FA); e.i32const(-2147483648); e.op('i32_eq'); e.i32const(11); e.op('i32_shl'); e.op('i32_or');
                        }
                        e.store(S32, 0, 0);
                    };
                    const computeRes = (op) => {
                        if (op === 'add' || op === 'inc') { e.localGet(L_FA); e.localGet(L_FB); e.op('i32_add'); }
                        else if (op === 'sub' || op === 'cmp' || op === 'dec') { e.localGet(L_FA); e.localGet(L_FB); e.op('i32_sub'); }
                        else if (op === 'and' || op === 'test') { e.localGet(L_FA); e.localGet(L_FB); e.op('i32_and'); }
                        else if (op === 'or') { e.localGet(L_FA); e.localGet(L_FB); e.op('i32_or'); }
                        else if (op === 'xor') { e.localGet(L_FA); e.localGet(L_FB); e.op('i32_xor'); }
                    };
                    const flagKind = (op) => op === 'add' ? 'add' : (op === 'sub' || op === 'cmp') ? 'sub' : op === 'inc' ? 'inc' : op === 'dec' ? 'dec' : 'logic';

                    const stAddrK = (K) => { e.localGet(L_TOP0); e.i32const(K | 0); e.op('i32_add'); e.i32const(7); e.op('i32_and'); e.i32const(3); e.op('i32_shl'); };
                    const loadSTk = (K) => { stAddrK(K); e.load('f64_load', 0, ST_BASE); };
                    const storeSTopen = (K) => { stAddrK(K); };
                    const pushMemF = (srcW) => {
                        if (srcW === 'f32') { e.localGet(L_EA); e.load('f32_load', 0, 0); e.op('f64_promote_f32'); }
                        else if (srcW === 'f64') { e.localGet(L_EA); e.load('f64_load', 0, 0); }
                        else { e.localGet(L_EA); e.load(I32, 0, 0); e.op('f64_convert_i32_s'); }
                    };
                    const fpuTopWriteback = () => {
                        if (usesX87 && (delta & 7) !== 0) {
                            e.i32const((CPU + FPUTOP_OFF) >>> 0);
                            e.localGet(L_TOP0); e.i32const(delta | 0); e.op('i32_add'); e.i32const(7); e.op('i32_and');
                            e.store(S32, 0, 0);
                        }
                    };
                    const farithStore = (destK, aluReg, leftK, rightK, leftMemW) => {
                        storeSTopen(destK);
                        const L = leftK === null ? () => pushMemF(leftMemW) : () => loadSTk(leftK);
                        const R = rightK === null ? () => pushMemF(leftMemW) : () => loadSTk(rightK);
                        if (aluReg === 0) { L(); R(); e.op('f64_add'); }
                        else if (aluReg === 1) { L(); R(); e.op('f64_mul'); }
                        else if (aluReg === 4) { L(); R(); e.op('f64_sub'); }
                        else if (aluReg === 5) { R(); L(); e.op('f64_sub'); }
                        else if (aluReg === 6) { L(); R(); e.op('f64_div'); }
                        else if (aluReg === 7) { R(); L(); e.op('f64_div'); }
                        e.store('f64_store', 0, ST_BASE);
                    };

                    const fpuStatusExpr = () => {
                        e.i32const((CPU + FPUSW_OFF) >>> 0); e.load('i32_load16_u', 0, 0); e.i32const(0xC7FF); e.op('i32_and');
                        e.localGet(L_TOP0); e.i32const(delta | 0); e.op('i32_add'); e.i32const(7); e.op('i32_and'); e.i32const(11); e.op('i32_shl'); e.op('i32_or');
                    };
                    const emitFcom = (loadA, loadB) => {
                        loadA(); e.localSet(L_FT); loadB(); e.localSet(L_FT2);
                        e.i32const((CPU + FPUSW_OFF) >>> 0);
                        e.i32const((CPU + FPUSW_OFF) >>> 0); e.load('i32_load16_u', 0, 0); e.i32const(0xBAFF); e.op('i32_and');
                        e.localGet(L_FT); e.localGet(L_FT2); e.op('f64_lt'); e.i32const(0x100); e.op('i32_mul'); e.op('i32_or');
                        e.localGet(L_FT); e.localGet(L_FT2); e.op('f64_eq'); e.i32const(0x4000); e.op('i32_mul'); e.op('i32_or');
                        e.localGet(L_FT); e.localGet(L_FT); e.op('f64_ne'); e.localGet(L_FT2); e.localGet(L_FT2); e.op('f64_ne'); e.op('i32_or'); e.i32const(0x4500); e.op('i32_mul'); e.op('i32_or');
                        e.store('i32_store16', 0, 0);
                    };

                    const xmmAddr = (i) => (CPU + XMM_OFF + i * 16) >>> 0;
                    const copyN = (destBaseFn, srcBaseFn, n) => { for (let k = 0; k < n; k++) { destBaseFn(); srcBaseFn(); e.load(I32, 0, k * 4); e.store(S32, 0, k * 4); } };
                    const loadScalarF64 = (baseFn, ss) => { baseFn(); if (ss) { e.load('f32_load', 0, 0); e.op('f64_promote_f32'); } else { e.load('f64_load', 0, 0); } };
                    const callHelper = (imp) => { e.op('call'); e.u(imp); usesHelper = true; };
                    const emitLink = (target) => {
                        if (!linkOK) return;
                        usesLink = true;
                        const entry = (JM + ((target >>> 1) & JITMAP_MASK) * 12) >>> 0;
                        e.i32const(entry); e.load(I32, 0, 0); e.i32const(target | 0); e.op('i32_eq');
                        e.i32const(entry); e.load(I32, 0, 4); e.i32const(0); e.op('i32_gt_s'); e.op('i32_and');
                        e.ifBlk();
                        e.i32const(entry); e.load(I32, 0, 4); e.retCallIndirect(0, 0);
                        e.end();
                    };

                    if (usesX87) { e.i32const((CPU + FPUTOP_OFF) >>> 0); e.load(I32, 0, 0); e.localSet(L_TOP0); }

                    for (const ins of insns) {
                        const ie = ins.eip;
                        switch (ins.kind) {
                            case 'nop': break;
                            case 'mov_r_imm': setRegConst(ins.reg, ins.imm); break;
                            case 'mov8_r_imm': setReg8(ins.reg, () => e.i32const(ins.imm)); break;
                            case 'mov8_rm_imm':
                                if (!ins.m.isMem) setReg8(ins.m.rm, () => e.i32const(ins.imm));
                                else { memVA(ins.m); translateVA(ie); e.localGet(L_EA); e.i32const(ins.imm & 0xff); e.store('i32_store8', 0, 0); }
                                break;
                            case 'mov8_rm_r':
                                if (!ins.m.isMem) setReg8(ins.m.rm, () => loadReg8(ins.m.reg));
                                else { memVA(ins.m); translateVA(ie); e.localGet(L_EA); loadReg8(ins.m.reg); e.store('i32_store8', 0, 0); }
                                break;
                            case 'mov8_r_rm':
                                if (!ins.m.isMem) setReg8(ins.m.reg, () => loadReg8(ins.m.rm));
                                else { memVA(ins.m); translateVA(ie); setReg8(ins.m.reg, () => { e.localGet(L_EA); e.load('i32_load8_u', 0, 0); }); }
                                break;
                            case 'mov_rm_imm':
                                if (!ins.m.isMem) setRegConst(ins.m.rm, ins.imm);
                                else { memVA(ins.m); translateVA(ie); e.localGet(L_EA); e.i32const(ins.imm | 0); e.store(S32, 0, 0); }
                                break;
                            case 'mov_rm_r':
                                if (!ins.m.isMem) { e.i32const(regAddr(ins.m.rm)); loadReg(ins.m.reg); e.store(S32, 0, 0); }
                                else { memVA(ins.m); translateVA(ie); e.localGet(L_EA); loadReg(ins.m.reg); e.store(S32, 0, 0); }
                                break;
                            case 'mov_r_rm':
                                if (!ins.m.isMem) { e.i32const(regAddr(ins.m.reg)); loadReg(ins.m.rm); e.store(S32, 0, 0); }
                                else { memVA(ins.m); translateVA(ie); e.i32const(regAddr(ins.m.reg)); e.localGet(L_EA); e.load(I32, 0, 0); e.store(S32, 0, 0); }
                                break;
                            case 'lea':
                                e.i32const(regAddr(ins.m.reg)); addrExpr(ins.m); e.store(S32, 0, 0);
                                break;
                            case 'movzx': case 'movsx': {
                                memVA(ins.m); translateVA(ie);
                                e.i32const(regAddr(ins.m.reg)); e.localGet(L_EA);
                                const ld = ins.kind === 'movzx' ? (ins.size === 1 ? 'i32_load8_u' : 'i32_load16_u') : (ins.size === 1 ? 'i32_load8_s' : 'i32_load16_s');
                                e.load(ld, 0, 0); e.store(S32, 0, 0);
                                break;
                            }
                            case 'push_r':
                                loadReg(ins.reg); e.localSet(L_VAL);
                                e.i32const(regAddr(ESP)); loadReg(ESP); e.i32const(4); e.op('i32_sub'); e.localTee(L_VA); e.store(S32, 0, 0);
                                translateVA(ie);
                                e.localGet(L_EA); e.localGet(L_VAL); e.store(S32, 0, 0);
                                break;
                            case 'push_imm':
                                e.i32const(regAddr(ESP)); loadReg(ESP); e.i32const(4); e.op('i32_sub'); e.localTee(L_VA); e.store(S32, 0, 0);
                                translateVA(ie);
                                e.localGet(L_EA); e.i32const(ins.imm | 0); e.store(S32, 0, 0);
                                break;
                            case 'pop_r':
                                loadReg(ESP); e.localSet(L_VA);
                                translateVA(ie);
                                e.localGet(L_EA); e.load(I32, 0, 0); e.localSet(L_VAL);
                                e.i32const(regAddr(ESP)); loadReg(ESP); e.i32const(4); e.op('i32_add'); e.store(S32, 0, 0);
                                e.i32const(regAddr(ins.reg)); e.localGet(L_VAL); e.store(S32, 0, 0);
                                break;
                            case 'str': {
                                const sz = ins.sz, ld = sz === 1 ? 'i32_load8_u' : I32, st = sz === 1 ? 'i32_store8' : S32;
                                const copyBody = () => {
                                    if (ins.strop === 'movs') {
                                        loadReg(ESI); e.localSet(L_VA); translateVA(ie);
                                        e.localGet(L_EA); e.load(ld, 0, 0); e.localSet(L_VAL);
                                        loadReg(EDI); e.localSet(L_VA); translateVA(ie);
                                        e.localGet(L_EA); e.localGet(L_VAL); e.store(st, 0, 0);
                                        e.i32const(regAddr(ESI)); loadReg(ESI); e.localGet(L_FA); e.op('i32_add'); e.store(S32, 0, 0);
                                    } else {
                                        loadReg(EDI); e.localSet(L_VA); translateVA(ie);
                                        e.localGet(L_EA); e.localGet(L_VAL); e.store(st, 0, 0);
                                    }
                                    e.i32const(regAddr(EDI)); loadReg(EDI); e.localGet(L_FA); e.op('i32_add'); e.store(S32, 0, 0);
                                };
                                e.i32const(-sz); e.i32const(sz);
                                e.i32const((CPU + EFLAGS_OFF) >>> 0); e.load(I32, 0, 0); e.i32const(0x400); e.op('i32_and');
                                e.op('select'); e.localSet(L_FA);
                                if (ins.strop === 'stos') { if (sz === 1) loadReg8(EAX); else loadReg(EAX); e.localSet(L_VAL); }
                                if (ins.rep) {
                                    e.op('block'); e.b(0x40); e.op('loop'); e.b(0x40);
                                    loadReg(ECX); e.op('i32_eqz'); e.op('br_if'); e.u(1);
                                    copyBody();
                                    e.i32const(regAddr(ECX)); loadReg(ECX); e.i32const(1); e.op('i32_sub'); e.store(S32, 0, 0);
                                    e.op('br'); e.u(0);
                                    e.op('end'); e.op('end');
                                } else {
                                    copyBody();
                                }
                                break;
                            }
                            case 'alu': {
                                const op = ins.op;
                                if (op === 'not') {
                                    if (ins.m.isMem) { memVA(ins.m); translateVA(ie); }
                                    pushLoc(locRM(ins.m)); e.localSet(L_FA);
                                    e.localGet(L_FA); e.i32const(-1); e.op('i32_xor'); e.localSet(L_FR);
                                    writeLoc(locRM(ins.m));
                                } else if (op === 'neg') {
                                    if (ins.m.isMem) { memVA(ins.m); translateVA(ie); }
                                    pushLoc(locRM(ins.m)); e.localSet(L_FB);
                                    e.i32const(0); e.localSet(L_FA);
                                    e.localGet(L_FA); e.localGet(L_FB); e.op('i32_sub'); e.localSet(L_FR);
                                    writeLoc(locRM(ins.m));
                                    emitFlags('sub');
                                } else {
                                    if (ins.aLoc.t === 'mem') { memVA(ins.m); translateVA(ie); }
                                    else if (ins.bLoc && ins.bLoc.t === 'mem') { memVA(ins.m); translateVA(ie); }
                                    pushLoc(ins.aLoc); e.localSet(L_FA);
                                    pushLoc(ins.bLoc); e.localSet(L_FB);
                                    computeRes(op); e.localSet(L_FR);
                                    if (ins.writeBack) writeLoc(ins.aLoc);
                                    emitFlags(flagKind(op));
                                }
                                break;
                            }
                            case 'x87': {
                                const s = ins.sub;
                                if (s === 'farith_m') {
                                    memVA(ins.m); translateVA(ie);
                                    farithStore(delta, ins.aluReg, delta, null, ins.srcW);
                                } else if (s === 'farith_st') {
                                    const destK = ins.form === 'd8' ? delta : delta + ins.i;
                                    farithStore(destK, ins.aluReg, delta, delta + ins.i, null);
                                    if (ins.form === 'de') delta += 1;
                                } else if (s === 'fld_m') {
                                    memVA(ins.m); translateVA(ie);
                                    storeSTopen(delta - 1); pushMemF(ins.width === 32 ? 'f32' : 'f64'); e.store('f64_store', 0, ST_BASE);
                                    delta -= 1;
                                } else if (s === 'fild_m') {
                                    memVA(ins.m); translateVA(ie);
                                    storeSTopen(delta - 1);
                                    e.localGet(L_EA); if (ins.width === 32) e.load(I32, 0, 0); else e.load('i32_load16_s', 0, 0); e.op('f64_convert_i32_s');
                                    e.store('f64_store', 0, ST_BASE);
                                    delta -= 1;
                                } else if (s === 'fst_m' || s === 'fstp_m') {
                                    memVA(ins.m); translateVA(ie);
                                    e.localGet(L_EA);
                                    if (ins.width === 32) { loadSTk(delta); e.op('f32_demote_f64'); e.store('f32_store', 0, 0); }
                                    else { loadSTk(delta); e.store('f64_store', 0, 0); }
                                    if (s === 'fstp_m') delta += 1;
                                } else if (s === 'fld_st') {
                                    storeSTopen(delta - 1); loadSTk(delta + ins.i); e.store('f64_store', 0, ST_BASE);
                                    delta -= 1;
                                } else if (s === 'fst_st' || s === 'fstp_st') {
                                    storeSTopen(delta + ins.i); loadSTk(delta); e.store('f64_store', 0, ST_BASE);
                                    if (s === 'fstp_st') delta += 1;
                                } else if (s === 'fxch') {
                                    loadSTk(delta); e.localSet(L_FT);
                                    storeSTopen(delta); loadSTk(delta + ins.i); e.store('f64_store', 0, ST_BASE);
                                    storeSTopen(delta + ins.i); e.localGet(L_FT); e.store('f64_store', 0, ST_BASE);
                                } else if (s === 'fchs') {
                                    storeSTopen(delta); loadSTk(delta); e.op('f64_neg'); e.store('f64_store', 0, ST_BASE);
                                } else if (s === 'fabs') {
                                    storeSTopen(delta); loadSTk(delta); e.op('f64_neg'); loadSTk(delta); loadSTk(delta); e.f64const(0); e.op('f64_lt'); e.op('select'); e.store('f64_store', 0, ST_BASE);
                                } else if (s === 'fsqrt') {
                                    storeSTopen(delta); loadSTk(delta); e.op('f64_sqrt'); e.store('f64_store', 0, ST_BASE);
                                } else if (s === 'fconst') {
                                    storeSTopen(delta - 1); e.f64const(ins.val); e.store('f64_store', 0, ST_BASE);
                                    delta -= 1;
                                } else if (s === 'fist_m') {
                                    memVA(ins.m); translateVA(ie);
                                    e.localGet(L_EA); loadSTk(delta); callHelper(0);
                                    if (ins.width === 32) e.store(S32, 0, 0); else e.store('i32_store16', 0, 0);
                                    if (ins.pop) delta += 1;
                                } else if (s === 'ftrans') {
                                    const imp = ins.op === 'f2xm1' ? 2 : ins.op === 'frndint' ? 1 : ins.op === 'fsin' ? 6 : 7;
                                    storeSTopen(delta); loadSTk(delta); callHelper(imp); e.store('f64_store', 0, ST_BASE);
                                } else if (s === 'fptan') {
                                    storeSTopen(delta); loadSTk(delta); callHelper(4); e.store('f64_store', 0, ST_BASE);
                                    storeSTopen(delta - 1); e.f64const(1.0); e.store('f64_store', 0, ST_BASE); delta -= 1;
                                } else if (s === 'fbinpop') {
                                    const imp = ins.op === 'fyl2x' ? 3 : 5;
                                    storeSTopen(delta + 1); loadSTk(delta + 1); loadSTk(delta); callHelper(imp); e.store('f64_store', 0, ST_BASE);
                                    delta += 1;
                                } else if (s === 'fscale') {
                                    storeSTopen(delta); loadSTk(delta); loadSTk(delta + 1); callHelper(8); e.store('f64_store', 0, ST_BASE);
                                } else if (s === 'fcom_st') {
                                    emitFcom(() => loadSTk(delta), () => loadSTk(delta + ins.i));
                                    if (ins.pop) delta += 1;
                                } else if (s === 'fcom_m') {
                                    memVA(ins.m); translateVA(ie);
                                    emitFcom(() => loadSTk(delta), () => pushMemF(ins.srcW));
                                    if (ins.pop) delta += 1;
                                } else if (s === 'fcompp') {
                                    emitFcom(() => loadSTk(delta), () => loadSTk(delta + 1));
                                    delta += 2;
                                } else if (s === 'fnstsw_m') {
                                    memVA(ins.m); translateVA(ie);
                                    e.localGet(L_EA); fpuStatusExpr(); e.store('i32_store16', 0, 0);
                                } else if (s === 'fldcw') {
                                    memVA(ins.m); translateVA(ie);
                                    e.i32const((CPU + FPUCW_OFF) >>> 0); e.localGet(L_EA); e.load('i32_load16_u', 0, 0); e.store('i32_store16', 0, 0);
                                } else if (s === 'fnstcw') {
                                    memVA(ins.m); translateVA(ie);
                                    e.localGet(L_EA); e.i32const((CPU + FPUCW_OFF) >>> 0); e.load('i32_load16_u', 0, 0); e.store('i32_store16', 0, 0);
                                } else return null;
                                break;
                            }
                            case 'sse': {
                                const s = ins.sub, m = ins.m, p = ins.p, reg = m.reg, srcMem = m.isMem;
                                const srcBase = () => (srcMem ? e.localGet(L_EA) : e.i32const(xmmAddr(m.rm)));
                                if (s === 'mov_ld') {
                                    if (srcMem) { memVA(m); translateVA(ie); }
                                    if (p === 2) {
                                        e.i32const(xmmAddr(reg)); srcBase(); e.load(I32, 0, 0); e.store(S32, 0, 0);
                                        if (srcMem) { e.i32const(xmmAddr(reg)); e.i32const(0); e.store(S32, 0, 4); e.i32const(xmmAddr(reg)); e.i32const(0); e.store(S32, 0, 8); e.i32const(xmmAddr(reg)); e.i32const(0); e.store(S32, 0, 12); }
                                    } else if (p === 3) {
                                        copyN(() => e.i32const(xmmAddr(reg)), srcBase, 2);
                                        if (srcMem) { e.i32const(xmmAddr(reg)); e.i32const(0); e.store(S32, 0, 8); e.i32const(xmmAddr(reg)); e.i32const(0); e.store(S32, 0, 12); }
                                    } else copyN(() => e.i32const(xmmAddr(reg)), srcBase, 4);
                                } else if (s === 'mov_st') {
                                    if (srcMem) { memVA(m); translateVA(ie); }
                                    const dstBase = () => (srcMem ? e.localGet(L_EA) : e.i32const(xmmAddr(m.rm)));
                                    if (p === 2) { dstBase(); e.i32const(xmmAddr(reg)); e.load(I32, 0, 0); e.store(S32, 0, 0); }
                                    else if (p === 3) copyN(dstBase, () => e.i32const(xmmAddr(reg)), 2);
                                    else copyN(dstBase, () => e.i32const(xmmAddr(reg)), 4);
                                } else if (s === 'mov128_ld') {
                                    if (srcMem) { memVA(m); translateVA(ie); }
                                    copyN(() => e.i32const(xmmAddr(reg)), srcBase, 4);
                                } else if (s === 'mov128_st') {
                                    if (srcMem) { memVA(m); translateVA(ie); }
                                    copyN(() => (srcMem ? e.localGet(L_EA) : e.i32const(xmmAddr(m.rm))), () => e.i32const(xmmAddr(reg)), 4);
                                } else if (s === 'arith') {
                                    const SS = p === 2, op2 = ins.op2, unary = (op2 === 0x51 || op2 === 0x52 || op2 === 0x53);
                                    if (srcMem) { memVA(m); translateVA(ie); }
                                    loadScalarF64(srcBase, SS); e.localSet(L_FT2);
                                    if (!unary) { loadScalarF64(() => e.i32const(xmmAddr(reg)), SS); e.localSet(L_FT); }
                                    e.i32const(xmmAddr(reg));
                                    if (op2 === 0x58) { e.localGet(L_FT); e.localGet(L_FT2); e.op('f64_add'); }
                                    else if (op2 === 0x59) { e.localGet(L_FT); e.localGet(L_FT2); e.op('f64_mul'); }
                                    else if (op2 === 0x5C) { e.localGet(L_FT); e.localGet(L_FT2); e.op('f64_sub'); }
                                    else if (op2 === 0x5E) { e.localGet(L_FT); e.localGet(L_FT2); e.op('f64_div'); }
                                    else if (op2 === 0x5D) { e.localGet(L_FT); e.localGet(L_FT2); e.localGet(L_FT); e.localGet(L_FT2); e.op('f64_lt'); e.localGet(L_FT2); e.localGet(L_FT2); e.op('f64_ne'); e.op('i32_or'); e.op('select'); }
                                    else if (op2 === 0x5F) { e.localGet(L_FT); e.localGet(L_FT2); e.localGet(L_FT); e.localGet(L_FT2); e.op('f64_gt'); e.localGet(L_FT2); e.localGet(L_FT2); e.op('f64_ne'); e.op('i32_or'); e.op('select'); }
                                    else if (op2 === 0x51) { e.localGet(L_FT2); e.op('f64_sqrt'); }
                                    else if (op2 === 0x53) { e.f64const(1.0); e.localGet(L_FT2); e.op('f64_div'); }
                                    else if (op2 === 0x52) { e.f64const(1.0); e.localGet(L_FT2); e.op('f64_sqrt'); e.op('f64_div'); }
                                    if (SS) { e.op('f32_demote_f64'); e.store('f32_store', 0, 0); } else { e.store('f64_store', 0, 0); }
                                } else if (s === 'comis') {
                                    const isF32 = p !== 1;
                                    if (srcMem) { memVA(m); translateVA(ie); }
                                    loadScalarF64(srcBase, isF32); e.localSet(L_FT2);
                                    loadScalarF64(() => e.i32const(xmmAddr(reg)), isF32); e.localSet(L_FT);
                                    e.localGet(L_FT); e.localGet(L_FT); e.op('f64_ne'); e.localGet(L_FT2); e.localGet(L_FT2); e.op('f64_ne'); e.op('i32_or'); e.localSet(L_VAL);
                                    e.i32const((CPU + EFLAGS_OFF) >>> 0);
                                    e.i32const((CPU + EFLAGS_OFF) >>> 0); e.load(I32, 0, 0); e.i32const((~0x08D5) | 0); e.op('i32_and');
                                    e.localGet(L_FT); e.localGet(L_FT2); e.op('f64_lt'); e.localGet(L_VAL); e.op('i32_or'); e.op('i32_or');
                                    e.localGet(L_VAL); e.i32const(2); e.op('i32_shl'); e.op('i32_or');
                                    e.localGet(L_FT); e.localGet(L_FT2); e.op('f64_eq'); e.localGet(L_VAL); e.op('i32_or'); e.i32const(6); e.op('i32_shl'); e.op('i32_or');
                                    e.store(S32, 0, 0);
                                } else if (s === 'cvtsi2s') {
                                    if (srcMem) { memVA(m); translateVA(ie); }
                                    e.i32const(xmmAddr(reg));
                                    if (srcMem) { e.localGet(L_EA); e.load(I32, 0, 0); } else loadReg(m.rm);
                                    if (p === 3) { e.op('f64_convert_i32_s'); e.store('f64_store', 0, 0); } else { e.op('f32_convert_i32_s'); e.store('f32_store', 0, 0); }
                                } else if (s === 'cvtss2sd') {
                                    if (srcMem) { memVA(m); translateVA(ie); }
                                    e.i32const(xmmAddr(reg));
                                    if (p === 2) { srcBase(); e.load('f32_load', 0, 0); e.op('f64_promote_f32'); e.store('f64_store', 0, 0); }
                                    else { srcBase(); e.load('f64_load', 0, 0); e.op('f32_demote_f64'); e.store('f32_store', 0, 0); }
                                } else if (s === 'logic') {
                                    const op2 = ins.op2;
                                    if (srcMem) { memVA(m); translateVA(ie); }
                                    for (let k = 0; k < 4; k++) {
                                        e.i32const((xmmAddr(reg) + k * 4) >>> 0);
                                        e.i32const(xmmAddr(reg)); e.load(I32, 0, k * 4);
                                        if (op2 === 0x55) { e.i32const(-1); e.op('i32_xor'); }
                                        srcBase(); e.load(I32, 0, k * 4);
                                        if (op2 === 0x54 || op2 === 0x55) e.op('i32_and'); else if (op2 === 0x56) e.op('i32_or'); else e.op('i32_xor');
                                        e.store(S32, 0, 0);
                                    }
                                } else return null;
                                break;
                            }
                            case 'jcc':
                                fpuTopWriteback();
                                emitCond(ins.cc);
                                e.ifBlk();
                                e.i32const((CPU + EIP_OFF) >>> 0); e.i32const(ins.target | 0); e.store(S32, 0, 0); emitLink(ins.target);
                                e.op('else');
                                e.i32const((CPU + EIP_OFF) >>> 0); e.i32const(ins.fall | 0); e.store(S32, 0, 0); emitLink(ins.fall);
                                e.end();
                                e.i32const(JIT_OK);
                                break;
                            case 'jmp':
                                fpuTopWriteback();
                                e.i32const((CPU + EIP_OFF) >>> 0); e.i32const(ins.target | 0); e.store(S32, 0, 0);
                                emitLink(ins.target);
                                e.i32const(JIT_OK);
                                break;
                            default: return null;
                        }
                    }

                    if (!branchEnds) {
                        fpuTopWriteback();
                        e.i32const((CPU + EIP_OFF) >>> 0); e.i32const(endEip | 0); e.store(S32, 0, 0);
                        e.i32const(JIT_OK);
                    }

                    return { code: e.code, usesHelper };
                }

                const RMAX = (root.EAS_JIT_REGION_MAX | 0) || REGION_MAX;
                const order = [], seen = new Set(), queue = [reqEip], pmW = PM >>> 2;
                while (queue.length && order.length < RMAX) {
                    const be = queue.shift() >>> 0;
                    if (seen.has(be)) continue;
                    seen.add(be);
                    if (be !== reqEip && alreadyCompiled(be)) continue;
                    if (!M.HEAPU32[pmW + (be >>> 12)]) { if (be === reqEip) return -1; continue; }
                    const blk = decodeBlock(rd, be);
                    if (blk.insns.length === 0) { if (be === reqEip) return -1; continue; }
                    const tr = translateBlock(blk);
                    if (!tr) { if (be === reqEip) return -1; continue; }
                    order.push({ be, code: tr.code, usesHelper: tr.usesHelper });
                    const last = blk.insns[blk.insns.length - 1], endEip = blk.endEip;
                    let nextLinear = endEip;
                    if (!last.terminates && !decodeInsn(rd, endEip)) {
                        const L = insnLen(rd, endEip);
                        nextLinear = L ? (endEip + L) >>> 0 : -1;
                    }
                    if (last.kind === 'jcc') { queue.push(last.target >>> 0); queue.push(last.fall >>> 0); }
                    else if (last.kind === 'jmp') { queue.push(last.target >>> 0); }
                    if (nextLinear >= 0) queue.push(nextLinear >>> 0);
                }
                if (order.length === 0) return -1;

                const f64 = E.VT.f64;
                const HT = [1, 2, 2, 3, 2, 3, 2, 2, 3];
                const regionUsesHelper = order.some(b => b.usesHelper);
                const base = regionUsesHelper ? 9 : 0;
                const types = regionUsesHelper
                    ? [{ params: [], results: [E.VT.i32] }, { params: [f64], results: [E.VT.i32] }, { params: [f64], results: [f64] }, { params: [f64, f64], results: [f64] }]
                    : [{ params: [], results: [E.VT.i32] }];
                const imports = [{ module: 'e', name: 'm', kind: 'memory', min: 0 }];
                if (regionUsesHelper) for (let i = 0; i < 9; i++) imports.push({ module: 'e', name: 'h' + i, kind: 'func', typeIdx: HT[i] });
                const funcs = order.map(b => ({ typeIdx: 0, locals: [{ count: 8, type: E.VT.i32 }, { count: 2, type: f64 }], body: b.code }));
                const exports = order.map((b, i) => ({ name: 'b' + i, kind: 'func', index: base + i }));
                const mod = E.buildModule({ types, imports, funcs, exports });
                const env = { m: M.wasmMemory };
                if (regionUsesHelper) { const HI = [HF2I, HRND, HF2XM1, HYL2X, HTAN, HPATAN, HSIN, HCOS, HSCALE]; for (let i = 0; i < 9; i++) env['h' + i] = M.wasmTable.get(HI[i]); }
                const wmod = cachedModule(mod);
                if (!wmod) return -1;
                const inst = new WebAssembly.Instance(wmod, { e: env });

                const reqW = jitmapEntryW(reqEip);
                let reqSlot = -1;
                for (let i = 0; i < order.length; i++) {
                    const idx = M.wasmTable.length;
                    M.wasmTable.grow(1);
                    M.wasmTable.set(idx, inst.exports['b' + i]);
                    jitSlots.push(idx);
                    const be = order[i].be;
                    if (be === reqEip) { reqSlot = idx; continue; }
                    const w = jitmapEntryW(be);
                    if (w === reqW) continue;
                    M.HEAPU32[w] = be >>> 0; M.HEAPU32[w + 1] = idx >>> 0; M.HEAPU32[w + 2] = 0;
                }
                jitInsts.push(inst);
                return reqSlot;
            } catch (err) {
                if (root.console) console.error('jit region compile failed @', (eip >>> 0).toString(16), err && err.message);
                return -1;
            }
        };
    }

    function installJitCompiler(M, E) {
        E = E || root.EmuJitWasm;
        if (!E) throw new Error('EmuJitWasm encoder not loaded');
        M.__jit_compile = makeCompiler(M, E);
        return M.__jit_compile;
    }

    function clearModuleCache() { moduleCache.clear(); oomHalt = false; }
    const api = { installJitCompiler, makeCompiler, decodeBlock, decodeInsn, insnLen, makeReader, clearModuleCache, JIT_OK, JIT_DEOPT, JIT_FAULT };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.EmuJitCompiler = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
