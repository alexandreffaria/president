import type { BrokenCardDto } from "../../core/api.ts";
import { Link } from "../router.tsx";

export function BrokenCard({ broken }: { broken: BrokenCardDto }) {
  return (
    <div className="page">
      <nav className="card-nav">
        <Link to="/" className="button button-quiet">
          ← Queue
        </Link>
      </nav>
      <h1 className="card-title">This card is broken</h1>
      <p>
        <code>{broken.fileName}</code> in <strong>{broken.project}</strong>
        {broken.branch !== null && <> (on {broken.branch})</>} couldn't be read:
      </p>
      <ul className="broken">
        {broken.errors.map((error, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: messages may repeat
          <li key={i}>{error}</li>
        ))}
      </ul>
      <p className="muted">
        Ask an agent to fix the file. This page updates as soon as it's saved.
      </p>
    </div>
  );
}
