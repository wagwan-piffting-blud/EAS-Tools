"""Regenerate test/fixtures/bmh-transform.json from the reference Python BMH transformer.

    python -I tools/bmh-oracle.py /home/wags/Documents/wrs-main/modules/bmh
    python -I tools/bmh-oracle.py /home/wags/Documents/wrs-main/modules/bmh --check

The reference is the WRS port of AWIPS BMH's MessageTransformer (modules/bmh/transformer.py),
run with no dictionary rules: assets/js/bmh-format.js bmhTransform() must match it exactly.
The fixture's inputs are kept; only the outputs are recomputed.
"""

import argparse
import importlib.util
import json
import sys
import types
from pathlib import Path

FIXTURE = Path(__file__).resolve().parent.parent / 'test' / 'fixtures' / 'bmh-transform.json'


def load_transformer(bmh_dir):
    package = types.ModuleType('wrs')
    package.__path__ = [str(bmh_dir.parent)]
    sys.modules['wrs'] = package
    common = types.ModuleType('wrs.common')
    common.logger = types.SimpleNamespace(info=print, warning=print, error=print, debug=print)
    sys.modules['wrs.common'] = common
    bmh = types.ModuleType('wrs.bmh')
    bmh.__path__ = [str(bmh_dir)]
    sys.modules['wrs.bmh'] = bmh
    loaded = {}
    for name in ('model', 'dictionary', 'transformer'):
        spec = importlib.util.spec_from_file_location('wrs.bmh.' + name, bmh_dir / (name + '.py'))
        module = importlib.util.module_from_spec(spec)
        sys.modules['wrs.bmh.' + name] = module
        spec.loader.exec_module(module)
        loaded[name] = module
    return loaded['transformer'].MessageTransformer([], rate=0)


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('bmh_dir', help='the wrs-main modules/bmh directory')
    parser.add_argument('--check', action='store_true', help='fail if the fixture differs from a fresh run')
    args = parser.parse_args()
    transformer = load_transformer(Path(args.bmh_dir).resolve())
    current = json.loads(FIXTURE.read_text(encoding='utf-8'))
    fresh = [{'input': c['input'], 'output': transformer.transform(c['input']).render()} for c in current]
    text = json.dumps(fresh, ensure_ascii=False, indent=2) + '\n'
    if args.check:
        if FIXTURE.read_text(encoding='utf-8') != text:
            print(f'{FIXTURE.name} is out of date; rerun without --check', file=sys.stderr)
            return 1
        print(f'{FIXTURE.name} is current ({len(fresh)} cases).')
        return 0
    FIXTURE.write_text(text, encoding='utf-8', newline='\n')
    print(f'Wrote {FIXTURE.name} ({len(fresh)} cases).')
    return 0


if __name__ == '__main__':
    sys.exit(main())
