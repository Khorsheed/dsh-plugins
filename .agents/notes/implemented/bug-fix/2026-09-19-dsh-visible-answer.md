# Agent Note: Keep DSH reasoning out of delegation answers

Status: implemented

## Problem

The isolated Room acceptance run returned reasoning concatenated with the final answer. The DSH live mirror deliberately preserved both blocks in the transcript, but its plain progress string was also reused as the delegation result.

## Decision

Plain mirrored message text contains only text blocks. Native reasoning remains verbatim in the member transcript with usage and tool events. Room speech and correlated reports therefore receive the visible answer without turning reasoning into answer content.

## Alternatives considered

**Strip reasoning in Room.** By that point both blocks have already been flattened into one string and cannot be separated reliably. The provider retains their native types.

## Consequences

Progress text and delegation results agree on the visible answer. Existing transcripts remain intact; the fix does not rewrite previously recorded Room speech. Native streaming still requires independent block presentation and browser timing verification.

## Testing

The DSH suite covers mixed reasoning/text events, verbatim transcript preservation and an actual live-driver round returning only the answer. The defect was observed in the isolated browser; the corrected browser run remains pending restart.
