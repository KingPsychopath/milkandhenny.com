# Family Feud content policy

The built-in Family Feud library is intentionally London-first. Questions must have ten curated,
plain-language answers, work when spoken aloud, and avoid reproducing official television or fan
database boards.

## Source mix

- 68 cards are original material written for this game.
- 8 cards adapt broad concepts from the genuinely crowdsourced ProtoQA development set. Their
  prompts and answer boards were rewritten for this audience rather than copied verbatim.
- ProtoQA adaptations therefore account for about 10.5% of the 76-card built-in library.

Adapted cards retain their ProtoQA source ID in `FamilyFeudCardDefinition.provenance`. The current
source IDs are `r1q1`, `r1q5`, `r1q8`, `r1q18`, `r2q5`, `r2q6`, `r2q11`, and `r2q15`.

ProtoQA data is published by the University of Massachusetts IESL under the
[Creative Commons Attribution 4.0 International licence](https://github.com/iesl/protoqa-data/blob/master/LICENSE).
The source repository and dataset documentation are available at
[iesl/protoqa-data](https://github.com/iesl/protoqa-data). This project modifies the selected
concepts and does not imply endorsement by the ProtoQA authors.

## Editorial direction

New responses from actual London players should inform later ordering and accepted aliases. Raw
player responses should not silently overwrite a published board: review, cluster and curate them
first, retaining the question's provenance and revision history.
