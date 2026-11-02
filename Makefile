PNPM ?= pnpm
CARGO ?= cargo
E2E_MANIFEST := test/e2e-rs/Cargo.toml
E2E_RUNNER ?= auto
E2E_ARGS ?=
E2E_COVERAGE_IGNORE ?= '(axe|browser|lib|tab)\.rs$$'

.PHONY: install test coverage coverage-scope lint anti-suppressions docs docs-check protocol-test warngen-test skills-check e2e e2e-container e2e-container-headless-shell e2e-container-full-chromium e2e-coverage e2e-check checks quality

install:
	$(PNPM) install --frozen-lockfile

test:
	$(PNPM) run test

coverage:
	$(PNPM) run coverage

coverage-scope:
	$(PNPM) run coverage:scope

lint:
	$(PNPM) run lint

anti-suppressions:
	$(PNPM) run lint:anti-suppressions

docs:
	$(PNPM) run docs

docs-check:
	$(PNPM) run docs:check

protocol-test:
	node tools/recorder-boundary-check.mjs
	node tools/same-ab.mjs --sweep --trials 2 --snr inf,8 --workers 1

warngen-test:
	node warngen/tools/render_check.mjs --era modern --quiet --all-actions
	node warngen/tools/render_check.mjs --era legacy --quiet --all-actions

skills-check:
	$(PNPM) run skills:check

e2e-coverage:
	$(CARGO) llvm-cov --manifest-path $(E2E_MANIFEST) --lib --locked --fail-under-lines 90 --ignore-filename-regex $(E2E_COVERAGE_IGNORE)

e2e-check:
	node test/e2e-rs/gen_main.mjs --check
	$(CARGO) fmt --manifest-path $(E2E_MANIFEST) --all -- --check
	$(CARGO) check --manifest-path $(E2E_MANIFEST) --all-targets --locked
	$(CARGO) clippy --manifest-path $(E2E_MANIFEST) --all-targets --locked -- -D warnings
	$(MAKE) e2e-coverage

e2e: e2e-check
	$(CARGO) test --manifest-path $(E2E_MANIFEST) --test e2e -- --runner $(E2E_RUNNER) $(E2E_ARGS)

e2e-container:
	$(MAKE) e2e E2E_RUNNER=container

e2e-container-headless-shell:
	$(MAKE) e2e E2E_RUNNER=container

e2e-container-full-chromium:
	EAS_TOOLS_E2E_IMAGE=eas-tools-e2e:full-chromium \
	EAS_TOOLS_E2E_BUILD_ARGS='--build-arg CHROMIUM_PACKAGE=chromium --build-arg CHROMIUM_BINARY=/usr/lib/chromium/chromium' \
	$(MAKE) e2e E2E_RUNNER=container

checks: docs-check coverage-scope lint anti-suppressions coverage protocol-test warngen-test skills-check e2e-check

quality: checks e2e
