import { Code, Diff as SharedDiff, JsonTree } from './content';

export function Diff(props: { before: string; after: string; file?: string }) {
  return <SharedDiff {...props} workspace />;
}

// Record metadata cannot claim a source session, selected branch or evidence integrity.
// Those facts belong to the actual references supplied by Host, not this viewer.
export function Evidence({ value }: { value: unknown }) {
  return (
    <div className="aw-record">
      <JsonTree value={value} />
      <details>
        <summary>原始 JSON</summary>
        <Code language="json" text={JSON.stringify(value, null, 2)} />
      </details>
    </div>
  );
}
