import { type FormEvent, useState } from "react";
import type { ProjectDto } from "../../core/api.ts";
import { api, RequestError } from "../api.ts";
import { useHub } from "../hub.tsx";
import { useToast } from "../toast.tsx";

export function ProjectsView() {
  const { projects, loaded, refresh } = useHub();
  const toast = useToast();
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [create, setCreate] = useState(false);
  const [error, setError] = useState<string>();
  const [needsCreate, setNeedsCreate] = useState(false);
  const [busy, setBusy] = useState(false);

  const add = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const res = await api.addProject({
        path: path.trim(),
        name: name.trim() || undefined,
        createDecisions: create,
      });
      toast(
        res.alreadyRegistered
          ? `${res.project.name} was already registered.`
          : `Added ${res.project.name}.`,
      );
      setPath("");
      setName("");
      setCreate(false);
      setNeedsCreate(false);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
      setNeedsCreate(err instanceof RequestError && err.code === "no_decisions_dir");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (project: ProjectDto) => {
    const ok = window.confirm(
      `Stop showing cards from ${project.name}? The files in ${project.decisionsDir} are not touched.`,
    );
    if (!ok) return;
    try {
      await api.removeProject(project.name);
      toast(`Removed ${project.name}.`);
      await refresh();
    } catch (err) {
      toast((err as Error).message, { tone: "error" });
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Projects</h1>
        <p className="muted">
          president shows cards from the <code>decisions/</code> folder of each project below.
        </p>
      </div>

      {loaded && projects.length === 0 && <p className="muted">No projects registered yet.</p>}
      <ul className="projects">
        {projects.map((p) => (
          <li key={p.name} className="project">
            <div className="project-main">
              <strong>{p.name}</strong>
              <code className="project-path">{p.path}</code>
              {p.error ? (
                <span className="notice-inline notice-warn">{p.error}</span>
              ) : (
                <span className="muted small">
                  {p.counts.open} open · {p.counts.deferred} deferred · {p.counts.resolved} decided
                  {p.counts.broken > 0 && ` · ${p.counts.broken} broken`}
                </span>
              )}
            </div>
            <button
              type="button"
              className="button button-quiet"
              aria-label={`Remove ${p.name}`}
              onClick={() => void remove(p)}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>

      <section className="section">
        <h2 className="section-heading">Add a project</h2>
        <form className="add-project" onSubmit={(event) => void add(event)}>
          <label>
            Folder (absolute path)
            <input
              required
              value={path}
              placeholder="/home/you/projects/my-app"
              spellCheck={false}
              onChange={(event) => {
                setPath(event.target.value);
                setNeedsCreate(false);
              }}
            />
          </label>
          <label>
            Name <span className="muted small">(optional; defaults to the folder name)</span>
            <input
              value={name}
              spellCheck={false}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={create}
              onChange={(event) => setCreate(event.target.checked)}
            />
            Create a <code>decisions/</code> folder if it's missing
          </label>
          {error && (
            <p className="notice notice-warn" role="alert">
              {error}
              {needsCreate && !create && " Tick the box above to create it."}
            </p>
          )}
          <div>
            <button type="submit" className="button button-primary" disabled={busy || !path.trim()}>
              Add project
            </button>
          </div>
        </form>
        <p className="muted small">
          Agents can do the same from a terminal: <code>president add /path/to/project</code>.
        </p>
      </section>
    </div>
  );
}
