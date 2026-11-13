import { type CardKind, KEYED_OPTIONS } from "../../core/model.ts";
import type { CardOption } from "../../core/schema.ts";
import { optionLabel } from "../format.ts";
import { Markdown } from "./Markdown.tsx";

export function OptionCard(props: {
  option: CardOption;
  index: number;
  kind: CardKind;
  details: string | undefined;
  recommended: boolean;
  selected: boolean;
  chosen: boolean;
  selectable: boolean;
  onSelect: () => void;
}) {
  const { option, index, kind } = props;
  const label = optionLabel(index, kind);
  const classes = ["option", props.selected && "option-selected", props.chosen && "option-chosen"]
    .filter(Boolean)
    .join(" ");
  return (
    <article className={classes} aria-label={`Option ${label}: ${option.title}`}>
      <header className="option-header">
        <span className="option-key" aria-hidden="true">
          {label}
        </span>
        <h3 className="option-title">{option.title}</h3>
        {props.recommended && <span className="tag tag-recommended">Recommended</span>}
        {props.chosen && <span className="tag tag-chosen">Chosen</span>}
      </header>
      {option.summary && <p className="option-summary">{option.summary}</p>}
      {(option.pros.length > 0 || option.cons.length > 0) && (
        <div className="tradeoffs">
          {option.pros.length > 0 && (
            <div>
              <h4 className="tradeoffs-heading tradeoffs-pros">Pros</h4>
              <ul>
                {option.pros.map((pro, i) => (
                  // Static list; two pros may have the same text.
                  // biome-ignore lint/suspicious/noArrayIndexKey: static list, duplicates allowed
                  <li key={i}>{pro}</li>
                ))}
              </ul>
            </div>
          )}
          {option.cons.length > 0 && (
            <div>
              <h4 className="tradeoffs-heading tradeoffs-cons">Cons</h4>
              <ul>
                {option.cons.map((con, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: static list, duplicates allowed
                  <li key={i}>{con}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {props.details && <Markdown className="option-details">{props.details}</Markdown>}
      {props.selectable && (
        <footer className="option-footer">
          <button
            type="button"
            className={props.selected ? "button button-primary" : "button"}
            aria-pressed={props.selected}
            onClick={props.onSelect}
          >
            {props.selected ? "Selected" : `Choose ${label}`}
            {/* No key picks an option past the 9th (oew6), so it shows no key. */}
            {index < KEYED_OPTIONS && <kbd>{kind === "ab" ? `${index + 1}` : label}</kbd>}
          </button>
        </footer>
      )}
    </article>
  );
}
