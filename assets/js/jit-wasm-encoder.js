(function (root) {
    const VT = { i32: 0x7f, i64: 0x7e, f32: 0x7d, f64: 0x7c, void: 0x40 };

    const OP = {
        unreachable: 0x00, nop: 0x01, block: 0x02, loop: 0x03, if: 0x04, else: 0x05,
        end: 0x0b, br: 0x0c, br_if: 0x0d, br_table: 0x0e, return: 0x0f,
        call: 0x10, call_indirect: 0x11, return_call: 0x12, return_call_indirect: 0x13,
        drop: 0x1a, select: 0x1b,
        local_get: 0x20, local_set: 0x21, local_tee: 0x22, global_get: 0x23, global_set: 0x24,
        i32_load: 0x28, i64_load: 0x29, f32_load: 0x2a, f64_load: 0x2b,
        i32_load8_s: 0x2c, i32_load8_u: 0x2d, i32_load16_s: 0x2e, i32_load16_u: 0x2f,
        i32_store: 0x36, i64_store: 0x37, f32_store: 0x38, f64_store: 0x39,
        i32_store8: 0x3a, i32_store16: 0x3b,
        i32_const: 0x41, i64_const: 0x42, f32_const: 0x43, f64_const: 0x44,
        i32_eqz: 0x45, i32_eq: 0x46, i32_ne: 0x47,
        i32_lt_s: 0x48, i32_lt_u: 0x49, i32_gt_s: 0x4a, i32_gt_u: 0x4b,
        i32_le_s: 0x4c, i32_le_u: 0x4d, i32_ge_s: 0x4e, i32_ge_u: 0x4f,
        f64_eq: 0x61, f64_ne: 0x62, f64_lt: 0x63, f64_gt: 0x64, f64_le: 0x65, f64_ge: 0x66,
        i32_clz: 0x67, i32_ctz: 0x68, i32_popcnt: 0x69,
        i32_add: 0x6a, i32_sub: 0x6b, i32_mul: 0x6c, i32_div_s: 0x6d, i32_div_u: 0x6e,
        i32_rem_s: 0x6f, i32_rem_u: 0x70, i32_and: 0x71, i32_or: 0x72, i32_xor: 0x73,
        i32_shl: 0x74, i32_shr_s: 0x75, i32_shr_u: 0x76, i32_rotl: 0x77, i32_rotr: 0x78,
        f64_abs: 0x99, f64_neg: 0x9a, f64_ceil: 0x9b, f64_floor: 0x9c, f64_trunc: 0x9d,
        f64_nearest: 0x9e, f64_sqrt: 0x9f, f64_add: 0xa0, f64_sub: 0xa1, f64_mul: 0xa2,
        f64_div: 0xa3, f64_min: 0xa4, f64_max: 0xa5, f64_copysign: 0xa6,
        i32_wrap_i64: 0xa7, i32_trunc_f64_s: 0xaa, i32_trunc_f64_u: 0xab,
        f32_demote_f64: 0xb6, f64_convert_i32_s: 0xb7, f64_convert_i32_u: 0xb8,
        f64_promote_f32: 0xbb, f32_convert_i32_s: 0xb2, i64_extend_i32_u: 0xad,
        i32_reinterpret_f32: 0xbc, f32_reinterpret_i32: 0xbe,
    };

    function lebU(n) {
        const o = []; n = n >>> 0;
        do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; o.push(b); } while (n);
        return o;
    }
    function lebS(v) {
        v = v | 0; const o = []; let more = 1;
        while (more) {
            let b = v & 0x7f; v >>= 7;
            if ((v === 0 && (b & 0x40) === 0) || (v === -1 && (b & 0x40) !== 0)) more = 0; else b |= 0x80;
            o.push(b);
        }
        return o;
    }
    function f64bytes(x) {
        const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, x, true); return Array.from(b);
    }
    function f32bytes(x) {
        const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, x, true); return Array.from(b);
    }

    function Emitter() {
        this.code = [];
        this.nlocals = 0;
    }
    Emitter.prototype.b = function () { for (let i = 0; i < arguments.length; i++) this.code.push(arguments[i] & 0xff); return this; };
    Emitter.prototype.op = function (name) { this.code.push(OP[name]); return this; };
    Emitter.prototype.u = function (n) { const a = lebU(n); for (const x of a) this.code.push(x); return this; };
    Emitter.prototype.s = function (n) { const a = lebS(n); for (const x of a) this.code.push(x); return this; };
    Emitter.prototype.i32const = function (v) { this.op('i32_const'); this.s(v); return this; };
    Emitter.prototype.f64const = function (v) { this.op('f64_const'); for (const x of f64bytes(v)) this.code.push(x); return this; };
    Emitter.prototype.f32const = function (v) { this.op('f32_const'); for (const x of f32bytes(v)) this.code.push(x); return this; };
    Emitter.prototype.localGet = function (i) { this.op('local_get'); this.u(i); return this; };
    Emitter.prototype.localSet = function (i) { this.op('local_set'); this.u(i); return this; };
    Emitter.prototype.localTee = function (i) { this.op('local_tee'); this.u(i); return this; };
    Emitter.prototype.load = function (name, align, off) { this.op(name); this.u(align); this.u(off || 0); return this; };
    Emitter.prototype.store = function (name, align, off) { this.op(name); this.u(align); this.u(off || 0); return this; };
    Emitter.prototype.callIndirect = function (typeIdx, tableIdx) { this.op('call_indirect'); this.u(typeIdx); this.u(tableIdx || 0); return this; };
    Emitter.prototype.retCallIndirect = function (typeIdx, tableIdx) { this.op('return_call_indirect'); this.u(typeIdx); this.u(tableIdx || 0); return this; };
    Emitter.prototype.ifBlk = function (rt) { this.op('if'); this.code.push(rt === undefined ? VT.void : rt); return this; };
    Emitter.prototype.end = function () { this.op('end'); return this; };
    Emitter.prototype.ret = function () { this.op('return'); return this; };

    function section(id, payload) {
        return [id].concat(lebU(payload.length)).concat(payload);
    }
    function vec(arrs) {
        let out = lebU(arrs.length);
        for (const a of arrs) out = out.concat(a);
        return out;
    }
    function strBytes(s) {
        const b = []; for (let i = 0; i < s.length; i++) b.push(s.charCodeAt(i) & 0xff);
        return lebU(b.length).concat(b);
    }

    function buildModule(spec) {
        const types = spec.types || [];
        const imports = spec.imports || [];
        const funcs = spec.funcs || [];
        const exports = spec.exports || [];
        const elements = spec.elements || [];

        const typeSec = types.length ? section(1, vec(types.map(t =>
            [0x60].concat(vec(t.params.map(p => [p]))).concat(vec(t.results.map(r => [r])))
        ))) : [];

        const importSec = imports.length ? section(2, vec(imports.map(im => {
            const head = strBytes(im.module).concat(strBytes(im.name));
            if (im.kind === 'func') return head.concat([0x00]).concat(lebU(im.typeIdx));
            if (im.kind === 'table') return head.concat([0x01, im.elemType || 0x70, im.flags || 0x00]).concat(lebU(im.min || 0));
            if (im.kind === 'memory') return head.concat([0x02, im.flags || 0x00]).concat(lebU(im.min || 0));
            if (im.kind === 'global') return head.concat([0x03, im.valtype, im.mutable ? 1 : 0]);
            throw new Error('bad import kind ' + im.kind);
        }))) : [];

        const funcSec = funcs.length ? section(3, vec(funcs.map(f => lebU(f.typeIdx)))) : [];

        const exportSec = exports.length ? section(7, vec(exports.map(e =>
            strBytes(e.name).concat([e.kind === 'func' ? 0x00 : e.kind === 'table' ? 0x01 : e.kind === 'memory' ? 0x02 : 0x03]).concat(lebU(e.index))
        ))) : [];

        const elemSec = elements.length ? section(9, vec(elements.map(el => {
            const offExpr = [OP.i32_const].concat(lebS(el.offset)).concat([OP.end]);
            return [0x00].concat(offExpr).concat(vec(el.funcIndices.map(i => lebU(i))));
        }))) : [];

        const codeSec = funcs.length ? section(10, vec(funcs.map(f => {
            const localGroups = [];
            for (const lg of (f.locals || [])) localGroups.push(lebU(lg.count).concat([lg.type]));
            const body = vec(localGroups).concat(f.body).concat([OP.end]);
            return lebU(body.length).concat(body);
        }))) : [];

        const bytes = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]
            .concat(typeSec).concat(importSec).concat(funcSec).concat(exportSec).concat(elemSec).concat(codeSec);
        return new Uint8Array(bytes);
    }

    const api = { VT, OP, lebU, lebS, f64bytes, f32bytes, Emitter, buildModule };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.EmuJitWasm = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
