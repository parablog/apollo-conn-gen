.PHONY: publish-patch publish-minor publish-major coverage coverage-mutations

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
