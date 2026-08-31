import semver from "semver";
import type { PackageFacts } from "../lib/npm";
import { repoUrl } from "../lib/repo";

const RECENT_SHOWN = 15;

export function PackageView(props: { facts: PackageFacts; latest: string }) {
  const { facts, latest } = props;
  const repo = facts.repo;

  return (
    <>
      <div class="hero">
        <h1 class="mono">{facts.name}</h1>
        {facts.description ? <p>{facts.description}</p> : null}
      </div>

      <ul class="summary">
        <li>
          <b>{latest}</b> latest
        </li>
        <li>
          <b>{facts.stable.length}</b> stable releases
        </li>
        {facts.time[latest] ? (
          <li>
            published <b>{formatDate(facts.time[latest])}</b>
          </li>
        ) : null}
      </ul>

      <p class="hint">
        <a href={`https://www.npmjs.com/package/${facts.name}`}>npm</a>
        {repo ? (
          <>
            {" · "}
            <a href={repoUrl(repo)}>repository</a>
          </>
        ) : null}
        {facts.homepage ? (
          <>
            {" · "}
            <a href={facts.homepage}>homepage</a>
          </>
        ) : null}
      </p>

      <h2 class="section-title">Major versions</h2>
      <div class="rows">
        {majorLine(facts).map((entry) => (
          <div class="row" data-severity="major">
            <div class="row-head">
              <span class="bar" />
              <div class="pkg">
                <div class="pkg-name">{entry.version}</div>
                <p class="pkg-desc">first release of the {entry.major}.x line</p>
              </div>
              <div class="jump">
                <div class="sub">{formatDate(facts.time[entry.version])}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <h2 class="section-title">Recent releases</h2>
      <ul class="muted-list">
        {facts.stable
          .slice(-RECENT_SHOWN)
          .reverse()
          .map((version) => (
            <li>
              <span class="mono">{version}</span>
              {facts.time[version] ? ` — ${formatDate(facts.time[version])}` : null}
              {facts.deprecations[version] ? <span class="tag deprecated">deprecated</span> : null}
            </li>
          ))}
      </ul>

      <p class="hint" style="margin-top:28px">
        To see what changed between the version you are on and the latest,{" "}
        <a href="/">paste your package.json</a>.
      </p>
    </>
  );
}

export function PopularView(props: { packages: { name: string; hits: number }[] }) {
  return (
    <>
      <div class="hero">
        <h1>Most checked packages</h1>
        <p>The npm packages that turn up most often in reports run here.</p>
      </div>

      {props.packages.length === 0 ? (
        <p class="hint">
          Nothing here yet. <a href="/">Run the first report</a>.
        </p>
      ) : (
        <ul class="muted-list">
          {props.packages.map((entry) => (
            <li>
              <a class="mono" href={`/npm/${entry.name}`}>
                {entry.name}
              </a>{" "}
              — checked {entry.hits} time{entry.hits === 1 ? "" : "s"}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** The first release of each major line, newest first. */
function majorLine(facts: PackageFacts): { version: string; major: number }[] {
  const seen = new Map<number, string>();
  for (const version of facts.stable) {
    const major = semver.major(version);
    if (!seen.has(major)) seen.set(major, version);
  }
  return [...seen.entries()]
    .map(([major, version]) => ({ major, version }))
    .sort((a, b) => b.major - a.major)
    .slice(0, 12);
}

function formatDate(iso?: string): string {
  if (!iso) return "unknown";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toISOString().slice(0, 10);
}
