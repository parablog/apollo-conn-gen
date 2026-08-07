.PHONY: publish-patch publish-minor publish-major coverage coverage-mutations lint-corpus lint-corpus-mutations coverage-all

# The two coverage passes share one tmp dir (os.tmpdir()/oas-coverage) and name their files by
# index, so running them at the same time silently swaps their schemas and scores the wrong ops.
# Never let make run these in parallel, whatever -j the caller passes.
.NOTPARALLEL:

publish-patch:
	npm version patch
	npm publish

publish-minor:
	npm version minor
	npm publish

publish-major:
	npm version major
	npm publish

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

# Everything, one after another. The two lint passes come first: they take minutes rather than the
# best part of an hour, and a schema the linter rejects is not worth composing. Any pass that fails
# stops the rest, so a green run means all four were green.
coverage-all: lint-corpus lint-corpus-mutations coverage coverage-mutations

