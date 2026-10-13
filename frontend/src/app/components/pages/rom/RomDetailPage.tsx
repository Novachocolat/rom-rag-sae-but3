import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowLeft, Loader2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import type { IdentificationSource, RomDetail } from '@repo/shared/types'
import { AiButton } from '@/app/components/ai/AiButton'
import { ProposalCard } from '@/app/components/ai/ProposalCard'
import { ConfidenceBadge } from '@/app/components/library/ConfidenceBadge'
import { RomStatusBadge } from '@/app/components/library/RomStatusBadge'
import { Alert, AlertDescription, AlertTitle } from '@/app/components/ui/alert'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/app/components/ui/card'
import { Skeleton } from '@/app/components/ui/skeleton'
import { useIdentifyWithAi } from '@/app/hooks/ai/useIdentifyWithAi'
import { useOllamaStatus } from '@/app/hooks/ai/useOllamaStatus'
import { useProposals } from '@/app/hooks/ai/useProposals'
import { useRom } from '@/app/hooks/library/useRom'
import { ApiError } from '@/lib/api-error'

// Says in plain words what each identification source compared to a catalog means, and how reliable it is
const SOURCE_EXPLANATION: Record<
  IdentificationSource,
  { kind: string; text: string }
> = {
  DAT_SHA1: {
    kind: 'Exact match',
    text: 'The SHA-1 of the whole file is listed in an imported catalog: this file is a known dump, byte for byte.',
  },
  DAT_MD5: {
    kind: 'Exact match',
    text: 'The MD5 of the whole file is listed in an imported catalog: this file is a known dump, byte for byte.',
  },
  DAT_SHA1_DATA: {
    kind: 'Data match',
    text: 'The whole file is in no catalog, but its game data is: once the header is skipped, its SHA-1 matches a catalog entry. Reliable, yet not an exact match.',
  },
  DAT_MD5_DATA: {
    kind: 'Data match',
    text: 'The whole file is in no catalog, but its game data is: once the header is skipped, its MD5 matches a catalog entry. Reliable, yet not an exact match.',
  },
  DAT_NAME: {
    kind: 'Name match',
    text: 'No fingerprint matched. Only the file name, once normalized, matches a catalog entry: likely, but not proven.',
  },
  AI_PROPOSED: {
    kind: 'AI proposal',
    text: 'Proposed by a language model and not verified against any catalog.',
  },
  USER_CONFIRMED: {
    kind: 'Confirmed by you',
    text: 'You accepted an AI proposal for this file. No catalog fingerprint backs this identification.',
  },
  UNIDENTIFIED: {
    kind: 'Unidentified',
    text: 'No imported catalog knows this file, neither by fingerprint nor by name.',
  },
}

// Friendlier wording for the failures a user can do something about
const IDENTIFY_ERROR_MESSAGE: Record<string, string> = {
  OLLAMA_UNAVAILABLE:
    'Ollama is unreachable: the identification could not run.',
  OLLAMA_TIMEOUT: 'The model took too long to answer. Try again later.',
  OLLAMA_MODEL_NOT_FOUND:
    'The configured model is not installed on the Ollama server.',
}

function formatBytes(bytes: number): string {
  return `${bytes.toLocaleString('en')} bytes (${(bytes / 1_000_000).toFixed(2)} MB)`
}

// Explains `headerBytesSkipped` to someone who has never heard of ROM headers
function explainHeader(headerBytesSkipped: number): string {
  if (headerBytesSkipped === 0) {
    return 'No known header was found at the start of this file, so there is nothing to skip: only the fingerprints of the whole file exist.'
  }
  return `The first ${headerBytesSkipped} bytes of this file are a header: it describes the cartridge or was added by the copier, and is not part of the game itself. Catalogs list the game data alone, so the "data" fingerprints below are computed after skipping these ${headerBytesSkipped} bytes.`
}

// Tells which fingerprint of the file a catalog hash is equal to, if any
function matchNote(
  catalogHash: string | null,
  fileHash: string | null,
  dataHash: string | null,
): string | undefined {
  if (!catalogHash) return undefined
  const hash = catalogHash.toLowerCase()
  if (hash === fileHash?.toLowerCase()) return 'equals the whole file'
  if (hash === dataHash?.toLowerCase()) return 'equals the data only'
  return undefined
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="contents">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 font-medium wrap-break-word">{children ?? '—'}</dd>
    </div>
  )
}

function Fingerprint({
  label,
  value,
  note,
}: {
  label: string
  value: string | null
  note?: string
}) {
  return (
    <Field label={label}>
      {value ? (
        <>
          <code className="font-mono text-xs break-all">{value}</code>
          {note && (
            <span className="ml-2 text-xs font-normal text-green-700">
              {note}
            </span>
          )}
        </>
      ) : null}
    </Field>
  )
}

const FIELD_LIST = 'grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5'

// Section to ask the AI for a proposal and to review everything it proposed
function AiSection({ rom }: { rom: RomDetail }) {
  const ollama = useOllamaStatus()
  const proposals = useProposals({ romId: rom.id, status: 'ALL', pageSize: 50 })
  const identify = useIdentifyWithAi()

  const history = proposals.data?.data ?? []
  const hasPending = history.some((proposal) => proposal.status === 'PENDING')
  const isUnidentified = rom.identificationSource === 'UNIDENTIFIED'

  function identifyRom() {
    identify.mutate(rom.id, {
      onSuccess: (proposal) => {
        if (proposal.status === 'PENDING') {
          toast.success('The AI made a proposal: review it below.')
        } else {
          toast.warning(
            'The AI answered, but its proposal was discarded automatically. The history below says why.',
          )
        }
      },
      onError: (error) => {
        toast.error(
          error instanceof ApiError
            ? (IDENTIFY_ERROR_MESSAGE[error.code] ?? error.message)
            : 'The identification failed.',
        )
      },
    })
  }

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">AI identification</h2>
        <p className="text-sm text-muted-foreground">
          An AI proposal is a hypothesis, never a fact: it changes nothing on
          this ROM until you accept it.
        </p>
      </div>

      {isUnidentified && !hasPending && (
        <div className="space-y-2">
          <AiButton
            disabled={identify.isPending || proposals.isLoading}
            onClick={identifyRom}
          >
            {identify.isPending ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Sparkles />
            )}
            {identify.isPending ? 'Asking the model…' : 'Identify with AI'}
          </AiButton>
          {!ollama.isUp && (
            <p className="text-xs text-muted-foreground">
              {ollama.disabledReason}
            </p>
          )}
          {identify.isPending && (
            <p className="text-xs text-muted-foreground">
              An inference can take up to a couple of minutes.
            </p>
          )}
        </div>
      )}
      {isUnidentified && hasPending && (
        <p className="text-sm text-muted-foreground">
          A proposal is awaiting your review: accept or reject it before asking
          for another one.
        </p>
      )}
      {!isUnidentified && (
        <p className="text-sm text-muted-foreground">
          This ROM is already identified, so the AI cannot be asked about it.
        </p>
      )}

      <h3 className="text-sm font-semibold">Proposal history</h3>
      {proposals.isLoading && <Skeleton className="h-40 w-full" />}
      {proposals.isError && (
        <Alert variant="destructive">
          <AlertTitle>The proposal history could not be loaded</AlertTitle>
          <AlertDescription>{proposals.error.message}</AlertDescription>
        </Alert>
      )}
      {proposals.isSuccess && history.length === 0 && (
        <p className="text-sm text-muted-foreground">
          The AI has not proposed anything for this ROM yet.
        </p>
      )}
      {history.map((proposal) => (
        <ProposalCard key={proposal.id} proposal={proposal} />
      ))}
    </section>
  )
}

// Page for users to read everything known about one ROM: its metadata, its
// fingerprints, the catalog entry it matched and what the AI proposed for it
export function RomDetailPage() {
  const { id } = useParams()
  const { data: rom, isLoading, error } = useRom(id)

  const backLink = (
    <Link
      to="/"
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" />
      Back to the library
    </Link>
  )

  if (isLoading) {
    return (
      <div className="space-y-4">
        {backLink}
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (!rom) {
    const notFound = error instanceof ApiError && error.statusCode < 500
    return (
      <div className="space-y-4">
        {backLink}
        <Alert variant="destructive">
          <AlertTitle>
            {notFound ? 'ROM not found' : 'This ROM could not be loaded'}
          </AlertTitle>
          <AlertDescription>
            {notFound
              ? 'It does not exist, or it was removed by a later scan.'
              : (error?.message ?? 'Unknown error')}
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  const explanation = SOURCE_EXPLANATION[rom.identificationSource]
  const isUnidentified = rom.identificationSource === 'UNIDENTIFIED'
  const { datEntry } = rom

  return (
    <div className="space-y-6">
      {backLink}

      <header className="space-y-2">
        <h1 className="text-2xl font-semibold wrap-break-word">
          {rom.title ?? rom.fileName}
        </h1>
        <div className="flex flex-wrap items-center gap-3">
          <RomStatusBadge source={rom.identificationSource} />
          <ConfidenceBadge
            confidence={isUnidentified ? null : rom.confidence}
          />
        </div>
        <p className="max-w-3xl text-sm text-muted-foreground">
          <span className="font-medium text-foreground">
            {explanation.kind}.
          </span>{' '}
          {explanation.text}
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Metadata</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className={FIELD_LIST}>
              <Field label="Title">{rom.title}</Field>
              <Field label="Platform">{rom.platformName}</Field>
              <Field label="Region">{rom.region}</Field>
              <Field label="Languages">
                {rom.languages.join(', ') || null}
              </Field>
              <Field label="Release year">{rom.releaseYear}</Field>
              <Field label="Publisher">{rom.publisher}</Field>
              <Field label="Genre">{rom.genre}</Field>
              <Field label="Summary">{rom.summary}</Field>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>File</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className={FIELD_LIST}>
              <Field label="Path">
                <code className="font-mono text-xs break-all">
                  {rom.relativePath}
                </code>
              </Field>
              <Field label="File name">{rom.fileName}</Field>
              <Field label="Extension">{rom.extension}</Field>
              <Field label="Size">{formatBytes(rom.sizeBytes)}</Field>
              <Field label="First seen">
                {new Date(rom.firstSeenAt).toLocaleString()}
              </Field>
              <Field label="Last scanned">
                {new Date(rom.lastScannedAt).toLocaleString()}
              </Field>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Fingerprints</CardTitle>
            <CardDescription>
              {explainHeader(rom.headerBytesSkipped)}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase">
                Whole file
              </h3>
              <dl className={FIELD_LIST}>
                <Fingerprint label="SHA-1" value={rom.sha1} />
                <Fingerprint label="MD5" value={rom.md5} />
                <Fingerprint label="CRC32" value={rom.crc32} />
              </dl>
            </div>
            <div className="space-y-1.5">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase">
                Data only
                {rom.headerBytesSkipped > 0 &&
                  ` (first ${rom.headerBytesSkipped} bytes skipped)`}
              </h3>
              <dl className={FIELD_LIST}>
                <Fingerprint label="SHA-1" value={rom.sha1Data} />
                <Fingerprint label="MD5" value={rom.md5Data} />
                <Field label="Header bytes skipped">
                  {rom.headerBytesSkipped}
                </Field>
              </dl>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Matching catalog entry</CardTitle>
            <CardDescription>
              {datEntry
                ? `From ${datEntry.datFileName}${datEntry.datVersion ? ` (version ${datEntry.datVersion})` : ''}.`
                : 'No entry of an imported DAT catalog is linked to this file.'}
            </CardDescription>
          </CardHeader>
          {datEntry && (
            <CardContent>
              <dl className={FIELD_LIST}>
                <Field label="Game">{datEntry.gameName}</Field>
                <Field label="ROM name">{datEntry.romName}</Field>
                <Field label="Description">{datEntry.description}</Field>
                <Field label="Size">{formatBytes(datEntry.sizeBytes)}</Field>
                <Field label="Dump status">{datEntry.status}</Field>
                <Fingerprint
                  label="SHA-1"
                  value={datEntry.sha1}
                  note={matchNote(datEntry.sha1, rom.sha1, rom.sha1Data)}
                />
                <Fingerprint
                  label="MD5"
                  value={datEntry.md5}
                  note={matchNote(datEntry.md5, rom.md5, rom.md5Data)}
                />
                <Fingerprint label="CRC32" value={datEntry.crc} />
              </dl>
            </CardContent>
          )}
        </Card>
      </div>

      <AiSection rom={rom} />
    </div>
  )
}
