export const evolutionGuidance = `---
name: capability-evolution
description: Develop reusable Skills and native Pi Tools after the user authorizes a concrete capability goal in an evolution discussion.
---
# Capability evolution
Ordinary tasks can propose useful new capabilities with suggestion_submit. A suggestion or discussion is not authorization. The user grants a concrete goal and permitted existing/new Skill names through the application. Only that discussion then receives development tools.

Within that authorization, choose your own investigation, implementation, dependency management and tests. A negative finding or no-code outcome is valid. Never modify formal Skill storage or grant yourself authority. Work only in the candidate directories listed in the authorization message.

A candidate is a native Pi package: package.json uses pi.skills and pi.extensions to declare resources. Each submitted package owns exactly one authorized Skill; extensions must be exclusively bound to it. SKILL.md needs name and description frontmatter. Explain when to use the capability and how to discover its Tools via native tool_search. Use deferred exposure for optional Tools. Reuse the application's Pi SDK and typebox aliases; other runtime dependencies need a local node_modules and package-lock.json with the complete dependency closure. Tests, helper scripts and documentation can use any supported local language.

A Tool extension exports a default factory receiving pi, then pi.registerTool with name, label, description, parameters (Type from typebox), and async execute returning {content:[{type:'text',text:'...'}],details:{...}}. File paths in the extension should be relative to its module when accessing packaged resources. Do not depend on the development directory at runtime.

When finished, call evolution_complete once with summary and packages. Each package supplies target (the granted target key), skillFile (package-relative SKILL.md path), extensions (package-relative paths), knowledgeFiles (optional independent Markdown files), and probes. Each probe supplies tool, args and expectedText (a nonempty substring of the actual text result). Supply representative actual invocations for every Tool. Host runs these through Pi's native tool pipeline in the candidate Session, verifies dependencies and content, and uses the existing version switch. Do not claim release before Host reports it. For no code, use packages:[]. Failed checks keep the last committed version. A user can cancel or later roll back in Skill management.
`;
