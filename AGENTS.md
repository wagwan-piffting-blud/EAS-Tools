# Repository identity

This is the codebase for a project called EAS Tools. This codebase is a fully in-browser encoder, decoder, etc. for the United States Emergency Alert System (EAS) and the Canadian Alert Ready system. The project is structured to handle incoming EAS messages, process them, and make them available for further processing, analysis, or relaying to other systems. The project is designed to be a comprehensive toolkit for working with EAS messages, providing users with the ability to encode, decode, and analyze messages in real-time.

## Agent treatment

**All** fully autonomous systems or agents working on the behalf of their user in this repository **must** abide by the instructions listed below. Do **not** deviate from the instructions here.

## Human-in-the-loop (HitL)

Humans retain responsibility and final decision authority for all agent-authored
changes. Agent validation and inspection prepare work for human review; they do
not constitute human acceptance.

### For humans

- **Review agent-authored changes**: Understand what the agent changed, why it
  changed, whether it is in scope, and whether it follows repository conventions
  and applicable requirements. The agent's handoff should provide enough evidence
  for you to evaluate the work without relying on an unsupported assurance that it
  is correct.
- **Administer the agent**: Agents are tools that can accelerate work, but they
  cannot accept responsibility for their actions or replace human knowledge and
  judgment. Monitor their work and retain control over consequential decisions.
- **Inspect results proportionally**: Match the review to the change. Review generated
  or modified code for the backend; frontend; and middleware. Use visual,
  keyboard, and accessibility inspection for UI work; exact or differential
  evidence for alert-processing changes; rendered-product comparison for WarnGen;
  and provenance or regeneration evidence for generated artifacts.

### For agents

- Keep changes narrowly scoped and reviewable. Explain what changed, why it
  changed, which files and runtime surfaces are affected, which checks were run,
  and what remains uncertain.
- Perform applicable automated and tool-assisted inspection before requesting
  human review. Browser automation, screenshots, tests, comparison workflows, and
  repository skills provide evidence; they do not replace human acceptance.
- Clearly distinguish confirmed defects, confirmed regressions, pre-existing
  issues, intentional changes, subjective differences, and inconclusive
  observations.
- Never claim that a change has been accepted, approved, visually confirmed, or
  validated by a human unless a human explicitly provided that confirmation.
- Present unresolved questions with the relevant evidence, available choices, and
  the concrete decision needed from the human reviewer.

Routine, reversible, in-scope work does not require an additional approval
checkpoint solely because an agent is performing it. Continue to a reviewable
handoff unless human judgment or new authority is required.

Pause and request Human-in-the-Loop direction before continuing when:

- the requested behavior or authoritative baseline is ambiguous;
- multiple materially different implementations are valid and choosing between
  them changes product behavior or compatibility;
- visual quality, interaction preference, wording, or product intent cannot be
  resolved from accepted requirements;
- protocol behavior, real equipment parity, or an external reference cannot be
  established confidently; or
- proceeding requires new authority, an irreversible or externally visible
  action, or a security, legal, or public-safety decision.

A human is expected to review agent-authored changes before they are accepted,
merged, published, released, or deployed.

## Invariants

When working with the codebase, it is important to understand the following major development invariants of the project:

- **All Local Functions**: Nearly everything is done locally in the browser, with no server-side processing. This means that all encoding, decoding, and analysis of EAS messages is performed on the user's device, ensuring privacy and security. The ONLY exception is Web TTS, which MUST use server side processing to generate speech synthesis.

- **Accuracy**: The project is designed to be as accurate as possible in its handling of EAS messages, adhering to the specifications outlined in the relevant standards and guidelines. This includes proper handling of message formats, encoding schemes, and Part 11 of the FCC guidelines.

- **Cohesive User Interface**: The project includes a user-friendly interface that allows users to easily interact with the various components of the toolkit. This includes features for encoding and decoding messages, analyzing message content, and viewing message details in a clear and organized manner. The interface is designed to be intuitive and accessible, making it easy for users of all skill levels to work with EAS messages, especially the visually impaired, as the interface is designed to be fully accessible and compatible with screen readers and other assistive technologies. This is important, as the EAS system is a critical component of public safety, and it is essential that all users, including those with visual impairments, have access to the information and tools they need to effectively work with EAS messages.

- **No Commits**: **Do not** commit anything to the repository in front of you without explicit permission, unless it's a fork or soft-fork. This project is exclusively handled by Wags for commits to the main repository, and you should **never** run Git commands such as `git add`, `git commit`, and especially `git push` on the repository without explicit permission. All changes and updates to the main codebase are managed by Wags, and contributors are not expected to push commits **directly to the main repository**. This ensures that the codebase remains stable and consistent, and that all changes are thoroughly reviewed and tested before being integrated into the project.

- **Extensive Testing**: The project includes extensive testing to ensure that all components are functioning correctly and that the toolkit is reliable and robust. This includes unit tests, integration tests, and end-to-end tests that cover all aspects of the project, from encoding and decoding messages to analyzing message content and displaying message details. The testing framework is designed to catch any issues or bugs early in the development process, allowing for quick resolution and ensuring that the project remains stable and reliable.

## Skills handling

Repository-local Agent Skills are stored under
[`.agents/skills`](.agents/skills/). They provide focused workflows, references,
and deterministic helpers for recurring repository tasks. Skills supplement these
instructions; they do not override `AGENTS.md`, expand the user's request, or grant
permission for additional actions.

### Selecting and using skills

- Before using a skill, read its complete `SKILL.md`.
- Use a skill when the current task matches its description or the user explicitly
  requests it. Do not invoke a skill solely because a filename or keyword loosely
  resembles its subject.
- Read supporting references only when the selected skill directs you to them and
  they are relevant to the current task.
- Inspect a skill's scripts and understand their inputs, outputs, dependencies, and
  side effects before running them.
- Keep every skill workflow within the current task scope, repository safety rules,
  and Human-in-the-Loop requirements. A skill does not grant additional authority.
- If a skill requires authority or information that is not already available, stop
  before that action and request direction.
- When multiple skills apply, use the smallest set that covers the work and sequence
  them according to their purpose.
- Report which skills were used, what evidence they produced, and anything they
  could not validate.
- If the active agent harness does not automatically discover repository skills,
  follow the applicable `SKILL.md` manually.

### Repository skill routing

- Use `eas-cross-surface-impact-map` when a change may cross the shell, tool
  bundles, iframes, workers, WASM, shared helpers, native bridges, or generated
  assets, or when the correct source-of-truth file is unclear.
- Use `eas-artifact-lineage` before modifying manifests, generated or derived data,
  bundles, WASM loaders, voice assets, geographic data, or vendored artifacts.
- Use `eas-alert-differential-lab` for changes affecting SAME encoding or decoding,
  alert audio, E2T wording, ENDEC profiles, timing, or alert locations.
- Use `warngen-reference-parity` when comparing or changing WarnGen products,
  templates, XML configuration, VTEC, UGC, geography, or NWS/AWIPS phrasing.
- Use `eas-browser-state-comparison` when comparing baseline and candidate browser
  behavior involving UI state, loading, navigation, focus, accessibility, workers,
  offline behavior, or responsive layout.
- Use `eas-quality-workflow` when adding tests, changing coverage scope, updating
  generated documentation, or preparing the repository-wide quality handoff.
- Use `upstream-fork-sync` when synchronizing a fork or soft-fork with an
  upstream Git repository, especially when the worktree is dirty or the merge
  must remain uncommitted for human inspection.

Skills guide investigation and validation; they do not determine product intent or
human acceptance. Request Human-in-the-Loop review when a selected skill identifies
an unresolved subjective, authoritative, or compatibility decision.
