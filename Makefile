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

# The two lint passes come first: they take minutes rather than the best part of an hour, and a
# schema the linter rejects is not worth composing. The two compose sweeps then run TOGETHER
# (-j2, up to 16 rovers at peak); a pass that fails still fails the whole run.
coverage-all: lint-corpus lint-corpus-mutations
	$(MAKE) -j2 coverage coverage-mutations

