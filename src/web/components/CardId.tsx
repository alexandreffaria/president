import { datedCardId } from "../../core/model.ts";
import { fullDate } from "../format.ts";

/**
 * A card's id as the hub shows it (#0013): `#k7q2` for a dated id such as `20261111k7q2`,
 * with the full id in the tooltip, and `#0007` for a numbered one. The short form is unique
 * only within its day, so it goes next to a date: the card's created time where the row
 * shows one, or the id's own date (`withDate`) where it doesn't.
 */
export function CardId(props: { id: string; withDate?: boolean }) {
  const dated = datedCardId(props.id);
  if (!dated) return <span>#{props.id}</span>;
  return (
    <span title={`#${props.id}`}>
      #{dated.short}
      {props.withDate && <> ({fullDate(dated.date)})</>}
    </span>
  );
}
