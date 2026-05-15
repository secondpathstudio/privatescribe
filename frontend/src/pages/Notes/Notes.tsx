import { API_BASE } from "@/lib/api";
import { Breadcrumbs } from '@/components/ui/breadcrumb'
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/context/auth-context'
import NeoLinkButton from '@/components/neo/neo-link-button'
import NeoButton from '@/components/neo/neo-button'
import { useNavigate } from 'react-router'
import { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/components/data-table'
import { Input } from '@/components/ui/input'
import { Search, X } from 'lucide-react'

type NoteRow = {
    id: string;
    noteDate: string;
    createdAt: string;
    updatedAt: string;
    noteContentMarkdown: string;
    noteType: string;
    templateId: number | null;
    templateName: string | null;
    participants: { id: string; firstName: string; lastName: string }[];
    isDeleted: boolean;
    isDeletedTimestamp: string | null;
};

type SearchResult = {
    id: string;
    noteDate: string;
    createdAt: string;
    updatedAt: string;
    templateId: number | null;
    templateName: string | null;
    noteType: string;
    isDeleted: boolean;
    isDeletedTimestamp: string | null;
    participants: { id: string; firstName: string; lastName: string }[];
    rawSnippet: string;
    markdownSnippet: string;
};

const formatDate = (value: string | null | undefined) => {
    if (!value) return '—';
    const d = new Date(value);
    return isNaN(d.getTime()) ? value : d.toLocaleDateString(undefined, { dateStyle: 'medium' });
};

const participantsLabel = (ps: NoteRow['participants']) =>
    ps.map((p) => [p.firstName, p.lastName].filter(Boolean).join(' ')).filter(Boolean).join(', ');

// Backend wraps each match in STX () / ETX () so we can split
// safely without using dangerouslySetInnerHTML. React text rendering escapes
// the surrounding segments for us.
const HIGHLIGHT_OPEN = '';
const HIGHLIGHT_CLOSE = '';

const HighlightedSnippet = ({ text }: { text: string }) => {
    if (!text) return <span className='text-muted-foreground italic'>(no match preview)</span>;
    const parts: React.ReactNode[] = [];
    let cursor = 0;
    let key = 0;
    while (cursor < text.length) {
        const openIdx = text.indexOf(HIGHLIGHT_OPEN, cursor);
        if (openIdx === -1) {
            parts.push(<span key={key++}>{text.slice(cursor)}</span>);
            break;
        }
        if (openIdx > cursor) {
            parts.push(<span key={key++}>{text.slice(cursor, openIdx)}</span>);
        }
        const closeIdx = text.indexOf(HIGHLIGHT_CLOSE, openIdx + 1);
        if (closeIdx === -1) {
            // Malformed — render rest as plain text.
            parts.push(<span key={key++}>{text.slice(openIdx + 1)}</span>);
            break;
        }
        parts.push(
            <mark key={key++} className='bg-yellow-200 px-0.5 rounded-sm'>
                {text.slice(openIdx + 1, closeIdx)}
            </mark>,
        );
        cursor = closeIdx + 1;
    }
    return <>{parts}</>;
};

const Notes = () => {
    const [allNotes, setAllNotes] = useState<NoteRow[]>([]);
    const [showDeleted, setShowDeleted] = useState(false);
    const [loading, setLoading] = useState(true);

    // Server-side full-text search state. Active when the trimmed query has
    // 2+ chars — below that the regular list is shown.
    const [searchInput, setSearchInput] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
    const [searchLoading, setSearchLoading] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);

    const auth = useAuth();
    const navigate = useNavigate();

    useEffect(() => {
        const fetchNotes = async () => {
            setLoading(true);
            try {
                const response = await fetch(
                    `${API_BASE}/api/notes/user/${auth.user?.id}?include_deleted=true`,
                    {
                        method: 'GET',
                        headers: {
                            'Content-Type': 'application/json',
                            Authorization: `Bearer ${auth.token}`,
                        },
                    },
                );
                if (!response.ok) {
                    throw new Error('Network request failed with status ' + response.status);
                }
                const data = await response.json();
                setAllNotes(Array.isArray(data) ? data : []);
            } catch (error) {
                console.log('Error fetching notes: ', error);
                setAllNotes([]);
            }
            setLoading(false);
        };
        fetchNotes();
    }, [auth.token, auth.user?.id]);

    // Debounce the search input. 250ms is the sweet spot between feeling
    // responsive and not slamming the server with a request per keystroke.
    useEffect(() => {
        const handle = setTimeout(() => setSearchQuery(searchInput.trim()), 250);
        return () => clearTimeout(handle);
    }, [searchInput]);

    // Fetch search results whenever the debounced query (or showDeleted toggle)
    // changes. Each effect run owns an AbortController so an in-flight request
    // can't write stale results over a newer one.
    useEffect(() => {
        if (searchQuery.length < 2) {
            setSearchResults([]);
            setSearchLoading(false);
            setSearchError(null);
            return;
        }
        const controller = new AbortController();
        setSearchLoading(true);
        setSearchError(null);
        const params = new URLSearchParams({
            q: searchQuery,
            include_deleted: showDeleted ? 'true' : 'false',
        });
        fetch(`${API_BASE}/api/notes/search?${params.toString()}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${auth.token}`,
            },
            signal: controller.signal,
        })
            .then(async (r) => {
                if (!r.ok) throw new Error('Search failed: ' + r.status);
                return r.json();
            })
            .then((data: SearchResult[]) => {
                setSearchResults(Array.isArray(data) ? data : []);
                setSearchLoading(false);
            })
            .catch((err) => {
                if (err.name === 'AbortError') return;
                console.log('search error', err);
                setSearchResults([]);
                setSearchError('Search failed. Try again.');
                setSearchLoading(false);
            });
        return () => controller.abort();
    }, [searchQuery, showDeleted, auth.token]);

    const deletedCount = useMemo(() => allNotes.filter((n) => n.isDeleted).length, [allNotes]);

    const visibleNotes = useMemo(
        () => allNotes.filter((n) => (showDeleted ? n.isDeleted : !n.isDeleted)),
        [allNotes, showDeleted],
    );

    const templateOptions = useMemo(() => {
        const seen = new Map<string, string>();
        for (const n of visibleNotes) {
            if (n.templateId && n.templateName) {
                seen.set(String(n.templateId), n.templateName);
            }
        }
        return Array.from(seen, ([id, name]) => ({ id, name })).sort((a, b) =>
            a.name.localeCompare(b.name),
        );
    }, [visibleNotes]);

    const columns = useMemo<ColumnDef<NoteRow, unknown>[]>(() => [
        {
            accessorKey: 'noteDate',
            header: 'Date',
            size: 140,
            sortingFn: (a, b) => new Date(a.original.noteDate).getTime() - new Date(b.original.noteDate).getTime(),
            cell: ({ row }) => <span>{formatDate(row.original.noteDate)}</span>,
        },
        {
            id: 'templateName',
            accessorFn: (row) => row.templateName ?? '',
            header: 'Template',
            size: 200,
            filterFn: (row, _id, value) => {
                if (!value) return true;
                return String(row.original.templateId ?? '') === String(value);
            },
            cell: ({ row }) => (
                <span className={row.original.templateName ? '' : 'text-muted-foreground italic'}>
                    {row.original.templateName ?? 'No template'}
                </span>
            ),
            meta: {
                filterElement: (column) => (
                    <select
                        value={(column.getFilterValue() as string) ?? ''}
                        onChange={(e) => column.setFilterValue(e.target.value || undefined)}
                        onClick={(e) => e.stopPropagation()}
                        className='border border-black/30 rounded text-xs px-1 py-0.5 bg-white'
                    >
                        <option value=''>All templates</option>
                        {templateOptions.map((t) => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                    </select>
                ),
            },
        },
        {
            id: 'participants',
            accessorFn: (row) => participantsLabel(row.participants),
            header: 'Participants',
            sortingFn: (a, b) => a.original.participants.length - b.original.participants.length,
            cell: ({ row }) => {
                const label = participantsLabel(row.original.participants);
                return label ? (
                    <span className='truncate'>{label}</span>
                ) : (
                    <span className='text-muted-foreground italic'>None</span>
                );
            },
        },
    ], [templateOptions]);

    const searchActive = searchQuery.length >= 2;

    return (
        <div className='px-6 py-8'>
            <Breadcrumbs notes={[{ label: 'All Notes' }]} />

            <div className='flex justify-between items-center mb-6'>
                <h1 className='text-4xl font-black mt-6'>All Notes</h1>
                <NeoLinkButton
                    route='/notes/new'
                    label='📝 Create Note'
                    backgroundColor='#fd3777'
                    textColor='#ffffff'
                />
            </div>

            {/* Server-side full-text search. Empty/short query falls back to
                the regular list view below. */}
            <div className='relative max-w-xl mb-4'>
                <Search className='absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground' size={16} />
                <Input
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    placeholder='Search note content (transcripts and formatted notes)...'
                    className='pl-8 pr-8'
                />
                {searchInput && (
                    <button
                        type='button'
                        onClick={() => setSearchInput('')}
                        className='absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground'
                        aria-label='Clear search'
                    >
                        <X size={16} />
                    </button>
                )}
            </div>

            {loading ? (
                <p>Loading...</p>
            ) : searchActive ? (
                <div className='border-2 border-black bg-white'>
                    <div className='px-3 py-2 border-b-2 border-black bg-muted/30 text-sm font-semibold flex justify-between'>
                        <span>
                            {searchLoading
                                ? 'Searching…'
                                : `${searchResults.length} match${searchResults.length === 1 ? '' : 'es'} for “${searchQuery}”`}
                        </span>
                        {showDeleted && <span className='text-[#fd3777] italic'>Searching deleted notes</span>}
                    </div>
                    {searchError && (
                        <div className='p-4 text-sm text-red-600'>{searchError}</div>
                    )}
                    {!searchError && !searchLoading && searchResults.length === 0 && (
                        <div className='p-8 text-center text-muted-foreground'>
                            No matches. Try a shorter query or different words.
                        </div>
                    )}
                    {searchResults.map((r) => (
                        <button
                            key={r.id}
                            type='button'
                            onClick={() => navigate(`/notes/${r.id}`)}
                            className='block w-full text-left px-3 py-3 border-b last:border-b-0 hover:bg-muted/40'
                        >
                            <div className='flex justify-between items-center mb-1'>
                                <span className='font-semibold text-sm'>
                                    {r.templateName ?? <span className='italic text-muted-foreground'>No template</span>}
                                </span>
                                <span className='text-xs text-muted-foreground'>{formatDate(r.noteDate)}</span>
                            </div>
                            {participantsLabel(r.participants) && (
                                <div className='text-xs text-muted-foreground mb-1'>
                                    {participantsLabel(r.participants)}
                                </div>
                            )}
                            <div className='text-sm whitespace-pre-wrap break-words'>
                                <HighlightedSnippet text={r.markdownSnippet || r.rawSnippet} />
                            </div>
                            {r.rawSnippet && r.markdownSnippet && r.rawSnippet !== r.markdownSnippet && (
                                <div className='text-xs text-muted-foreground mt-1 whitespace-pre-wrap break-words'>
                                    <span className='italic'>Transcript: </span>
                                    <HighlightedSnippet text={r.rawSnippet} />
                                </div>
                            )}
                        </button>
                    ))}
                </div>
            ) : (
                <DataTable<NoteRow>
                    data={visibleNotes}
                    columns={columns}
                    initialSorting={[{ id: 'noteDate', desc: true }]}
                    hideSearch
                    emptyState={showDeleted ? 'No deleted notes.' : 'No notes yet — create one to get started.'}
                    onRowClick={(row) => navigate(`/notes/${row.id}`)}
                />
            )}

            <div className='mt-6 w-full flex flex-col justify-center items-center gap-2'>
                {showDeleted && (
                    <p className='text-sm italic text-[#fd3777]'>
                        Deleted notes stay in the trash until they're permanently deleted.
                        How long they must be kept first is set by your admin's retention policy.
                    </p>
                )}
                <NeoButton
                    onClick={() => setShowDeleted((prev) => !prev)}
                    label={
                        showDeleted
                            ? 'Show Active Notes'
                            : `${deletedCount} Deleted Note${deletedCount === 1 ? '' : 's'}`
                    }
                    disabled={!showDeleted && deletedCount === 0}
                />
            </div>
        </div>
    );
};

export default Notes;
