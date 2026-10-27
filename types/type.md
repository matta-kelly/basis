---
type: type
description: "A note that explains one type of a schema: what it is for, and when to use it over the others. Its body is the template a new note of that type starts from."
---
One note for each type a schema owns, in the folder its schema declares, with the type's name as its file name. Its description is the type's. `abstract: true` is on it when the type is abstract: no note is of it, only of the types that inherit it. `described: true` is on it when the type is described: each node of it comes from a source, not a note, and one note of type description describes it. A type that inherits a described type is described too, so its note has `described: true`. The lint checks that each one is the code's.
