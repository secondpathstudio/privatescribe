import { Breadcrumbs } from '@/components/ui/breadcrumb'
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/context/auth-context'
import NeoLinkButton from '@/components/neo/neo-link-button'
import NeoButton from '@/components/neo/neo-button'
import { useNavigate } from 'react-router'
import { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/components/data-table'

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

const formatDate = (value: string | null | undefined) => {
    if (!value) return '—';
    const d = new Date(value);
    return isNaN(d.getTime()) ? value : d.toLocaleDateString(undefined, { dateStyle: 'medium' });
};

const participantsLabel = (ps: NoteRow['participants']) =>
    ps.map((p) => [p.firstName, p.lastName].filter(Boolean).join(' ')).filter(Boolean).join(', ');

const Notes = () => {
    const [allNotes, setAllNotes] = useState<NoteRow[]>([]);
    const [showDeleted, setShowDeleted] = useState(false);
    const [loading, setLoading] = useState(true);
    const auth = useAuth();
    const navigate = useNavigate();

    useEffect(() => {
        const fetchNotes = async () => {
            setLoading(true);
            try {
                const response = await fetch(
                    `http://127.0.0.1:5000/api/notes/user/${auth.user?.id}?include_deleted=true`,
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

    const deletedCount = useMemo(() => allNotes.filter((n) => n.isDeleted).length, [allNotes]);

    const visibleNotes = useMemo(
        () => allNotes.filter((n) => (showDeleted ? n.isDeleted : !n.isDeleted)),
        [allNotes, showDeleted],
    );

    // Derive the unique set of templates present in the visible rows so we
    // can populate the per-column template filter without an extra fetch.
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
            // Filter shape: ColumnFiltersState stores either a string ('') or
            // a templateId. Empty string === no filter.
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
            meta: {
                searchableValue: (row: NoteRow) =>
                    `${participantsLabel(row.participants)} ${row.noteContentMarkdown ?? ''}`,
            },
        },
    ], [templateOptions]);

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

            {loading ? (
                <p>Loading...</p>
            ) : (
                <DataTable<NoteRow>
                    data={visibleNotes}
                    columns={columns}
                    initialSorting={[{ id: 'noteDate', desc: true }]}
                    searchPlaceholder='Search by template, participants, or content...'
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
