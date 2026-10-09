import "./ImposterRoleReveal.css";

/** A quick private glance: identity/word first, the job second, category and hints last. */
export function ImposterRoleReveal({
  word,
  category,
  board,
}: {
  word: string | null;
  category: string;
  board: string[];
}) {
  const imposter = word === null;
  return (
    <div className="imposter-role-reveal">
      <p className="imposter-role-label">{imposter ? "your role" : "the word is"}</p>
      <p className="imposter-role-focus">{imposter ? "imposter" : word}</p>
      <p className="imposter-role-instruction">
        {imposter
          ? "You have no word. Listen and blend in."
          : "Give a clue. Keep this word secret."}
      </p>
      <p className="imposter-role-category-label">the category is</p>
      <p className="imposter-role-category">{category}</p>
      {imposter && board.length > 0 ? (
        <div className="imposter-role-shortlist">
          <p className="imposter-role-label">one of these is the word</p>
          <ul>
            {board.map((candidate) => (
              <li key={candidate}>{candidate}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
