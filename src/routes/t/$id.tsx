import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { SiteFooter, SiteFooterBar } from "@/components/SiteFooter";
import {
  describeTransferFiles,
  inferTransferTitle,
  totalTransferBytes,
} from "@/features/transfers/presentation";
import { getTransferPageFn } from "@/features/transfers/transfer.functions";
import { transferPageQuery } from "@/features/transfers/transfer.queries";
import { useTransferMetadataEvents } from "@/features/transfers/ui/transfer/useTransferMetadataEvents";
import type { AssetGroup } from "@/features/transfers/types";
import type { PublicTransferFile } from "@/features/transfers/public";
import { SITE_NAME, SITE_BRAND } from "@/lib/shared/config";
import { formatBytes } from "@/lib/shared/format";
import { buildSeoHead } from "@/lib/shared/seo";
import { TransferGallery } from "@/features/transfers/ui/transfer/TransferGallery";
import { CountdownTimer } from "@/features/transfers/ui/transfer/CountdownTimer";
import { TakedownButton } from "@/features/transfers/ui/transfer/TakedownButton";

export const Route = createFileRoute("/t/$id")({
  component: TransferPage,
  validateSearch: (search: Record<string, unknown>): { token?: string } =>
    typeof search.token === "string" ? { token: search.token } : {},
  loaderDeps: ({ search }) => ({ token: search.token }),
  loader: {
    handler: async ({ context, params, deps }) => {
      const result = deps.token
        ? await getTransferPageFn({ data: { id: params.id, token: deps.token } })
        : await context.queryClient.fetchQuery(transferPageQuery(params.id));
      const transfer = result.transfer;
      const head = transfer
        ? {
            id: transfer.id,
            title: inferTransferTitle(transfer.title, transfer.files),
            description: `${describeTransferFiles(transfer.files)} · ${formatBytes(totalTransferBytes(transfer.files))} · available until ${formatDate(transfer.expiresAt)}. Shared privately via ${SITE_NAME}.`,
          }
        : null;
      return { head, capabilityData: deps.token ? result : null };
    },
    staleReloadMode: "blocking",
  },
  staleTime: 0,
  gcTime: 0,
  preload: false,
  head: ({ loaderData }) => {
    const head = loaderData?.head;
    if (!head) {
      return buildSeoHead({
        title: `Transfer not found — ${SITE_NAME}`,
        description: "This private transfer has expired or does not exist.",
        path: "/t/not-found",
        robots: "noindex, nofollow",
        referrer: "no-referrer",
      });
    }
    return buildSeoHead({
      title: `${head.title} — ${SITE_NAME}`,
      description: head.description,
      path: `/t/${head.id}`,
      robots: "noindex, nofollow",
      referrer: "no-referrer",
      imageAlt: `Private transfer shared via ${SITE_NAME}`,
    });
  },
});

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/London",
  });
}

type TransferPageResult = Awaited<ReturnType<typeof getTransferPageFn>>;
const EMPTY_FILES: PublicTransferFile[] = [];

function useTransferExpiryRefresh(expiresAt: string | undefined, refresh: () => Promise<void>) {
  useEffect(() => {
    if (!expiresAt) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      const remaining = Date.parse(expiresAt) - Date.now() + 1_000;
      if (remaining <= 0) {
        void refresh().catch(() => undefined);
      } else {
        timer = setTimeout(schedule, Math.min(remaining, 2_147_483_647));
      }
    };
    schedule();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [expiresAt, refresh]);
}

function TransferPage() {
  const { capabilityData } = Route.useLoaderData();
  const { id } = Route.useParams();
  const { token } = Route.useSearch();
  return token && capabilityData ? (
    <CapabilityTransferPage id={id} token={token} initial={capabilityData} />
  ) : (
    <QueryTransferPage id={id} />
  );
}

function QueryTransferPage({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const query = useQuery(transferPageQuery(id));
  const [deletedId, setDeletedId] = useState<string | null>(null);
  const refetch = query.refetch;
  const refresh = useCallback(async () => {
    const result = await refetch();
    if (result.isError) throw result.error;
  }, [refetch]);
  useTransferExpiryRefresh(query.data?.transfer?.expiresAt, refresh);
  useTransferMetadataEvents({
    transferId: id,
    files: query.data?.transfer?.files ?? EMPTY_FILES,
    refresh,
  });
  const onRemoteChange = useCallback(
    (files: PublicTransferFile[], groups?: AssetGroup[]) => {
      const options = transferPageQuery(id);
      queryClient.setQueryData<TransferPageResult>(options.queryKey, (current) =>
        current?.transfer
          ? { ...current, transfer: { ...current.transfer, files, groups } }
          : current,
      );
      void queryClient.invalidateQueries({ queryKey: options.queryKey });
    },
    [id, queryClient],
  );
  const onDeleted = useCallback(() => {
    setDeletedId(id);
    queryClient.setQueryData<TransferPageResult>(transferPageQuery(id).queryKey, (current) =>
      current ? { ...current, transfer: null, remainingSeconds: 0, managementMode: null } : current,
    );
  }, [id, queryClient]);
  if (!query.data)
    return (
      <main id="main" className="p-8 font-mono text-sm">
        loading transfer…
      </main>
    );
  return (
    <TransferPageContent
      data={query.data}
      deleted={deletedId === id}
      onRemoteChange={onRemoteChange}
      onDeleted={onDeleted}
    />
  );
}

function CapabilityTransferPage({
  id,
  token,
  initial,
}: {
  id: string;
  token: string;
  initial: TransferPageResult;
}) {
  const [snapshot, setSnapshot] = useState({ id, token, data: initial });
  const [deletedFor, setDeletedFor] = useState<{ id: string; token: string } | null>(null);
  const data = snapshot.id === id && snapshot.token === token ? snapshot.data : initial;
  useEffect(() => setSnapshot({ id, token, data: initial }), [id, token, initial]);
  const refresh = useCallback(async () => {
    setSnapshot({ id, token, data: await getTransferPageFn({ data: { id, token } }) });
  }, [id, token]);
  useTransferExpiryRefresh(data.transfer?.expiresAt, refresh);
  useTransferMetadataEvents({
    transferId: id,
    files: data.transfer?.files ?? EMPTY_FILES,
    refresh,
  });
  const onRemoteChange = useCallback(
    (files: PublicTransferFile[], groups?: AssetGroup[]) =>
      setSnapshot((current) =>
        current.id === id && current.token === token && current.data.transfer
          ? {
              id,
              token,
              data: {
                ...current.data,
                transfer: { ...current.data.transfer, files, groups },
              },
            }
          : current,
      ),
    [id, token],
  );
  const onDeleted = useCallback(() => {
    setDeletedFor({ id, token });
    setSnapshot((current) => ({
      ...current,
      data: { ...current.data, transfer: null, remainingSeconds: 0, managementMode: null },
    }));
  }, [id, token]);
  return (
    <TransferPageContent
      data={data}
      token={token}
      deleted={deletedFor?.id === id && deletedFor.token === token}
      onRemoteChange={onRemoteChange}
      onDeleted={onDeleted}
    />
  );
}

function TransferPageContent({
  data,
  token,
  deleted,
  onRemoteChange,
  onDeleted,
}: {
  data: TransferPageResult;
  token?: string;
  deleted: boolean;
  onRemoteChange: (files: PublicTransferFile[], groups?: AssetGroup[]) => void;
  onDeleted: () => void;
}) {
  const { transfer, remainingSeconds, managementMode } = data;

  if (deleted) {
    return (
      <main id="main" className="min-h-screen p-8 text-center font-serif text-xl">
        transfer taken down
      </main>
    );
  }

  /* ─── Not found / expired ─── */
  if (!transfer) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <main id="main" className="text-center max-w-md space-y-6">
          <p className="font-mono text-7xl font-bold text-foreground opacity-10 leading-none">
            gone
          </p>
          <p className="font-serif text-xl text-foreground">this transfer has expired</p>
          <p className="theme-muted text-sm">
            the link you followed is no longer active. transfers are temporary — they self-destruct
            after their expiry window.
          </p>
          <div className="pt-2">
            <Link
              to="/"
              className="font-mono text-sm theme-muted hover:text-foreground transition-colors"
            >
              ← milkandhenny.com
            </Link>
          </div>
        </main>
      </div>
    );
  }

  /* ─── Expired (data still in Redis but past expiry) ─── */
  if (remainingSeconds <= 0) {
    const displayTitle = inferTransferTitle(transfer.title, transfer.files);
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <main id="main" className="text-center max-w-md space-y-6">
          <p className="font-mono text-7xl font-bold text-foreground opacity-10 leading-none">
            gone
          </p>
          <p className="font-serif text-xl text-foreground">this transfer has expired</p>
          <p className="theme-muted text-sm">
            &ldquo;{displayTitle}&rdquo; expired on {formatDate(transfer.expiresAt)}. transfers
            self-destruct automatically.
          </p>
          <div className="pt-2">
            <Link
              to="/"
              className="font-mono text-sm theme-muted hover:text-foreground transition-colors"
            >
              ← milkandhenny.com
            </Link>
          </div>
        </main>
      </div>
    );
  }

  const displayTitle = inferTransferTitle(transfer.title, transfer.files);

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="w-full max-w-4xl mx-auto px-6 pt-10 pb-6">
        <div className="flex items-center justify-between gap-3 font-mono text-sm">
          <span className="theme-muted tracking-tight">shared via</span>
          <Link
            to="/"
            className="font-bold text-foreground tracking-tighter hover:opacity-70 transition-opacity"
          >
            {SITE_BRAND}
          </Link>
        </div>
      </header>

      <div className="w-full max-w-4xl mx-auto px-6">
        <div className="border-t theme-border" />
      </div>

      <main id="main" className="flex-1">
        <section className="max-w-4xl mx-auto px-6 pt-12 pb-8" aria-label="Transfer info">
          <div className="flex items-center gap-3 font-mono text-xs theme-muted tracking-wide">
            <time>{formatDate(transfer.createdAt)}</time>
            <span className="theme-faint">·</span>
            <CountdownTimer expiresAt={transfer.expiresAt} />
          </div>
          <h1 className="font-serif text-3xl sm:text-4xl text-foreground leading-tight tracking-tight mt-3">
            {displayTitle}
          </h1>
          <p className="mt-2 theme-subtle text-sm font-mono tracking-wide">
            {describeTransferFiles(transfer.files)}
          </p>
        </section>

        <section className="max-w-4xl mx-auto px-6 pb-12" aria-label="Gallery">
          {managementMode ? (
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-y theme-border py-3 font-mono text-xs">
              <span className="theme-muted">
                {managementMode === "admin" ? "admin controls" : "owner controls"} · remove files
                from their cards or previews
              </span>
              <Link
                to="/upload"
                search={{
                  transfer: transfer.id,
                  token: managementMode === "owner" ? token : undefined,
                }}
                className="inline-flex min-h-11 items-center text-amber-600 underline underline-offset-4 transition-colors hover:text-amber-500"
              >
                add files
              </Link>
            </div>
          ) : null}
          <TransferGallery
            transferId={transfer.id}
            files={transfer.files}
            groups={transfer.groups}
            canManage={Boolean(managementMode)}
            deleteToken={managementMode === "owner" ? token : undefined}
            onRemoteChange={onRemoteChange}
            onTransferDeleted={onDeleted}
          />
        </section>

        {managementMode === "owner" || managementMode === "account" ? (
          <section className="max-w-4xl mx-auto px-6 pb-12" aria-label="Owner controls">
            <div className="border-t theme-border pt-6">
              <p className="font-mono text-micro theme-muted tracking-wide mb-3">owner controls</p>
              <TakedownButton
                transferId={transfer.id}
                deleteToken={managementMode === "owner" ? token : undefined}
                onDeleted={onDeleted}
              />
            </div>
          </section>
        ) : null}
      </main>

      <SiteFooter maxWidth="4xl">
        <SiteFooterBar
          leading={
            <span>temporary transfer · self-destructs {formatDate(transfer.expiresAt)}</span>
          }
          trailing={
            <Link to="/" className="hover:text-foreground transition-colors">
              {SITE_BRAND}
            </Link>
          }
        />
      </SiteFooter>
    </div>
  );
}
