---
type: doc
description: "A basis lint problem, { path, rule?, field?, message, fatal? }: what each part holds, the closed list of core rule ids, how the CLI prints a problem, and severity (not built). Read to read or give a problem, or to find a core rule id."
status: active
---
Part of conformance in [[basis]] (Conformance): the terms are those of [[state-machine]].

- a problem is `{ path, rule?, field?, message, fatal? }`, the parts of a SARIF result (`ruleId`, a location, `message`) and of ESLint's `LintMessage`
	- `path`: where the piece is, from the root linted: a note's file, or the path a source gives
	- `rule`: the id of the rule that found it. A schema's are `<schema>/<rule>`. basis's own are a closed list under the schema name `basis`, which no other schema can take, exported as `coreRules`: `basis/name`, `basis/unique-name`, `basis/merge`, `basis/type`, `basis/fields`, `basis/link`, `basis/key`, `basis/type-note`, `basis/type-note-type`, `basis/type-note-folder`, `basis/one-definition`, `basis/definition-piece` and `basis/skip`. One id for each check a person could want on its own, as ESLint's rules and SHACL's constraint components. An id, once released, keeps its name
	- `fatal: true`, with no `rule`: the path cannot be read as a node. For a note: its frontmatter has no closing line, is not YAML, expands too far or is not a set of fields; or the file is not UTF-8, cannot be read, or is a symbolic link; or a folder cannot be read. A source gives its own, for what it cannot read. No rule can turn it off, as ESLint's fatal message (`ruleId: null`) and SARIF's tool notification
	- `field`: where in the node, as a JSON Pointer (RFC 6901), as SARIF and JSON Schema give a place in a JSON document: `/states/0`, with `~1` for a `/` in a key and `~0` for a `~`. None when the problem is the whole node. A key of one field names that field
	- `message`: what is wrong, and the fix. It does not say the field again: a field the node does not have is "Missing:", with what its type needs there
	- the CLI prints a problem as `path: field: message (rule)`, as ESLint's compact format, so an editor can open the path
	- each rule has a severity, and a schema sets it per rule: error, warning or off. Not built: every problem is an error
		- error: the note is wrong. The check fails, and so does CI
		- warning: the note is valid but maybe not complete ("fabric has no outside copy yet"). It is reported, and the check passes
		- the schema only says valid or not. Severity lives in the lint, on top of it
		- prior art: ESLint (`off`, `warn`, `error`), SHACL (`Violation`, `Warning`, `Info`)
