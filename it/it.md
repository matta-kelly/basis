---
type: moc
description: "The kinds of notes Matt keeps, as a package on basis: their types, and the layers a note sits in. Read to choose a type, or to change one."
status: active
---
The kinds of notes Matt keeps, as a package on [[basis]], `@mku1tra/it`, published from basis's repo: `src/schema.ts` defines them, and the notes here say what each is for.
- [[#Layers]] the layer each note sits at
- [[#Ontology]] the types, how they group, and where they are defined

- [[basis]]: what a note, a type, a property and a link are ([[basis-node]], [[basis#Schema]])
- [[kinetic]]: the work types, in its own package

---
## Layers

Every note sits at exactly one layer. Mixing them is the primary failure mode.

- **Meta-schema**: almost never changes. [[basis]]: what a note, a type, a property and a link are
- **Ontology**: changes rarely. The types of this package, of [[kinetic]], of [[landl]], and of [[que]] (`@mku1tra/que-plugin`, `@mku1tra/que-harness`). See [[#Ontology]]
- **Instance**: notes written in those types, changes constantly
- **Reality**: the actual things. Usually outside the vault; when inside, it has no type
	- test: if the program reading it went away, would it still make sense as a note? No → Reality
	- e.g. Reality: `SYSTEM.md`, `AGENTS.md`, a repo's `README.md`, dotfiles, runnable scripts
	- e.g. still a note: [[it]] (loaded by pi, but a note first), a note with a code block
	- `basis.config.ts` at the root of lot skips these, so `just lint` checks only notes

## Ontology

- `src/schema.ts` defines the types and their fields, and says what each field and value means. Its notes are this folder: this note and its type notes, which basis's `just check` lints. `just lint` at the root of lot checks every note against it
- a note is an idea, a thing, or work, by what it *is*. Each is an abstract type: no note is of it, and the types that inherit it share its fields. A type note is none of these: its type is [[type]], which is basis's, and every schema sees it
	- [[idea]]: notes about ideas and domains: [[moc]], [[doc]], [[sop]]. Their `status` says how far a note can be trusted
	- [[thing]]: notes about things that exist and do something: [[tool]], [[component]], [[service]], [[role]]. Their `status` says where the thing is in its life
	- [[work]]: actionable notes, in [[kinetic]]: objective, issue, epic, task, spec. A design-doc, in the same package, is an idea
- each type has a type note in the folder its schema declares (this package's `types/`, and basis's, kinetic's, landl's, que-plugin's and que-harness's `types/`): what it is for, and when to use it over the others. The type's code gives its description, and the note gives the prose: basis's lint merges the two into one node. The folder is the schema's `typeNotes`, and the lint checks that no type note sits anywhere else
- a type note's body is the template a new note of that type starts from; one with no body starts from `templater/note.md`
- resource *(no type yet)*: what components and services run on or store data in (i.e. monkeysuit)


