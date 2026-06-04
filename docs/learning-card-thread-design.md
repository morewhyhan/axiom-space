# Learn to Card Thread Design

## Core Philosophy

AXIOM does not treat AI chat as the primary unit of work.

The primary unit is the knowledge card. A conversation is only meaningful when it is bound to a specific card and helps that card move from a raw idea toward permanent knowledge.

In this model:

- Learn plans the work.
- Forge processes one card at a time.
- Galaxy shows the resulting knowledge structure.
- Cognition reflects on the accumulated learning behavior.

The product flow is:

```text
Learning Material
  -> Fleeting Cards
  -> Learning Path
  -> Card Tasks
  -> Forge Card Threads
  -> Permanent Cards
  -> Archived Threads
  -> Completed Path
```

## Main Loop

### 1. Import Learning Material

The user imports learning material in Learn.

Examples:

- documents
- notes
- course content
- reading material
- a topic outline
- generated study resources

Learn is responsible for turning this source material into actionable knowledge work, not just storing the file.

### 2. Extract Fleeting Cards

The system analyzes the imported material and extracts important concepts.

Each concept becomes a `fleeting` card.

A fleeting card represents a raw, unfinished knowledge object. It is not yet trusted permanent knowledge. It needs to be clarified, connected, practiced, and rewritten.

### 3. Plan a Learning Path

The system organizes the extracted cards into a learning path.

The path should consider:

- prerequisite relationships
- conceptual difficulty
- source document structure
- chapter or topic grouping
- current user profile
- existing knowledge graph connections

Each learning path step should bind to a concrete `cardId`.

This is critical: a path step is not an abstract todo item. It is a task to process one card.

### 4. Turn Path Steps Into Tasks

Every step in a learning path is treated as a card task.

A task is completed only when its bound card reaches the expected learning state, usually `permanent`.

Task state should derive from card state whenever possible:

```text
fleeting card   -> task is active or pending
literature card -> task is source/reference material
permanent card  -> task is completed
```

### 5. Enter a Task

When the user starts a task from Learn, the app opens the corresponding card.

The user should be taken into the card's Forge thread.

This means:

- the card is selected
- the card editor opens on the right
- the bound Agent conversation opens in the Forge console
- the conversation is scoped to that card

### 6. Process the Card in Forge

Forge is the card processing workspace.

The Agent conversation is not a free chat. It is a card thread.

The Agent helps the user:

- clarify definitions
- ask Socratic questions
- generate examples
- identify misconceptions
- create exercises
- find related concepts
- generate learning resources
- rewrite rough notes into structured knowledge
- update the card content

The output of the conversation should be written back into the card.

### 7. Bind Conversation to Card

Each card has one active Agent thread while it is being processed.

The thread records the work history for that card:

- user questions
- Agent responses
- generated resources
- reasoning checkpoints
- assessment results
- edits applied to the card

The thread exists to explain how the card became permanent knowledge.

It is not an independent chat room.

### 8. Upgrade to Permanent

When the card becomes stable and reusable, it is upgraded to `permanent`.

This means the concept has been sufficiently processed:

- the definition is clear
- examples are present
- relationships are established
- the user has demonstrated enough understanding
- the card can be reused outside the original learning context

### 9. Archive the Thread

When a card becomes `permanent`, its bound Agent thread is automatically archived.

Archived threads are historical evidence. They should remain readable, but they should not continue as active workspaces.

The rule is:

```text
card.type becomes permanent
  -> bound session.status becomes completed
  -> bound session.phase becomes archived
  -> bound session.metadata.threadStatus becomes archived
```

If the user wants to continue exploring the topic, they should create a new fleeting card or a new related card, not reopen the completed thread as active work.

### 10. Complete the Path

The learning path ends when all task cards in the path are completed.

Usually this means all required cards have become `permanent`.

At that point:

- the path status becomes completed
- remaining active card threads should be resolved or archived
- Learn can show the path as finished
- Cognition can reflect the new growth
- Galaxy shows the strengthened knowledge graph

## Page Responsibilities

### Learn

Learn is the planning and task orchestration page.

It should support:

- importing learning material
- extracting concepts into fleeting cards
- generating learning paths
- showing card-based task progress
- starting the next card task
- tracking path completion

Learn answers:

> What should I learn next, and which card should I process now?

### Forge

Forge is the card processing page.

It should support:

- opening a card thread
- talking with the Agent in the context of one card
- editing the bound card
- generating resources for that card
- writing useful conversation output back into the card
- upgrading the card to permanent
- archiving the thread when the card is complete

Forge answers:

> How do I turn this specific card into permanent knowledge?

### Galaxy

Galaxy is the knowledge structure page.

It should support:

- visualizing cards as nodes
- visualizing relationships as edges
- showing clusters or domains
- opening a card thread from a node
- revealing how learning paths strengthen the graph

Galaxy answers:

> How is my knowledge connected?

### Cognition

Cognition is the reflection and analytics page.

It should support:

- showing cognitive dimensions
- tracking strengths and growth edges
- summarizing learning behavior
- showing AI observations
- reflecting progress from card completion and thread activity

Cognition answers:

> How is my thinking changing as I process cards?

## Implementation Rules

### Rule 1: No Floating Forge Conversations

Forge conversations must be bound to a card.

A conversation without `cardId` is not a valid Forge work unit.

### Rule 2: One Active Thread Per Active Card

Each non-permanent card may have one active Agent thread.

Opening a card should reuse its existing thread or create one if missing.

### Rule 3: Permanent Cards Archive Threads

When a card becomes permanent, its Agent thread is archived automatically.

The archived thread remains readable but should not accept new user messages.

### Rule 4: Learning Path Steps Bind to Cards

Every actionable learning path step should have a `cardId`.

The path progresses through card completion, not arbitrary checkbox completion.

### Rule 5: Generated Resources Belong to Cards

Generated documents, diagrams, quizzes, videos, PDFs, PPTs, and other resources should attach to the card being processed.

They should be visible in that card's Forge READ view.

### Rule 6: Conversation Output Should Update the Card

The Agent should not merely answer.

When the conversation produces durable knowledge, the system should help write it into the card.

## Desired User Experience

The ideal user journey:

1. User imports material in Learn.
2. AXIOM extracts concepts into fleeting cards.
3. AXIOM plans a path through those cards.
4. User starts the first task.
5. Forge opens the card thread.
6. User and Agent process the card.
7. The card content improves during the conversation.
8. User upgrades the card to permanent.
9. The thread archives automatically.
10. Learn advances to the next card.
11. When all cards are permanent, the path completes.

The core promise:

> Learning is complete only when the material has been transformed into connected, reusable, permanent knowledge.
