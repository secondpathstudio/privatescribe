import NeoLinkButton from '@/components/neo/neo-link-button'
import { Breadcrumbs } from '@/components/ui/breadcrumb'
import { useAuth } from '@/context/auth-context';
import { useEffect, useMemo, useState } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router';
import { DataTable } from '@/components/data-table';

type TemplateRow = {
    id: number;
    name: string;
    content: string;
    llmModel: string | null;
    version: number;
    createdAt: string;
    updatedAt: string;
    isDeleted: boolean;
    isDeletedTimestamp: string | null;
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
    const auth = useAuth();
    const navigate = useNavigate();

    useEffect(() => {
        const fetchTemplates = async () => {
            setLoading(true);
            try {
                const response = await fetch(
                    `http://127.0.0.1:5000/api/templates/user/${auth.user?.id}?include_deleted=true`,
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

    return (
        <div className='max-w-screen-lg mx-auto px-4 py-10'>
            <Breadcrumbs notes={[{ label: 'All Templates' }]} />

            <div className='flex justify-between items-center mb-6'>
                <h1 className='text-4xl font-black mt-6'>All Templates</h1>
                <NeoLinkButton
                    route='/templates/new'
                    label='📝 Create Template'
                    backgroundColor='#fd3777'
                    textColor='#ffffff'
                />
            </div>

            {loading ? (
                <p>Loading...</p>
            ) : (
                <DataTable<TemplateRow>
                    data={templates}
                    columns={columns}
                    initialSorting={[{ id: 'updatedAt', desc: true }]}
                    searchPlaceholder='Search by name, content, or model...'
                    emptyState='No templates yet — create one to get started.'
                    onRowClick={(row) => navigate(`/templates/${row.id}`)}
                />
            )}
        </div>
    );
};

export default Templates;
