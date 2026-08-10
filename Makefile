.PHONY: publish-patch publish-minor publish-major coverage coverage-mutations \
        lint-corpus lint-corpus-mutations lint-corpus-v04 coverage-all

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

# Corpus coverage harness (tools/coverage-spec.mts): generates + composes every op of the local,
# gitignored vendor corpus at connect v0.5 with reusable `@mapping`, and regenerates COVERAGE.md.
# Composition goes through tools/local/apollo-federation-cli — released rover rejects v0.5.
coverage:
	node --import tsx/esm ./tools/coverage-spec.mts

coverage-mutations:
	node --import tsx/esm ./tools/coverage-spec.mts --verbs mutations

# Corpus lint invariant (tools/lint-corpus.mts): generates every op at connect v0.5 with reusable
# `@mapping` and runs the selection linter over it. No composition, no shared tmp dir — safe to run
# alongside `make coverage`. Exits non-zero on a finding, or on a selection the reader could not read.
lint-corpus:
	node --import tsx/esm ./tools/lint-corpus.mts

lint-corpus-mutations:
	node --import tsx/esm ./tools/lint-corpus.mts --verbs mutations

# The shipping version instead, for comparing this branch against main. Writes LINT-CORPUS-v04.md,
# so it never overwrites the v0.5 report.
lint-corpus-v04:
	node --import tsx/esm ./tools/lint-corpus.mts --v04

# Everything, one after another. The lint passes come first: they take minutes rather than the best
# part of an hour, and a schema the linter rejects is not worth composing. Any pass that fails stops
# the rest, so a green run means all of them were green.
coverage-all: lint-corpus lint-corpus-mutations coverage coverage-mutations
