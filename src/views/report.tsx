import type { Report, Row } from "../report";

export function ReportView(props: { report: Report; shareUrl: string }) {
  const { report } = props;
  const { summary } = report;

  return (
    <>
      <div class="hero">
        <h1>
          {report.packageName ? (
            <>
              <span class="mono">{report.packageName}</span> dependency report
            </>
          ) : (
            "Dependency report"
          )}
        </h1>
        <p>
          {summary.total} package{summary.total === 1 ? "" : "s"} checked against the npm
          registry. Expand any row to read what changed between your version and the
          latest.
        </p>
      </div>

      <ul class="summary">
        <li class="major">
          <b>{summary.major}</b> major
        </li>
        <li class="minor">
          <b>{summary.minor}</b> minor
        </li>
        <li class="patch">
          <b>{summary.patch}</b> patch
        </li>
        <li>
          <b>{summary.current}</b> up to date
        </li>
        {summary.unresolved > 0 ? (
          <li>
            <b>{summary.unresolved}</b> not resolved
          </li>
        ) : null}
      </ul>

      {summary.needsManifestEdit > 0 ? (
        <p class="hint">
          {summary.needsManifestEdit} of these are outside your declared range, so{" "}
          <code>npm update</code> will not pick them up — package.json has to change.
        </p>
      ) : null}

      <div class="rows">
        {report.rows.map((row) => (
          <RowItem row={row} />
        ))}
      </div>

      {report.truncatedAt ? (
        <p class="hint" style="margin-top:16px">
          Only the first {report.truncatedAt} dependencies were checked. Split the
          manifest if you need the rest.
        </p>
      ) : null}

      {report.skipped.length > 0 ? (
        <>
          <h2 class="section-title">Not checked ({report.skipped.length})</h2>
          <ul class="muted-list">
            {report.skipped.map((item) => (
              <li>
                <span class="mono">{item.name}</span> — {item.reason} (
                <span class="mono">{item.range}</span>)
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <p class="hint" style="margin-top:28px">
        Shareable link: <a href={props.shareUrl}>{props.shareUrl}</a>
      </p>
    </>
  );
}

function RowItem(props: { row: Row }) {
  const { row } = props;
  const label = row.alias ? `${row.alias} (${row.name})` : row.name;

  const identity = (
    <>
      <span class="bar" />
      <div class="pkg">
        <div class="pkg-name">{label}</div>
        {row.description ? <p class="pkg-desc">{row.description}</p> : null}
      </div>
    </>
  );

  if (row.error) {
    return (
      <div class="row" data-severity="error">
        <div class="row-head">
          {identity}
          <div class="jump">
            <div class="sub">{errorText(row.error)}</div>
          </div>
        </div>
      </div>
    );
  }

  if (!row.upgrade) {
    return (
      <div class="row" data-severity="none">
        <div class="row-head">
          {identity}
          <div class="jump">
            <div class="versions">
              <span class="from">{row.range}</span>
            </div>
            <div class="sub">up to date</div>
          </div>
        </div>
      </div>
    );
  }

  const { upgrade } = row;
  return (
    <details
      class="row"
      data-severity={upgrade.severity}
      data-pkg={row.name}
      data-from={upgrade.from}
      data-to={upgrade.latest}
    >
      <summary>
        {identity}
        <div class="jump">
          <div class="versions">
            <span class="from">{upgrade.from}</span>
            <span class="arrow">&rarr;</span>
            <span class="to">{upgrade.latest}</span>
          </div>
          <div class="sub">
            {upgrade.versionsBehind} release{upgrade.versionsBehind === 1 ? "" : "s"} behind
            {gap(upgrade.fromPublished, upgrade.latestPublished)}{" "}
            {upgrade.needsManifestEdit ? <span class="tag edit">edit package.json</span> : null}{" "}
            {upgrade.deprecated ? <span class="tag deprecated">deprecated</span> : null}
          </div>
        </div>
      </summary>
      <div class="notes" data-state="idle">
        <p class="empty">Loading release notes…</p>
      </div>
    </details>
  );
}

function gap(from?: string, to?: string) {
  if (!from || !to) return null;
  const months = Math.round(
    (Date.parse(to) - Date.parse(from)) / (1000 * 60 * 60 * 24 * 30.44),
  );
  if (!Number.isFinite(months) || months < 2) return null;
  const text = months >= 24 ? `${Math.floor(months / 12)} years` : `${months} months`;
  return <> · {text} of changes</>;
}

function errorText(error: NonNullable<Row["error"]>): string {
  switch (error) {
    case "not_found":
      return "not found on the npm registry";
    case "no_releases":
      return "no stable releases published";
    case "unresolvable":
      return "version range could not be resolved";
    default:
      return "the registry did not respond";
  }
}
