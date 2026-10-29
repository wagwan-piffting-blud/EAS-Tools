PNPM ?= pnpm

.PHONY: install test coverage coverage-scope lint anti-suppressions docs docs-check protocol-test warngen-test skills-check quality

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

quality: docs-check coverage-scope lint anti-suppressions coverage protocol-test warngen-test skills-check
