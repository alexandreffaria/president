import type { CardDetailDto } from "../../core/api.ts";

/**
 * Placeholder for the per-card assistant (next version): a chat backed by a headless
 * Claude Code session in the card's project (resumed through the card's `session_id`),
 * with "Teach me", "More info" and "Research" shortcuts. It will receive the card and
 * post its own actions through the same /actions API.
 */
export function CardAssistant(_props: { card: CardDetailDto }) {
  return (
    <section className="section assistant-placeholder" aria-label="Discuss this card">
      <h2 className="section-heading">Discuss</h2>
      <p className="muted">
        Asking questions about this card, "teach me the background" and research requests will live
        here in a later version. For now, add a note (<kbd>m</kbd>): agents see new notes the next
        time they run <code>president pending</code> in this project, and mark them read.
      </p>
    </section>
  );
}
