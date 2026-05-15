import { API_BASE } from "@/lib/api";
import NeoLinkButton from '@/components/neo/neo-link-button'
import NeoButton from '@/components/neo/neo-button'
import { Breadcrumbs } from '@/components/ui/breadcrumb'
import { useAuth } from '@/context/auth-context';
import { DragEvent, useEffect, useMemo, useState } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router';
import { DataTable } from '@/components/data-table';
import ImportStructuredTemplateModal from '@/components/templates/ImportStructuredTemplateModal';

type TemplateRow = {
    id: number;
    name: string;
    templateType?: 'simple' | 'structured';
    content: string;
    llmModel: string | null;
    version: number;
    createdAt: string;
    updatedAt: string;
    isDeleted: boolean;
    isDeletedTimestamp: string | null;
};

const TypeBadge = ({ type }: { type?: 'simple' | 'structured' }) => {
    const isStudio = type === 'structured';
    return (
        <span
            className={
                'inline-flex shrink-0 border-2 px-1.5 py-px text-[9px] font-extrabold uppercase tracking-wider ' +
                (isStudio
                    ? 'border-[#5d1d91] bg-[#5d1d91] text-white'
                    : 'border-black bg-white text-black')
            }
            title={isStudio ? 'Built in PrivateScribe Studio (structured fields)' : 'Markdown template'}
        >
            {isStudio ? 'Studio' : 'Simple'}
        </span>
    );
};

const formatDateTime = (value: string | null | undefined) => {
    if (!value) return '—';
    const d = new Date(value);
    return isNaN(d.getTime())
        ? value
        : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

const Templates = () => {
    const [templates, setTemplates] = useState<TemplateRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [importOpen, setImportOpen] = useState(false);
    const [importInitialJson, setImportInitialJson] = useState<string | undefined>(undefined);
    const [pageDragOver, setPageDragOver] = useState(false);
    const [dropError, setDropError] = useState<string | null>(null);
    const auth = useAuth();
    const navigate = useNavigate();

    useEffect(() => {
        const fetchTemplates = async () => {
            setLoading(true);
            try {
                const response = await fetch(
                    `${API_BASE}/api/templates/user/${auth.user?.id}?include_deleted=true`,
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
                setTemplates(Array.isArray(data) ? data : []);
            } catch (error) {
                console.log('Error fetching templates: ', error);
                setTemplates([]);
            }
            setLoading(false);
        };
        fetchTemplates();
    }, [auth.token, auth.user?.id]);

    const llmOptions = useMemo(() => {
        const seen = new Set<string>();
        for (const t of templates) {
            if (t.llmModel) seen.add(t.llmModel);
        }
        return Array.from(seen).sort();
    }, [templates]);

    const columns = useMemo<ColumnDef<TemplateRow, unknown>[]>(() => [
        {
            accessorKey: 'name',
            header: 'Name',
            cell: ({ row }) => (
                <span className='flex items-center gap-2 truncate'>
                    <TypeBadge type={row.original.templateType} />
                    <span className='font-semibold truncate'>{row.original.name}</span>
                    {row.original.isDeleted && (
                        <span className='text-[#fd3777]' title='Deleted'>
                            <Trash2 size={14} />
                        </span>
                    )}
                </span>
            ),
            meta: {
                searchableValue: (row: TemplateRow) =>
                    `${row.name} ${row.content ?? ''} ${row.llmModel ?? ''}`,
            },
        },
        {
            id: 'llmModel',
            accessorFn: (row) => row.llmModel ?? '',
            header: 'LLM Model',
            size: 200,
            filterFn: (row, _id, value) => {
                if (!value) return true;
                return (row.original.llmModel ?? '') === value;
            },
            cell: ({ row }) => (
                <span className={row.original.llmModel ? '' : 'text-muted-foreground italic'}>
                    {row.original.llmModel ?? 'Default'}
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
                        <option value=''>All models</option>
                        {llmOptions.map((m) => (
                            <option key={m} value={m}>{m}</option>
                        ))}
                    </select>
                ),
            },
        },
        {
            accessorKey: 'version',
            header: 'Version',
            size: 100,
            cell: ({ row }) => <span>v{row.original.version}</span>,
        },
        {
            accessorKey: 'updatedAt',
            header: 'Updated',
            size: 200,
            sortingFn: (a, b) => new Date(a.original.updatedAt).getTime() - new Date(b.original.updatedAt).getTime(),
            cell: ({ row }) => <span>{formatDateTime(row.original.updatedAt)}</span>,
        },
    ], [llmOptions]);

    // Only react to drags that actually carry a file. The browser uses the same
    // dragover event for in-page text selection, link drags, etc.; we don't
    // want the page to light up for those.
    const hasFile = (e: DragEvent<HTMLDivElement>) =>
        Array.from(e.dataTransfer?.types ?? []).includes('Files');

    const handlePageDragOver = (e: DragEvent<HTMLDivElement>) => {
        if (!hasFile(e)) return;
        e.preventDefault();
        if (!pageDragOver) setPageDragOver(true);
    };

    const handlePageDragLeave = (e: DragEvent<HTMLDivElement>) => {
        if (e.currentTarget === e.target) setPageDragOver(false);
    };

    const handlePageDrop = async (e: DragEvent<HTMLDivElement>) => {
        if (!hasFile(e)) return;
        e.preventDefault();
        setPageDragOver(false);
        const file = e.dataTransfer.files?.[0];
        if (!file) return;
        if (file.size > 1024 * 1024) {
            setDropError(`"${file.name}" is larger than 1MB — that's not a template.`);
            return;
        }
        try {
            const text = await file.text();
            setDropError(null);
            setImportInitialJson(text);
            setImportOpen(true);
        } catch (err: any) {
            setDropError(err?.message || 'Could not read file');
        }
    };

    return (
        <div
            className='relative px-6 py-8'
            onDragOver={handlePageDragOver}
            onDragEnter={handlePageDragOver}
            onDragLeave={handlePageDragLeave}
            onDrop={handlePageDrop}
        >
            <Breadcrumbs notes={[{ label: 'All Templates' }]} />

            <div className='flex justify-between items-center mb-6'>
                <h1 className='text-4xl font-black mt-6'>All Templates</h1>
                <div className='flex gap-2'>
                    <NeoButton
                        onClick={() => { setImportInitialJson(undefined); setImportOpen(true); }}
                        backgroundColor='#ffffff'
                        textColor='#000000'
                    >
                        ↥ Import Studio JSON
                    </NeoButton>
                    <NeoLinkButton
                        route='/templates/new'
                        label='📝 Create Template'
                        backgroundColor='#fd3777'
                        textColor='#ffffff'
                    />
                </div>
            </div>

            {loading ? (
                <p>Loading...</p>
            ) : (
                <DataTable<TemplateRow>
                    data={templates}
                    columns={columns}
                    initialSorting={[{ id: 'updatedAt', desc: true }]}
                    searchPlaceholder='Search by name, content, or model...'
                    pagination
                    emptyState='No templates yet — create one to get started.'
                    onRowClick={(row) => navigate(`/templates/${row.id}`)}
                />
            )}

            {importOpen && (
                <ImportStructuredTemplateModal
                    onClose={() => { setImportOpen(false); setImportInitialJson(undefined); }}
                    onImported={(t) => setTemplates((prev) => [t as TemplateRow, ...prev])}
                    initialJson={importInitialJson}
                />
            )}

            {pageDragOver && (
                <div className='pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-[#fd3777]/15 border-[6px] border-dashed border-[#fd3777]'>
                    <div className='border-[3px] border-black bg-white px-8 py-4 shadow-[6px_6px_0_0_#000]'>
                        <p className='text-2xl font-black uppercase tracking-wide text-[#5d1d91]'>
                            Drop JSON to import template
                        </p>
                    </div>
                </div>
            )}

            {dropError && (
                <div className='fixed bottom-4 right-4 z-40 max-w-sm border-[2px] border-black bg-red-50 p-3 text-sm text-red-700 shadow-[4px_4px_0_0_#000]'>
                    <div className='flex justify-between gap-3'>
                        <span>{dropError}</span>
                        <button
                            type='button'
                            onClick={() => setDropError(null)}
                            className='font-black'
                        >
                            ✕
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Templates;
