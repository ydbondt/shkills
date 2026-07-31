import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Proposal } from '../api';
import { Chip, Empty, ErrorNote, Markdown, Modal, Spinner, timeAgo } from '../components';
import { useAsync, useToast } from '../state';

export default function Review() {
  const { notify } = useToast();
  const { data, error, loading, reload } = useAsync(
    () => api.get<{ proposals: Proposal[] }>('/v1/skills/pending'),
    [],
  );
  const [declining, setDeclining] = useState<Proposal | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function approve(proposal: Proposal) {
    setBusy(true);
    try {
      await api.post(`/v1/skills/versions/${proposal.versionId}/approve`);
      notify(`${proposal.slug} is live. It reaches everyone on their next session.`, 'positive');
      reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'That did not work.', 'negative');
    } finally {
      setBusy(false);
    }
  }

  async function decline() {
    if (!declining || !note.trim()) return;
    setBusy(true);
    try {
      await api.post(`/v1/skills/versions/${declining.versionId}/reject`, { note });
      notify('Sent back with your note.');
      setDeclining(null);
      setNote('');
      reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'That did not work.', 'negative');
    } finally {
      setBusy(false);
    }
  }

  const proposals = data?.proposals ?? [];

  return (
    <div className="pt-16">
      <h1 className="t-display rise">Review</h1>
      <p className="t-body-lg mt-4 rise" style={{ maxWidth: '48ch', '--i': 1 } as React.CSSProperties}>
        {proposals.length === 0
          ? 'Nothing is waiting on you.'
          : `${proposals.length} ${proposals.length === 1 ? 'proposal' : 'proposals'} waiting. Approving one puts it on every subscribed machine.`}
      </p>

      {error && <div className="mt-8"><ErrorNote message={error} /></div>}
      {loading && <Spinner label="Loading the queue" />}

      {!loading && proposals.length === 0 && (
        <Empty title="The queue is empty." detail="Everything proposed has been dealt with." />
      )}

      <div className="mt-12 space-y-5" style={{ maxWidth: '54rem' }}>
        {proposals.map((proposal, index) => (
          <article
            key={proposal.versionId}
            className="card rise p-8"
            style={{ '--i': Math.min(index, 8) } as React.CSSProperties}
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Chip>{proposal.isNewSkill ? 'new skill' : `v${proposal.version}`}</Chip>
                  <Chip>{proposal.category}</Chip>
                </div>
                <h2 className="t-title mt-3">{proposal.title}</h2>
                <p className="t-meta mt-1.5">
                  <code style={{ fontFamily: 'var(--font-mono)' }}>{proposal.slug}</code> ·{' '}
                  {proposal.author} · {timeAgo(proposal.createdAt)}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => void approve(proposal)}
                >
                  Approve
                </button>
                <button className="btn btn-secondary" disabled={busy} onClick={() => setDeclining(proposal)}>
                  Decline
                </button>
              </div>
            </div>

            {proposal.changeNote && (
              <p className="mt-5 text-soft" style={{ fontSize: '0.95rem' }}>
                “{proposal.changeNote}”
              </p>
            )}

            <hr className="rule my-6" />

            <p className="t-eyebrow mb-2">Trigger</p>
            <p className="text-soft">{proposal.description}</p>

            <details className="mt-6">
              <summary className="btn btn-quiet" style={{ paddingLeft: 0 }}>
                Read the instructions
              </summary>
              <div className="mt-4">
                <Markdown source={proposal.body} />
              </div>
            </details>

            {!proposal.isNewSkill && (
              <Link to={`/skills/${proposal.slug}`} className="t-meta accent mt-5 inline-block">
                Compare with what is live →
              </Link>
            )}
          </article>
        ))}
      </div>

      <Modal open={Boolean(declining)} onClose={() => setDeclining(null)} title="Send it back">
        <p className="text-soft mb-5">
          {declining?.author.split(' ')[0]} will see this note. Say what would make it a yes.
        </p>
        <textarea
          className="field"
          rows={4}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="This overlaps with code-review — could it fold into that one instead?"
          autoFocus
        />
        <div className="mt-6 flex justify-end gap-2">
          <button className="btn btn-secondary" onClick={() => setDeclining(null)}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!note.trim() || busy} onClick={() => void decline()}>
            Send it back
          </button>
        </div>
      </Modal>
    </div>
  );
}
