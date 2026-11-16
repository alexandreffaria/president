/**
 * The git branch a card is on: a card lives on the branch whose work it waits for, in the
 * checkout that has that branch, and the hub writes your answer there.
 */
export function BranchName({ branch }: { branch: string }) {
  return (
    <span className="branch" title={`The card is on branch ${branch}; your answer is saved there`}>
      on {branch}
    </span>
  );
}
