import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, canCurate, type SkillDetail } from '../api';
import { Chip, ErrorNote, Field, Markdown } from '../components';
import { useSession, useToast } from '../state';

const CATEGORIES = [
  'engineering',
  'product',
  'design',
  'sales',
  'marketing',
  'support',
  'communication',
  'general',
];

const AUDIENCES = ['engineering', 'product', 'design', 'sales', 'marketing', 'support'];

const STARTER = `Describe exactly what Claude should do.

**Rules**
- Be specific. "Use tabular numbers in tables" beats "format nicely".
- Give an example of the right output — examples carry more than adjectives.
- Say what *not* to do when people commonly get it wrong.
`;

export default function SkillEditor() {
  const { slug } = useParams();
  const editing = Boolean(slug);
  const { user } = useSession();
  const { notify } = useToast();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    slug: '',
    title: '',
    description: '',
    category: 'engineering',
    audiences: [] as string[],
    tags: '',
    body: STARTER,
    changeNote: '',
    userInvocable: false,
  });
  const [slugTouched, setSlugTouched] = useState(false);
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(editing);

  useEffect(() => {
    if (!slug) return;
    api
      .get<{ skill: SkillDetail }>(`/v1/skills/${slug}`)
      .then(({ skill }) => {
        const source = skill.published ?? skill.versions[0];
        if (!source) return;
        setForm({
          slug: skill.slug,
          title: source.title,
          description: source.description,
          category: source.category,
          audiences: source.audiences,
          tags: source.tags.join(', '),
          body: source.body,
          changeNote: '',
          userInvocable: source.userInvocable,
        });
        setSlugTouched(true);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load.'))
      .finally(() => setLoading(false));
  }, [slug]);

  // A name you did not have to think about is one less decision.
  useEffect(() => {
    if (editing || slugTouched) return;
    setForm((current) => ({ ...current, slug: slugify(current.title) }));
  }, [form.title, editing, slugTouched]);

  const curator = canCurate(user);

  async function submit(event: FormEvent, forceReview = false) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const payload = {
      title: form.title,
      description: form.description,
      category: form.category,
      audiences: form.audiences,
      tags: form.tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
      body: form.body,
      changeNote: form.changeNote,
      userInvocable: form.userInvocable,
      submitForReview: forceReview || !curator,
    };

    try {
      if (editing) {
        const result = await api.post<{ version: { status: string } }>(
          `/v1/skills/${slug}/versions`,
          payload,
        );
        notify(
          result.version.status === 'approved'
            ? 'Published. Every machine picks it up on the next Claude session.'
            : 'Sent for review.',
          'positive',
        );
        navigate(`/skills/${slug}`);
      } else {
        const result = await api.post<{
          skill: { slug: string };
          version: { status: string };
        }>('/v1/skills', { ...payload, slug: form.slug });
        notify(
          result.version.status === 'approved' ? 'Published.' : 'Sent for review.',
          'positive',
        );
        navigate(`/skills/${result.skill.slug}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="t-meta pulse-soft pt-24">Loading…</p>;

  return (
    <div className="pt-12 pb-16" data-testid="editor-page" data-mode={editing ? 'edit' : 'new'}>
      <button className="t-meta" data-testid="editor-back" onClick={() => navigate(-1)}>
        ← Back
      </button>

      <h1 className="t-display mt-6 rise" data-testid="editor-heading">
        {editing ? 'Propose a change' : 'Write a skill'}
      </h1>
      <p className="t-body-lg mt-4 rise" style={{ maxWidth: '52ch', '--i': 1 } as React.CSSProperties}>
        {curator
          ? 'You can publish directly, or send it for a second pair of eyes.'
          : 'A curator reviews it before it reaches anyone’s machine.'}
      </p>

      <form
        onSubmit={(event) => void submit(event)}
        className="mt-12 grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]"
      >
        <div className="space-y-7">
          <Field label="Title">
            <input
              className="field"
              data-testid="editor-title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Code Review Standards"
              required
            />
          </Field>

          <Field
            label="Name"
            hint={`Claude reads this from ~/.claude/skills/${form.slug || 'your-skill'}/SKILL.md`}
          >
            <input
              className="field"
              data-testid="editor-slug"
              style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem' }}
              value={form.slug}
              onChange={(e) => {
                setSlugTouched(true);
                setForm({ ...form, slug: slugify(e.target.value) });
              }}
              disabled={editing}
              required
            />
          </Field>

          <Field
            label="When should Claude use this?"
            hint="This one sentence decides whether the skill ever fires. Start with “Use when…” and name the concrete trigger."
          >
            <textarea
              className="field"
              data-testid="editor-description"
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Use when reviewing a pull request or asked to review code, to apply the company review checklist."
              required
              minLength={20}
            />
          </Field>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="t-eyebrow">Instructions</span>
              <button
                type="button"
                className="btn btn-quiet"
                data-testid="editor-preview-toggle"
                onClick={() => setPreview(!preview)}
              >
                {preview ? 'Edit' : 'Preview'}
              </button>
            </div>
            {preview ? (
              <div className="card p-7" style={{ minHeight: '26rem' }}>
                <Markdown source={form.body} testId="editor-preview" />
              </div>
            ) : (
              <textarea
                className="field"
                data-testid="editor-body"
                style={{ fontFamily: 'var(--font-mono)', fontSize: '0.875rem', lineHeight: 1.7 }}
                rows={22}
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
                required
                minLength={20}
              />
            )}
            <p className="t-meta mt-2">Markdown. Headings, lists, bold, and code blocks.</p>
          </div>

          <Field label={editing ? 'What changed, and why?' : 'Note for the reviewer'}>
            <input
              className="field"
              data-testid="editor-change-note"
              value={form.changeNote}
              onChange={(e) => setForm({ ...form, changeNote: e.target.value })}
              placeholder={editing ? 'Added the rule about blocking comments' : 'Initial version'}
            />
          </Field>

          {error && <ErrorNote message={error} testId="editor-error" />}

          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary btn-lg" disabled={busy} data-testid="editor-submit">
              {busy
                ? 'Saving…'
                : curator
                  ? editing
                    ? 'Publish change'
                    : 'Publish'
                  : 'Send for review'}
            </button>
            {curator && (
              <button
                type="button"
                className="btn btn-secondary btn-lg"
                disabled={busy}
                data-testid="editor-send-for-review"
                onClick={(event) => void submit(event, true)}
              >
                Send for review instead
              </button>
            )}
          </div>
        </div>

        <aside className="space-y-7">
          <Field label="Category">
            <select
              className="field"
              data-testid="editor-category"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            >
              {CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </Field>

          <div>
            <span className="t-eyebrow mb-2 block">Who is it for?</span>
            <div className="flex flex-wrap gap-1.5">
              {AUDIENCES.map((audience) => (
                <Chip
                  key={audience}
                  testId={`editor-audience-${audience}`}
                  active={form.audiences.includes(audience)}
                  onClick={() =>
                    setForm({
                      ...form,
                      audiences: form.audiences.includes(audience)
                        ? form.audiences.filter((a) => a !== audience)
                        : [...form.audiences, audience],
                    })
                  }
                >
                  {audience}
                </Chip>
              ))}
            </div>
          </div>

          <Field label="Tags" hint="Comma separated.">
            <input
              className="field"
              data-testid="editor-tags"
              value={form.tags}
              onChange={(e) => setForm({ ...form, tags: e.target.value })}
              placeholder="git, conventions"
            />
          </Field>

          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1"
              data-testid="editor-user-invocable"
              checked={form.userInvocable}
              onChange={(e) => setForm({ ...form, userInvocable: e.target.checked })}
            />
            <span>
              <span style={{ fontWeight: 600 }}>Let people run it by name</span>
              <span className="t-meta block">
                Adds a /{form.slug || 'skill'} command as well as automatic triggering.
              </span>
            </span>
          </label>

          <div className="card p-6">
            <p className="t-eyebrow mb-3">What makes a skill work</p>
            <ul className="t-meta space-y-2" style={{ lineHeight: 1.55 }}>
              <li>The description is the trigger. Be concrete about when.</li>
              <li>One skill, one job. Split anything with “and also”.</li>
              <li>Show the output you want. Examples beat adjectives.</li>
              <li>Write the rule someone gets wrong, not the obvious ones.</li>
            </ul>
          </div>
        </aside>
      </form>
    </div>
  );
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
