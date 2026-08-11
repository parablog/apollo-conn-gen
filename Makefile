.PHONY: coverage coverage-mutations lint-corpus lint-corpus-mutations coverage-all

# Each coverage run gets its own tmp dir (mkdtemp in tools/coverage-spec.mts), so the GET and
# mutations sweeps are safe to run at the same time — coverage-all does exactly that.

# Corpus coverage harness (tools/coverage-spec.mts): generates + rover-composes every op of the
# local, gitignored vendor corpus and regenerates COVERAGE.md. See ROADMAP.md "Coverage findings".
coverage:
	node --import tsx/esm ./tools/coverage-spec.mts

coverage-mutations:
	node --import tsx/esm ./tools/coverage-spec.mts --verbs mutations

# Corpus lint invariant (tools/lint-corpus.mts): generates every op and runs the selection linter
# over it. No rover, no composition, no shared tmp dir — safe to run alongside `make coverage`.
# Exits non-zero on any diagnostic; the generator should never produce one.
lint-corpus:
	node --import tsx/esm ./tools/lint-corpus.mts

lint-corpus-mutations:
	node --import tsx/esm ./tools/lint-corpus.mts --verbs mutations

# All four passes run TOGETHER — each writes its own report file and tmp dir, so nothing collides.
# A pass that fails still fails the whole run; the lint findings just arrive alongside the composes.
coverage-all:
	$(MAKE) -j4 lint-corpus lint-corpus-mutations coverage coverage-mutations

