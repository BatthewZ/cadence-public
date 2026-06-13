/**
 * Public API barrel for the lite-markdown module (swarm/plans/markdown.md §6).
 *
 * Exposes the renderer ({@link Markdown}), the authoring surfaces
 * ({@link MarkdownEditor}, {@link EditableMarkdown}), the presentational
 * {@link MarkdownToolbar}, the {@link parseMarkdown} entry point, and the AST /
 * selection / command types so consumers have one import site for the feature.
 *
 * Per CLAUDE.md rule 18 this barrel is a convenience only: every component here
 * lives within `components/markdown/` and imports no sibling directory that
 * imports back from `ui/`, so there is no cross-directory chunk cycle. Page-level
 * consumers may still import directly from the individual files.
 */
export { EditableMarkdown } from "./EditableMarkdown";
export { Markdown } from "./Markdown";
export { MarkdownEditor } from "./MarkdownEditor";
export { type MarkdownCommand,MarkdownToolbar } from "./MarkdownToolbar";
export { type MdInline, type MdNode,parseMarkdown } from "./parse";
export { type MdSelection } from "./transforms";
