import { useEffect, useMemo, useState } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { useAuth } from '@/context/auth-context';
import { DataTable } from '@/components/data-table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import NeoButton from '@/components/neo/neo-button';
import SectionHeader from './sections/SectionHeader';

type AuditEntry = {
    id: string;
    userId: string | null;
    userEmail: string | null;
    userRole: string | null;
    action: string;
    resourceType: string | null;
    resourceId: string | null;
    status: string;
    ipAddress: string | null;
    userAgent: string | null;
    extra: Record<string, unknown> | null;
    createdAt: string;
};

const PAGE_SIZE = 100;

const formatDateTime = (value: string | null | undefined) => {
    if (!value) return '—';
    const d = new Date(value);
    return isNaN(d.getTime())
        ? value
        : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

const statusColor = (status: string) =>
    status === 'failure' ? 'text-[#fd3777] font-semibold' : 'text-muted-foreground';

const AuditLogPage = () => {
    const auth = useAuth();
    const [entries, setEntries] = useState<AuditEntry[]>([]);
    const [total, setTotal] = useState(0);
    const [offset, setOffset] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [actions, setActions] = useState<string[]>([]);
    const [selectedRow, setSelectedRow] = useState<AuditEntry | null>(null);

    // Server-side filters. Kept separate from the DataTable's client-side
    // search/sort so admins can narrow the result set before pulling rows.
    const [filterAction, setFilterAction] = useState('');
    const [filterUserEmail, setFilterUserEmail] = useState('');
    const [filterResourceType, setFilterResourceType] = useState('');
    const [filterStatus, setFilterStatus] = useState('');
    const [filterSince, setFilterSince] = useState('');
    const [filterUntil, setFilterUntil] = useState('');

    const queryString = useMemo(() => {
        const params = new URLSearchParams();
        if (filterAction) params.set('action', filterAction);
        if (filterUserEmail) params.set('user_email', filterUserEmail);
        if (filterResourceType) params.set('resource_type', filterResourceType);
        if (filterStatus) params.set('status', filterStatus);
        if (filterSince) params.set('since', new Date(filterSince).toISOString());
        if (filterUntil) params.set('until', new Date(filterUntil).toISOString());
        params.set('limit', String(PAGE_SIZE));
        params.set('offset', String(offset));
        return params.toString();
    }, [filterAction, filterUserEmail, filterResourceType, filterStatus, filterSince, filterUntil, offset]);

    useEffect(() => {
        const fetchEntries = async () => {
            setLoading(true);
            setError(null);
            try {
                const res = await fetch(`http://127.0.0.1:5000/api/admin/audit-log?${queryString}`, {
                    headers: { Authorization: `Bearer ${auth.token}` },
                });
                if (!res.ok) throw new Error(`Server error: ${res.status}`);
                const data = await res.json();
                setEntries(data.entries ?? []);
                setTotal(data.total ?? 0);
            } catch (e) {
                setError(e instanceof Error ? e.message : 'Failed to load audit log');
            } finally {
                setLoading(false);
            }
        };
        fetchEntries();
    }, [auth.token, queryString]);

    useEffect(() => {
        const fetchActions = async () => {
            try {
                const res = await fetch('http://127.0.0.1:5000/api/admin/audit-log/actions', {
                    headers: { Authorization: `Bearer ${auth.token}` },
                });
                if (!res.ok) return;
                const data = await res.json();
                setActions(data.actions ?? []);
            } catch {
                // The dropdown is a convenience — if it fails, admins can still
                // type the action key into the underlying filter.
            }
        };
        fetchActions();
    }, [auth.token]);

    const resetFilters = () => {
        setFilterAction('');
        setFilterUserEmail('');
        setFilterResourceType('');
        setFilterStatus('');
        setFilterSince('');
        setFilterUntil('');
        setOffset(0);
    };

    const columns = useMemo<ColumnDef<AuditEntry, unknown>[]>(() => [
        {
            accessorKey: 'createdAt',
            header: 'When',
            size: 180,
            sortingFn: (a, b) =>
                new Date(a.original.createdAt).getTime() -
                new Date(b.original.createdAt).getTime(),
            cell: ({ row }) => (
                <span className='whitespace-nowrap'>{formatDateTime(row.original.createdAt)}</span>
            ),
        },
        {
            accessorKey: 'userEmail',
            header: 'User',
            size: 220,
            cell: ({ row }) => (
                <span className='truncate' title={row.original.userId ?? ''}>
                    {row.original.userEmail ?? <em className='text-muted-foreground'>—</em>}
                </span>
            ),
        },
        {
            accessorKey: 'userRole',
            header: 'Role',
            size: 90,
            cell: ({ row }) =>
                row.original.userRole ? (
                    <span className='text-xs uppercase font-semibold tracking-wide'>
                        {row.original.userRole}
                    </span>
                ) : (
                    <span className='text-muted-foreground'>—</span>
                ),
        },
        {
            accessorKey: 'action',
            header: 'Action',
            size: 180,
            cell: ({ row }) => <code className='text-xs'>{row.original.action}</code>,
        },
        {
            id: 'resource',
            header: 'Resource',
            size: 240,
            accessorFn: (row) =>
                row.resourceType ? `${row.resourceType}:${row.resourceId ?? ''}` : '',
            cell: ({ row }) =>
                row.original.resourceType ? (
                    <span className='text-xs truncate'>
                        <span className='font-semibold'>{row.original.resourceType}</span>
                        {row.original.resourceId && <> · {row.original.resourceId}</>}
                    </span>
                ) : (
                    <span className='text-muted-foreground'>—</span>
                ),
        },
        {
            accessorKey: 'status',
            header: 'Status',
            size: 100,
            cell: ({ row }) => (
                <span className={statusColor(row.original.status)}>{row.original.status}</span>
            ),
        },
        {
            accessorKey: 'ipAddress',
            header: 'IP',
            size: 130,
            cell: ({ row }) => (
                <span className='text-xs text-muted-foreground'>
                    {row.original.ipAddress ?? '—'}
                </span>
            ),
        },
    ], []);

    return (
        <div className='space-y-6'>
            <SectionHeader
                title='Audit Log'
                description='Every login, note, template, participant, and admin action is recorded.'
            />

            <div className='border-2 border-black bg-white p-4 grid grid-cols-1 md:grid-cols-3 gap-3'>
                <div>
                    <Label htmlFor='filter-action' className='font-black text-xs'>Action</Label>
                    <select
                        id='filter-action'
                        value={filterAction}
                        onChange={(e) => { setFilterAction(e.target.value); setOffset(0); }}
                        className='w-full border border-black/30 rounded text-sm px-2 py-1 bg-white'
                    >
                        <option value=''>All actions</option>
                        {actions.map((a) => (
                            <option key={a} value={a}>{a}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <Label htmlFor='filter-email' className='font-black text-xs'>User email</Label>
                    <Input
                        id='filter-email'
                        value={filterUserEmail}
                        onChange={(e) => { setFilterUserEmail(e.target.value); setOffset(0); }}
                        placeholder='exact match'
                    />
                </div>
                <div>
                    <Label htmlFor='filter-resource' className='font-black text-xs'>Resource type</Label>
                    <select
                        id='filter-resource'
                        value={filterResourceType}
                        onChange={(e) => { setFilterResourceType(e.target.value); setOffset(0); }}
                        className='w-full border border-black/30 rounded text-sm px-2 py-1 bg-white'
                    >
                        <option value=''>Any</option>
                        <option value='note'>note</option>
                        <option value='template'>template</option>
                        <option value='participant'>participant</option>
                        <option value='user'>user</option>
                        <option value='audio_file'>audio_file</option>
                        <option value='setting'>setting</option>
                        <option value='ollama_model'>ollama_model</option>
                    </select>
                </div>
                <div>
                    <Label htmlFor='filter-status' className='font-black text-xs'>Status</Label>
                    <select
                        id='filter-status'
                        value={filterStatus}
                        onChange={(e) => { setFilterStatus(e.target.value); setOffset(0); }}
                        className='w-full border border-black/30 rounded text-sm px-2 py-1 bg-white'
                    >
                        <option value=''>Any</option>
                        <option value='success'>success</option>
                        <option value='failure'>failure</option>
                    </select>
                </div>
                <div>
                    <Label htmlFor='filter-since' className='font-black text-xs'>From</Label>
                    <Input
                        id='filter-since'
                        type='datetime-local'
                        value={filterSince}
                        onChange={(e) => { setFilterSince(e.target.value); setOffset(0); }}
                    />
                </div>
                <div>
                    <Label htmlFor='filter-until' className='font-black text-xs'>To</Label>
                    <Input
                        id='filter-until'
                        type='datetime-local'
                        value={filterUntil}
                        onChange={(e) => { setFilterUntil(e.target.value); setOffset(0); }}
                    />
                </div>
                <div className='md:col-span-3 flex items-center justify-between'>
                    <NeoButton
                        onClick={resetFilters}
                        backgroundColor='#ffffff'
                        textColor='#000000'
                    >
                        Reset filters
                    </NeoButton>
                    <span className='text-sm text-muted-foreground'>
                        Showing {entries.length} of {total} {total === 1 ? 'entry' : 'entries'}
                    </span>
                </div>
            </div>

            {error && <p className='text-red-600'>{error}</p>}
            {loading ? (
                <p>Loading audit log...</p>
            ) : (
                <>
                    <DataTable<AuditEntry>
                        data={entries}
                        columns={columns}
                        initialSorting={[{ id: 'createdAt', desc: true }]}
                        searchPlaceholder='Search within this page...'
                        emptyState='No audit entries match these filters.'
                        onRowClick={(row) => setSelectedRow(row)}
                    />
                    <div className='flex items-center justify-between'>
                        <NeoButton
                            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                            backgroundColor='#ffffff'
                            textColor='#000000'
                            disabled={offset === 0}
                        >
                            ← Previous
                        </NeoButton>
                        <span className='text-sm text-muted-foreground'>
                            Page {Math.floor(offset / PAGE_SIZE) + 1} of {Math.max(1, Math.ceil(total / PAGE_SIZE))}
                        </span>
                        <NeoButton
                            onClick={() => setOffset(offset + PAGE_SIZE)}
                            backgroundColor='#ffffff'
                            textColor='#000000'
                            disabled={offset + PAGE_SIZE >= total}
                        >
                            Next →
                        </NeoButton>
                    </div>
                </>
            )}

            {selectedRow && (
                <div
                    className='fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4'
                    onClick={() => setSelectedRow(null)}
                >
                    <div
                        className='bg-white border-2 border-black max-w-2xl w-full max-h-[80vh] overflow-auto p-6 space-y-3'
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className='flex items-center justify-between'>
                            <h2 className='text-2xl font-black'>Audit entry</h2>
                            <button
                                onClick={() => setSelectedRow(null)}
                                className='text-2xl leading-none px-2 hover:bg-muted/40'
                            >
                                ×
                            </button>
                        </div>
                        <dl className='grid grid-cols-[120px_1fr] gap-y-1 text-sm'>
                            <dt className='font-semibold'>When</dt>
                            <dd>{formatDateTime(selectedRow.createdAt)}</dd>
                            <dt className='font-semibold'>Action</dt>
                            <dd><code>{selectedRow.action}</code></dd>
                            <dt className='font-semibold'>Status</dt>
                            <dd className={statusColor(selectedRow.status)}>{selectedRow.status}</dd>
                            <dt className='font-semibold'>User</dt>
                            <dd>{selectedRow.userEmail ?? '—'} <span className='text-muted-foreground text-xs'>({selectedRow.userId ?? 'no user'})</span></dd>
                            <dt className='font-semibold'>Resource</dt>
                            <dd>
                                {selectedRow.resourceType ? (
                                    <>
                                        <span className='font-semibold'>{selectedRow.resourceType}</span>
                                        {selectedRow.resourceId && <> · {selectedRow.resourceId}</>}
                                    </>
                                ) : '—'}
                            </dd>
                            <dt className='font-semibold'>IP</dt>
                            <dd>{selectedRow.ipAddress ?? '—'}</dd>
                            <dt className='font-semibold'>User-Agent</dt>
                            <dd className='break-all text-xs text-muted-foreground'>{selectedRow.userAgent ?? '—'}</dd>
                        </dl>
                        {selectedRow.extra && Object.keys(selectedRow.extra).length > 0 && (
                            <div>
                                <p className='font-semibold text-sm mb-1'>Details</p>
                                <pre className='text-xs bg-muted/40 border border-black/20 p-2 overflow-auto'>
                                    {JSON.stringify(selectedRow.extra, null, 2)}
                                </pre>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default AuditLogPage;
