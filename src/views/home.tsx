const SAMPLE = `{
  "dependencies": {
    "react": "^18.2.0",
    "express": "^4.18.2"
  },
  "devDependencies": {
    "vite": "^4.0.0",
    "typescript": "^5.0.0"
  }
}`;

export function HomeView(props: { error?: string; value?: string }) {
  return (
    <>
      <div class="hero">
        <h1>See what actually changed before you bump.</h1>
        <p>
          Paste a package.json. Bumplog checks every dependency against the npm registry,
          then pulls the real release notes — so you know which upgrades are routine and
          which ones will break your build.
        </p>
      </div>

      {props.error ? <div class="error-box">{props.error}</div> : null}

      <form class="paste-form" method="post" action="/analyze">
        <textarea
          name="manifest"
          spellcheck={false}
          autocapitalize="off"
          autocomplete="off"
          placeholder={SAMPLE}
          aria-label="package.json contents"
        >{props.value ?? ""}</textarea>
        <div class="form-row">
          <button class="primary" type="submit">
            Check dependencies
          </button>
          <p class="hint">
            No account, no install. Private and git dependencies are skipped, never sent
            anywhere.
          </p>
        </div>
      </form>
    </>
  );
}

export function AboutView() {
  return (
    <>
      <div class="hero">
        <h1>About Bumplog</h1>
        <p>
          Upgrading a dependency is easy. Finding out what the upgrade does to you is the
          slow part.
        </p>
      </div>

      <h2 class="section-title">Where the numbers come from</h2>
      <p>
        Every version, publish date and deprecation notice comes from the{" "}
        <a href="https://registry.npmjs.org">npm registry</a>. The version you are on is
        read as the floor of your declared range — <code>^18.2.0</code> means the oldest
        thing you could have installed is 18.2.0. When the newest release falls outside
        that range, the row is marked <span class="tag edit">edit package.json</span>,
        because <code>npm update</code> alone will not reach it.
      </p>

      <h2 class="section-title">Where the notes come from</h2>
      <p>
        Bumplog reads the project's own CHANGELOG.md first, and falls back to its GitHub
        releases. Breaking changes are detected from the conventions projects actually
        use: <code>BREAKING CHANGES</code> headings, changesets' <code>Major Changes</code>,
        conventional-commit <code>feat!:</code> markers and keep-a-changelog{" "}
        <code>Removed</code> sections. Nothing is summarised or paraphrased — you read
        what the maintainers wrote.
      </p>

      <h2 class="section-title">What happens to what you paste</h2>
      <p>
        A report keeps the list of public package names and version ranges so the link
        stays shareable. Anything that is not a public registry package — workspace,
        file, git and private-protocol dependencies — is listed as skipped and never
        looked up. Report links are unguessable and are not indexed.
      </p>
    </>
  );
}
