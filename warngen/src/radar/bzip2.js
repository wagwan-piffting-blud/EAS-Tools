(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.WarngenBzip2 = factory();
    }
}(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    var MAX_CODE_LEN = 23;
    var MAX_GROUPS = 6;
    var GROUP_SIZE = 50;
    var FAST_BITS = 10;

    function Bits(bytes, start) {
        this.bytes = bytes;
        this.i = start;
        this.buf = 0;
        this.n = 0;
    }

    // count <= 24 keeps the buffer inside 31 bits.
    Bits.prototype.read = function (count) {
        while (this.n < count) {
            var next = this.i < this.bytes.length ? this.bytes[this.i] : 0;
            if (this.i >= this.bytes.length + 4) {
                throw new Error("bzip2: unexpected end of data");
            }
            this.i++;
            this.buf = (this.buf << 8) | next;
            this.n += 8;
        }
        this.n -= count;
        var value = (this.buf >>> this.n) & ((1 << count) - 1);
        this.buf &= (1 << this.n) - 1;
        return value;
    };

    Bits.prototype.peek = function (count) {
        while (this.n < count) {
            var next = this.i < this.bytes.length ? this.bytes[this.i] : 0;
            if (this.i >= this.bytes.length + 4) {
                throw new Error("bzip2: unexpected end of data");
            }
            this.i++;
            this.buf = (this.buf << 8) | next;
            this.n += 8;
        }
        return (this.buf >>> (this.n - count)) & ((1 << count) - 1);
    };

    Bits.prototype.skip = function (count) {
        this.n -= count;
        this.buf &= (1 << this.n) - 1;
    };

    Bits.prototype.bytePos = function () {
        return this.i - (this.n >> 3);
    };

    function Output(hint) {
        this.data = new Uint8Array(Math.max(1024, hint));
        this.length = 0;
    }

    Output.prototype.reserve = function (extra) {
        if (this.length + extra <= this.data.length) return;
        var size = this.data.length * 2;
        while (size < this.length + extra) size *= 2;
        var next = new Uint8Array(size);
        next.set(this.data.subarray(0, this.length));
        this.data = next;
    };

    function buildTable(lengths, alphaSize) {
        var minLen = 32;
        var maxLen = 0;
        var i;
        for (i = 0; i < alphaSize; i++) {
            if (lengths[i] > maxLen) maxLen = lengths[i];
            if (lengths[i] < minLen) minLen = lengths[i];
        }
        var perm = new Int32Array(alphaSize);
        var base = new Int32Array(MAX_CODE_LEN + 2);
        var limit = new Int32Array(MAX_CODE_LEN + 2);
        var pp = 0;
        for (i = minLen; i <= maxLen; i++) {
            for (var j = 0; j < alphaSize; j++) {
                if (lengths[j] === i) perm[pp++] = j;
            }
        }
        for (i = 0; i < alphaSize; i++) base[lengths[i] + 1]++;
        for (i = 1; i < base.length; i++) base[i] += base[i - 1];
        var vec = 0;
        for (i = minLen; i <= maxLen; i++) {
            vec += base[i + 1] - base[i];
            limit[i] = vec - 1;
            vec <<= 1;
        }
        for (i = minLen + 1; i <= maxLen; i++) {
            base[i] = ((limit[i - 1] + 1) << 1) - base[i];
        }
        var table = { minLen: minLen, maxLen: maxLen, perm: perm, base: base, limit: limit };
        // Codes up to FAST_BITS long resolve in one lookup: entry = symbol << 5 | length.
        var fast = new Int32Array(1 << FAST_BITS).fill(-1);
        for (var len = minLen; len <= Math.min(maxLen, FAST_BITS); len++) {
            var firstCode = len === minLen ? 0 : (limit[len - 1] + 1) << 1;
            for (var code = firstCode; code <= limit[len]; code++) {
                var sym = perm[code - base[len]];
                var shift = FAST_BITS - len;
                for (var fill = 0; fill < (1 << shift); fill++) {
                    fast[(code << shift) | fill] = (sym << 5) | len;
                }
            }
        }
        table.fast = fast;
        return table;
    }

    function decodeSymbol(bits, table) {
        var hit = table.fast[bits.peek(FAST_BITS)];
        if (hit >= 0) {
            bits.skip(hit & 31);
            return hit >> 5;
        }
        var len = table.minLen;
        var code = bits.read(len);
        while (code > table.limit[len]) {
            len++;
            if (len > table.maxLen) throw new Error("bzip2: bad Huffman code");
            code = (code << 1) | bits.read(1);
        }
        return table.perm[code - table.base[len]];
    }

    function readBlock(bits, tt, blockMax, out) {
        bits.read(16);
        bits.read(16);
        if (bits.read(1)) throw new Error("bzip2: randomised blocks are not supported");
        var origPtr = bits.read(24);

        var used = bits.read(16);
        var seqToUnseq = [];
        var i;
        var j;
        for (i = 0; i < 16; i++) {
            if (used & (0x8000 >> i)) {
                var row = bits.read(16);
                for (j = 0; j < 16; j++) {
                    if (row & (0x8000 >> j)) seqToUnseq.push(i * 16 + j);
                }
            }
        }
        var nInUse = seqToUnseq.length;
        if (!nInUse) throw new Error("bzip2: empty symbol map");
        var alphaSize = nInUse + 2;

        var nGroups = bits.read(3);
        if (nGroups < 2 || nGroups > MAX_GROUPS) throw new Error("bzip2: bad group count");
        var nSelectors = bits.read(15);
        if (!nSelectors) throw new Error("bzip2: no selectors");
        var groupOrder = [];
        for (i = 0; i < nGroups; i++) groupOrder.push(i);
        var selectors = new Uint8Array(nSelectors);
        for (i = 0; i < nSelectors; i++) {
            j = 0;
            while (bits.read(1)) {
                j++;
                if (j >= nGroups) throw new Error("bzip2: bad selector");
            }
            var picked = groupOrder[j];
            groupOrder.splice(j, 1);
            groupOrder.unshift(picked);
            selectors[i] = picked;
        }

        var tables = [];
        for (var t = 0; t < nGroups; t++) {
            var lengths = new Uint8Array(alphaSize);
            var curr = bits.read(5);
            for (i = 0; i < alphaSize; i++) {
                for (;;) {
                    if (curr < 1 || curr > 20) throw new Error("bzip2: bad code length");
                    if (!bits.read(1)) break;
                    curr += bits.read(1) ? -1 : 1;
                }
                lengths[i] = curr;
            }
            tables.push(buildTable(lengths, alphaSize));
        }

        var mtf = new Uint8Array(256);
        for (i = 0; i < nInUse; i++) mtf[i] = i;
        var counts = new Int32Array(256);
        var eob = nInUse + 1;
        var nblock = 0;
        var selectorIndex = 0;
        var groupLeft = 0;
        var table = null;
        var run = 0;
        var runWeight = 1;
        for (;;) {
            if (!groupLeft) {
                if (selectorIndex >= nSelectors) throw new Error("bzip2: ran out of selectors");
                table = tables[selectors[selectorIndex++]];
                groupLeft = GROUP_SIZE;
            }
            groupLeft--;
            var sym = decodeSymbol(bits, table);
            if (sym <= 1) {
                run += (sym + 1) * runWeight;
                runWeight <<= 1;
                continue;
            }
            if (run) {
                var uc = seqToUnseq[mtf[0]];
                if (nblock + run > blockMax) throw new Error("bzip2: block overflow");
                counts[uc] += run;
                while (run--) tt[nblock++] = uc;
                run = 0;
                runWeight = 1;
            }
            if (sym === eob) break;
            var idx = sym - 1;
            var v = mtf[idx];
            if (idx) mtf.copyWithin(1, 0, idx);
            mtf[0] = v;
            var ch = seqToUnseq[v];
            if (nblock >= blockMax) throw new Error("bzip2: block overflow");
            counts[ch]++;
            tt[nblock++] = ch;
        }
        if (origPtr >= nblock) throw new Error("bzip2: bad origin pointer");

        var cumulative = new Int32Array(256);
        var sum = 0;
        for (i = 0; i < 256; i++) {
            cumulative[i] = sum;
            sum += counts[i];
        }
        for (i = 0; i < nblock; i++) {
            var b = tt[i] & 0xff;
            tt[cumulative[b]] |= i << 8;
            cumulative[b]++;
        }

        out.reserve(nblock * 2);
        var dst = out.data;
        var len = out.length;
        var pos = tt[origPtr] >>> 8;
        var last = -1;
        var same = 0;
        for (i = 0; i < nblock; i++) {
            pos = tt[pos];
            var byte = pos & 0xff;
            pos >>>= 8;
            if (len + 256 > dst.length) {
                out.length = len;
                out.reserve(256 + (nblock - i) * 2);
                dst = out.data;
            }
            if (same === 4) {
                if (byte) dst.fill(last, len, len + byte);
                len += byte;
                same = 0;
                continue;
            }
            if (byte === last) {
                same++;
            } else {
                last = byte;
                same = 1;
            }
            dst[len++] = byte;
        }
        out.length = len;
        for (i = 0; i < nblock; i++) tt[i] = 0;
    }

    function isStream(bytes, pos) {
        return pos + 4 <= bytes.length && bytes[pos] === 0x42 && bytes[pos + 1] === 0x5a &&
            bytes[pos + 2] === 0x68 && bytes[pos + 3] >= 0x31 && bytes[pos + 3] <= 0x39;
    }

    function decompress(input) {
        var bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
        if (!isStream(bytes, 0)) throw new Error("bzip2: missing BZh signature");
        var out = new Output(bytes.length * 6);
        var pos = 0;
        while (isStream(bytes, pos)) {
            var blockMax = (bytes[pos + 3] - 0x30) * 100000;
            var tt = new Uint32Array(blockMax);
            var bits = new Bits(bytes, pos + 4);
            for (;;) {
                var hi = bits.read(24);
                var lo = bits.read(24);
                if (hi === 0x314159 && lo === 0x265359) {
                    readBlock(bits, tt, blockMax, out);
                } else if (hi === 0x177245 && lo === 0x385090) {
                    bits.read(16);
                    bits.read(16);
                    break;
                } else {
                    throw new Error("bzip2: bad block signature");
                }
            }
            pos = bits.bytePos();
        }
        return out.data.slice(0, out.length);
    }

    return {
        decompress: decompress,
        isStream: isStream
    };
}));
