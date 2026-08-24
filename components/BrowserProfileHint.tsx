import { Link } from "@tanstack/react-router";

/** Quiet disclosure shown beside visitor identity fields. */
export function BrowserProfileHint() {
  return (
    <p className="font-mono text-micro theme-faint">
      saved on this device after a successful action ·{" "}
      <Link to="/privacy" className="underline underline-offset-2 hover:opacity-70">
        clear in privacy
      </Link>
    </p>
  );
}
