import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { EmailAddressNotice } from "@/components/EmailAddressNotice";
import { getPublicSurveyFn, submitSurveyFn } from "@/features/surveys/surveys.functions";
import type {
  SurveyInvitationContext,
  SurveyQuestion,
  SurveyRecord,
} from "@/features/surveys/types";
import { SITE_BRAND } from "@/lib/shared/config";
import { buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/surveys/$slug")({
  validateSearch: (search: Record<string, unknown>): { invite?: string } =>
    typeof search.invite === "string" ? { invite: search.invite } : {},
  loaderDeps: ({ search }) => ({ invite: search.invite }),
  loader: ({ params, deps }) =>
    getPublicSurveyFn({ data: { slug: params.slug, invite: deps.invite } }),
  head: ({ loaderData }) =>
    buildSeoHead({
      title: loaderData ? `${loaderData.survey.title} — ${SITE_BRAND}` : `Survey — ${SITE_BRAND}`,
      description: loaderData?.survey.intro || "A small question from Milk & Henny.",
      path: `/surveys/${loaderData?.survey.slug ?? "survey"}`,
      robots: "noindex, nofollow",
      referrer: "no-referrer",
    }),
  component: SurveyPage,
});

function SurveyPage() {
  const experience = Route.useLoaderData();
  const search = Route.useSearch();
  if (!experience) return <SurveyUnavailable />;
  if (experience.survey.identityMode === "identified" && !experience.invitation) {
    return <SurveyAccessNeeded />;
  }
  return (
    <SurveyForm
      survey={experience.survey}
      invitation={experience.invitation}
      invitationToken={search.invite}
    />
  );
}

function SurveyAccessNeeded() {
  return (
    <main className="min-h-screen bg-background px-6 py-16 text-foreground">
      <div className="mx-auto max-w-xl">
        <p className="font-mono text-micro uppercase tracking-widest theme-muted">
          milk &amp; henny
        </p>
        <h1 className="mt-5 font-serif text-4xl tracking-tight">Use your personal survey link.</h1>
        <p className="mt-5 font-serif text-lg leading-relaxed theme-muted">
          This survey records who has responded. Open the link in the email we sent you, or contact
          hello@milkandhenny.com if you need another one.
        </p>
      </div>
    </main>
  );
}

function SurveyUnavailable() {
  return (
    <main className="min-h-screen bg-background px-6 py-16 text-foreground">
      <div className="mx-auto max-w-xl">
        <p className="font-mono text-micro uppercase tracking-widest theme-muted">milk & henny</p>
        <h1 className="mt-5 font-serif text-4xl tracking-tight">This question has gone quiet.</h1>
        <p className="mt-5 font-serif text-lg leading-relaxed theme-muted">
          This survey is not open right now. If you think it should be, email
          hello@milkandhenny.com.
        </p>
      </div>
    </main>
  );
}

function SurveyForm({
  survey,
  invitation,
  invitationToken,
}: {
  survey: SurveyRecord;
  invitation: SurveyInvitationContext | null;
  invitationToken?: string;
}) {
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [respondentName, setRespondentName] = useState(invitation?.respondentName || "");
  const [respondentEmail, setRespondentEmail] = useState(invitation?.respondentEmail || "");
  const [submitAnonymously, setSubmitAnonymously] = useState(false);
  const [state, setState] = useState<"ready" | "sending" | "sent" | "error">("ready");
  const [error, setError] = useState("");
  const requiredCount = survey.questions.filter((question) => question.required).length;

  const requiredAnsweredCount = useMemo(
    () =>
      survey.questions.filter((question) => {
        if (!question.required) return false;
        const answer = answers[question.id];
        return Array.isArray(answer)
          ? answer.length > 0
          : typeof answer === "string" && answer.trim().length > 0;
      }).length,
    [answers, survey.questions],
  );

  const updateAnswer = (question: SurveyQuestion, value: string | string[]) => {
    setAnswers((current) => ({ ...current, [question.id]: value }));
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setState("sending");
    setError("");
    try {
      const result = await submitSurveyFn({
        data: {
          slug: survey.slug,
          respondentName,
          respondentEmail,
          answers,
          invitationToken,
          submitAnonymously,
        },
      });
      if (result.alreadySubmitted) {
        setError(
          invitation
            ? "This personal link has already been used."
            : "We already have a response from that email address.",
        );
        setState("error");
        return;
      }
      setState("sent");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "We could not save that response. Try again.",
      );
      setState("error");
    }
  };

  if (invitation?.completed) {
    return (
      <main className="min-h-screen bg-background px-6 py-16 text-foreground">
        <div className="mx-auto max-w-xl">
          <p className="font-mono text-micro uppercase tracking-widest theme-muted">thank you</p>
          <h1 className="mt-5 font-serif text-4xl tracking-tight">
            We already have your response.
          </h1>
          <p className="mt-5 font-serif text-lg leading-relaxed theme-muted">
            This personal link has already been used, so there is nothing else you need to do.
          </p>
        </div>
      </main>
    );
  }

  if (state === "sent") {
    return (
      <main className="min-h-screen bg-background px-6 py-16 text-foreground">
        <div className="mx-auto max-w-xl">
          <p className="font-mono text-micro uppercase tracking-widest theme-muted">thank you</p>
          <h1 className="mt-5 font-serif text-4xl tracking-tight">That was lovely of you.</h1>
          <p className="mt-5 font-serif text-lg leading-relaxed theme-muted">
            Your answers are safely in. We will read them properly.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background px-6 py-12 text-foreground sm:py-16">
      <div className="mx-auto max-w-xl">
        <header className="border-b theme-border pb-8">
          <p className="font-mono text-micro uppercase tracking-widest theme-muted">
            milk & henny · a small question
          </p>
          <h1 className="mt-5 font-serif text-4xl leading-tight tracking-tight sm:text-5xl">
            {survey.title}
          </h1>
          <p className="mt-5 font-serif text-lg leading-relaxed theme-muted">{survey.intro}</p>
          <p className="mt-6 font-mono text-xs theme-faint">
            {requiredAnsweredCount} of {requiredCount} required answers · about 2 minutes
          </p>
        </header>

        <form onSubmit={submit} className="mt-10 space-y-10">
          {survey.questions.map((question) => (
            <QuestionField
              key={question.id}
              question={question}
              value={answers[question.id]}
              onChange={(value) => updateAnswer(question, value)}
            />
          ))}

          {survey.identityMode === "anonymous" ? (
            <div className="border-t theme-border pt-8">
              <p className="font-mono text-xs font-bold">Your response is anonymous</p>
              <p className="mt-3 font-mono text-micro theme-faint">
                We do not ask for or attach your name or email to these answers.
              </p>
            </div>
          ) : invitation ? (
            <div className="border-t theme-border pt-8">
              <p className="font-mono text-xs font-bold">Your personal survey link</p>
              <p className="mt-3 font-mono text-micro leading-relaxed theme-muted">
                Unless you choose anonymous below, these answers will be linked to{" "}
                {invitation.respondentEmail}
                so we can see who has responded.
              </p>
              {survey.identityMode === "optional" ? (
                <label className="mt-4 flex items-start gap-3 font-mono text-xs">
                  <input
                    type="checkbox"
                    checked={submitAnonymously}
                    onChange={(event) => setSubmitAnonymously(event.target.checked)}
                  />
                  <span>
                    Submit my answers anonymously. We will record that this invitation was
                    completed, but will not link me to the answers.
                  </span>
                </label>
              ) : null}
            </div>
          ) : (
            <div className="border-t theme-border pt-8">
              <p className="font-mono text-xs font-bold">Want a reply?</p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="font-mono text-micro theme-muted">name (optional)</span>
                  <input
                    name="respondentName"
                    value={respondentName}
                    onChange={(event) => setRespondentName(event.target.value)}
                    autoComplete="name"
                    className="mt-2 min-h-11 w-full rounded border theme-border bg-transparent px-3 font-mono text-base sm:text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--prose-hashtag)]"
                  />
                </label>
                <div>
                  <label className="block">
                    <span className="font-mono text-micro theme-muted">email (optional)</span>
                    <input
                      name="respondentEmail"
                      type="email"
                      value={respondentEmail}
                      onChange={(event) => setRespondentEmail(event.target.value)}
                      autoComplete="email"
                      inputMode="email"
                      className="mt-2 min-h-11 w-full rounded border theme-border bg-transparent px-3 font-mono text-base sm:text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--prose-hashtag)]"
                    />
                  </label>
                  <EmailAddressNotice
                    email={respondentEmail}
                    onAcceptSuggestion={setRespondentEmail}
                  />
                </div>
              </div>
              <p className="mt-3 font-mono text-micro theme-faint">
                We will only use this to reply about your feedback.
              </p>
            </div>
          )}

          {state === "error" ? (
            <p role="alert" className="font-mono text-xs text-[var(--prose-hashtag)]">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={state === "sending"}
            className="min-h-12 rounded bg-foreground px-5 font-mono text-xs text-background transition-opacity hover:opacity-85 disabled:cursor-wait disabled:opacity-50"
          >
            {state === "sending" ? "saving…" : "send my answers"}
          </button>
        </form>
      </div>
    </main>
  );
}

function QuestionField({
  question,
  value,
  onChange,
}: {
  question: SurveyQuestion;
  value: unknown;
  onChange: (value: string | string[]) => void;
}) {
  const id = `survey-${question.id}`;
  const label = (
    <span className="font-serif text-xl leading-snug">
      {question.label}
      {question.required ? (
        <span aria-hidden="true" className="ml-1 theme-muted">
          *
        </span>
      ) : null}
    </span>
  );
  const hint = question.hint ? (
    <span className="mt-2 block font-mono text-micro leading-relaxed theme-muted">
      {question.hint}
    </span>
  ) : null;
  if (question.type === "rating") {
    return (
      <fieldset>
        <legend>
          {label}
          {hint}
        </legend>
        <div className="mt-4 grid grid-cols-5 gap-2">
          {[1, 2, 3, 4, 5].map((rating) => (
            <label key={rating} className="cursor-pointer">
              <input
                className="peer sr-only"
                type="radio"
                name={id}
                value={rating}
                checked={value === String(rating)}
                onChange={() => onChange(String(rating))}
                required={question.required}
              />
              <span className="flex min-h-12 items-center justify-center rounded border theme-border font-mono text-sm transition-opacity peer-checked:bg-foreground peer-checked:text-background hover:opacity-70">
                {rating}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    );
  }
  if (question.type === "single_choice" || question.type === "yes_no") {
    const options = question.type === "yes_no" ? ["yes", "no"] : (question.options ?? []);
    return (
      <fieldset>
        <legend>
          {label}
          {hint}
        </legend>
        <div className="mt-4 grid gap-2">
          {options.map((option) => (
            <label
              key={option}
              className="flex min-h-12 cursor-pointer items-center gap-3 rounded border theme-border px-3 transition-opacity hover:opacity-70"
            >
              <input
                type="radio"
                name={id}
                value={option}
                checked={value === option}
                onChange={() => onChange(option)}
                required={question.required}
              />
              <span className="font-mono text-sm">{option}</span>
            </label>
          ))}
        </div>
      </fieldset>
    );
  }
  if (question.type === "multi_choice") {
    const selected = Array.isArray(value) ? value : [];
    return (
      <fieldset>
        <legend>
          {label}
          {hint}
        </legend>
        <div className="mt-4 grid gap-2">
          {(question.options ?? []).map((option) => (
            <label
              key={option}
              className="flex min-h-12 cursor-pointer items-center gap-3 rounded border theme-border px-3 transition-opacity hover:opacity-70"
            >
              <input
                type="checkbox"
                checked={selected.includes(option)}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...selected, option]
                      : selected.filter((item) => item !== option),
                  )
                }
              />
              <span className="font-mono text-sm">{option}</span>
            </label>
          ))}
        </div>
      </fieldset>
    );
  }
  if (question.type === "email") {
    const email = typeof value === "string" ? value : "";
    return (
      <div>
        <label htmlFor={id} className="block">
          <span className="block">{label}</span>
          {hint}
          <input
            id={id}
            type="email"
            name={question.id}
            value={email}
            onChange={(event) => onChange(event.target.value)}
            required={question.required}
            autoComplete="email"
            inputMode="email"
            className="mt-4 min-h-11 w-full rounded border theme-border bg-transparent px-3 font-mono text-base sm:text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--prose-hashtag)]"
          />
        </label>
        <EmailAddressNotice email={email} onAcceptSuggestion={onChange} />
      </div>
    );
  }
  return (
    <label htmlFor={id} className="block">
      <span className="block">{label}</span>
      {hint}
      <textarea
        id={id}
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.target.value)}
        required={question.required}
        rows={5}
        className="mt-4 w-full rounded border theme-border bg-transparent px-3 py-3 font-serif text-lg leading-relaxed focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--prose-hashtag)]"
      />
    </label>
  );
}
