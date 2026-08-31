import { raw } from "hono/html";
import { renderMarkdown } from "../lib/md";
import type { NotesLookup } from "../lib/notes";

/** How many breaking bullets to show before collapsing the rest. */
const BREAKING_SHOWN = 8;

export function NotesView(props: { lookup: NotesLookup; repoUrl?: string }) {
  const { lookup } = props;

  if (lookup.notes.length === 0) {
    return (
      <p class="empty">
        No release notes found for these versions.{" "}
        {props.repoUrl ? <a href={props.repoUrl}>Check the repository</a> : null}
      </p>
    );
  }

  return (
    <>
      {lookup.notes.map((note) => {
        const shown = note.breaking.slice(0, BREAKING_SHOWN);
        const hidden = note.breaking.length - shown.length;

        return (
          <section>
            <h4>
              {note.sourceUrl ? <a href={note.sourceUrl}>{note.version}</a> : note.version}
            </h4>

            {shown.length > 0 ? (
              <div class="breaking">
                <div class="breaking-label">
                  Breaking · {note.breaking.length} item
                  {note.breaking.length === 1 ? "" : "s"}
                </div>
                <ul>
                  {shown.map((item) => (
                    <li>{raw(renderInline(item))}</li>
                  ))}
                </ul>
                {hidden > 0 ? (
                  <div class="sub">
                    and {hidden} more — see the{" "}
                    {note.sourceUrl ? <a href={note.sourceUrl}>full notes</a> : "full notes"}
                  </div>
                ) : null}
              </div>
            ) : null}

            {note.body ? (
              <div class="body">{raw(renderMarkdown(trim(note.body)))}</div>
            ) : (
              <p class="empty">No description published for this release.</p>
            )}
          </section>
        );
      })}

      {lookup.missing.length > 0 ? (
        <p class="sub">
          No notes found for {lookup.missing.join(", ")}.
        </p>
      ) : null}
    </>
  );
}

/** Breaking bullets are one line each, so only inline formatting applies. */
function renderInline(text: string): string {
  return renderMarkdown(text).replace(/^<p>|<\/p>$/g, "");
}

/** Keep an expanded row readable when a release ships a novel of notes. */
const MAX_BODY = 2800;

function trim(body: string): string {
  if (body.length <= MAX_BODY) return body;
  const cut = body.lastIndexOf("\n", MAX_BODY);
  return `${body.slice(0, cut > MAX_BODY / 2 ? cut : MAX_BODY)}\n\n…`;
}
