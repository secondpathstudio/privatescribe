import { API_BASE } from "@/lib/api";
import { useEffect, useMemo, useState } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { useAuth } from '@/context/auth-context';
import { DataTable } from '@/components/data-table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import NeoButton from '@/components/neo/neo-button';
import AuditRetentionCard from '@/components/admin/AuditRetentionCard';
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

// Emergency-access (GAP-08) events get flagged prominently in the trail: an
// admin reaching another user's note outside normal author scoping is exactly
// what an auditor needs to spot at a glance.
const isBreakGlass = (action: string) => action.startsWith('note.break_glass');

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

    const [exporting, setExporting] = useState(false);

    // Just the server-side filters — shared by the paginated fetch and the
    // (un-paginated) export so both always slice the trail the same way.
    const filterQuery = useMemo(() => {
        const params = new URLSearchParams();
        if (filterAction) params.set('action', filterAction);
        if (filterUserEmail) params.set('user_email', filterUserEmail);
        if (filterResourceType) params.set('resource_type', filterResourceType);
        if (filterStatus) params.set('status', filterStatus);
        if (filterSince) params.set('since', new Date(filterSince).toISOString());
        if (filterUntil) params.set('until', new Date(filterUntil).toISOString());
        return params.toString();
    }, [filterAction, filterUserEmail, filterResourceType, filterStatus, filterSince, filterUntil]);

    const queryString = useMemo(() => {
        const params = new URLSearchParams(filterQuery);
        params.set('limit', String(PAGE_SIZE));
        params.set('offset', String(offset));
        return params.toString();
    }, [filterQuery, offset]);

    useEffect(() => {
        const fetchEntries = async () => {
            setLoading(true);
            setError(null);
            try {
                const res = await fetch(`${API_BASE}/api/admin/audit-log?${queryString}`, {
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
                const res = await fetch(`${API_BASE}/api/admin/audit-log/actions`, {
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

    // Download the whole filtered trail in one file. The endpoint needs the
    // bearer token, so we fetch into a blob and trigger the save ourselves
    // rather than using a plain anchor link.
    const handleExport = async (format: 'csv' | 'json') => {
        setExporting(true);
        setError(null);
        try {
            const params = new URLSearchParams(filterQuery);
            params.set('format', format);
            const res = await fetch(
                `${API_BASE}/api/admin/audit-log/export?${params.toString()}`,
                { headers: { Authorization: `Bearer ${auth.token}` } },
            );
            if (!res.ok) throw new Error(`Server error: ${res.status}`);
            const blob = await res.blob();
            const disposition = res.headers.get('Content-Disposition') ?? '';
            const match = disposition.match(/filename="?([^"]+)"?/);
            const filename = match ? match[1] : `audit-log.${format}`;
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Export failed');
        } finally {
            setExporting(false);
        }
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
            cell: ({ row }) =>
                isBreakGlass(row.original.action) ? (
                    <span className='inline-flex items-center gap-1.5'>
                        <span className='text-[10px] font-black uppercase tracking-wide bg-[#fd3777] text-white px-1.5 py-0.5 border-2 border-black'>
                            ⚠ Break-glass
                        </span>
                        <code className='text-xs'>{row.original.action}</code>
                    </span>
                ) : (
                    <code className='text-xs'>{row.original.action}</code>
                ),
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
                <div className='md:col-span-3 flex flex-wrap items-center justify-between gap-2'>
                    <div className='flex flex-wrap items-center gap-2'>
                        <NeoButton
                            onClick={resetFilters}
                            backgroundColor='#ffffff'
                            textColor='#000000'
                        >
                            Reset filters
                        </NeoButton>
                        <NeoButton
                            onClick={() => handleExport('csv')}
                            backgroundColor='#000000'
                            textColor='#ffffff'
                            disabled={exporting}
                        >
                            {exporting ? 'Exporting…' : 'Export CSV'}
                        </NeoButton>
                        <NeoButton
                            onClick={() => handleExport('json')}
                            backgroundColor='#000000'
                            textColor='#ffffff'
                            disabled={exporting}
                        >
                            Export JSON
                        </NeoButton>
                    </div>
                    <span className='text-sm text-muted-foreground'>
                        Showing {entries.length} of {total} {total === 1 ? 'entry' : 'entries'}
                    </span>
                </div>
                <p className='md:col-span-3 text-xs text-muted-foreground'>
                    Export downloads <strong>every</strong> entry matching the filters
                    above (not just this page) as a single CSV or JSON file for an
                    external auditor.
                </p>
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

            <AuditRetentionCard />

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
                        {isBreakGlass(selectedRow.action) && (
                            <div className='border-2 border-black bg-[#fd3777] text-white p-3 text-sm'>
                                <p className='font-black'>⚠ Emergency (break-glass) access</p>
                                <p className='mt-1'>
                                    An administrator accessed another user's note outside normal
                                    author scoping. This is a controlled, logged emergency action.
                                </p>
                                {typeof selectedRow.extra?.justification === 'string' && (
                                    <p className='mt-2'>
                                        <span className='font-bold'>Justification:</span>{' '}
                                        {selectedRow.extra.justification as string}
                                    </p>
                                )}
                            </div>
                        )}
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
