import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { percent } from "../format";

export function ProposalBanner() {
  const client = useQueryClient();
  const { data = [] } = useQuery({
    queryKey: ["proposals", "pending"],
    queryFn: () => api.proposals("pending"),
    refetchInterval: 1000,
  });

  const refresh = () => client.invalidateQueries();
  const approve = useMutation({ mutationFn: api.approve, onSuccess: refresh });
  const dismiss = useMutation({ mutationFn: api.dismiss, onSuccess: refresh });

  if (data.length === 0) {
    return null;
  }

  return (
    <section className="proposals" aria-label="Rollback proposals">
      {data.map((proposal) => (
        <article key={proposal.id} className="proposal" data-testid={`proposal-${proposal.flagKey}`}>
          <div>
            <strong>Rollback needed for {proposal.flagKey}</strong>
            {proposal.evidence && (
              <p>
                New version fails {percent(proposal.evidence.treatment.rate)} of requests (
                {proposal.evidence.treatment.errors}/{proposal.evidence.treatment.requests}) against{" "}
                {percent(proposal.evidence.control.rate)} on the old version. Approval is required to switch the flag off.
              </p>
            )}
          </div>
          <div className="actions">
            <button className="danger" disabled={approve.isPending} onClick={() => approve.mutate(proposal.id)}>
              Approve rollback
            </button>
            <button className="ghost" disabled={dismiss.isPending} onClick={() => dismiss.mutate(proposal.id)}>
              Dismiss
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}
