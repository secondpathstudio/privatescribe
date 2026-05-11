import { useRef, useState } from 'react';
import {
    ColumnDef,
    ColumnFiltersState,
    SortingState,
    flexRender,
    getCoreRowModel,
    getFilteredRowModel,
    getSortedRowModel,
    useReactTable,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * A virtualized, sortable, searchable, filterable table.
 *
 * The shadcn <Table> primitives use semantic <table>/<tbody> markup which
 * doesn't compose well with virtualization (virtualized rows need absolute
 * positioning inside a scroll container). We use plain divs with the same
 * visual treatment so we can hand the body to @tanstack/react-virtual.
 *
 * Scale notes: client-side sort/filter/virtualized render holds up well into
 * the 5-10k row range for the row shapes used here. Past that, prefer
 * server-side pagination instead of stacking more virtualization.
 */

type DataTableProps<TData> = {
    data: TData[];
    columns: ColumnDef<TData, unknown>[];
    /**
     * Search query is matched against the concatenation of every cell's
     * stringified accessor value. Override per-column with column.filterFn
     * or column.meta.searchableValue if a column needs custom search text.
     */
    initialSorting?: SortingState;
    /** Default placeholder for the global search input. */
    searchPlaceholder?: string;
    /** Extra toolbar content rendered to the right of the search box. */
    toolbar?: React.ReactNode;
    /** Rendered when filtered data is empty. */
    emptyState?: React.ReactNode;
    /** Click handler for an entire row (e.g. navigate to detail page). */
    onRowClick?: (row: TData) => void;
    /** Estimated row height in px. Used by the virtualizer. Default 56. */
    rowHeight?: number;
    /** Max height of the scroll viewport. Default 70vh. */
    maxBodyHeight?: string;
};

/**
 * Fall-back stringification used by the global search filter. We grab every
 * column's accessor value, stringify, lowercase, and substring-match. Columns
 * can override by setting `meta.searchableValue` to a function returning a
 * string from the original row.
 */
function defaultGlobalFilterFn<TData>(
    row: { getAllCells: () => { column: { columnDef: ColumnDef<TData, unknown> }; getValue: () => unknown }[]; original: TData },
    _columnId: string,
    filterValue: string,
): boolean {
    const q = filterValue.trim().toLowerCase();
    if (!q) return true;
    for (const cell of row.getAllCells()) {
        const meta = cell.column.columnDef.meta as { searchableValue?: (row: TData) => string } | undefined;
        const text = meta?.searchableValue
            ? meta.searchableValue(row.original)
            : String(cell.getValue() ?? '');
        if (text.toLowerCase().includes(q)) return true;
    }
    return false;
}

export function DataTable<TData>({
    data,
    columns,
    initialSorting = [],
    searchPlaceholder = 'Search...',
    toolbar,
    emptyState,
    onRowClick,
    rowHeight = 56,
    maxBodyHeight = '70vh',
}: DataTableProps<TData>) {
    const [sorting, setSorting] = useState<SortingState>(initialSorting);
    const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
    const [globalFilter, setGlobalFilter] = useState('');

    const table = useReactTable({
        data,
        columns,
        state: { sorting, columnFilters, globalFilter },
        onSortingChange: setSorting,
        onColumnFiltersChange: setColumnFilters,
        onGlobalFilterChange: setGlobalFilter,
        globalFilterFn: defaultGlobalFilterFn as never,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
    });

    const rows = table.getRowModel().rows;
    const scrollRef = useRef<HTMLDivElement>(null);
    const rowVirtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => rowHeight,
        overscan: 8,
    });

    // Each column either grows with `minmax(0, 1fr)` or holds a fixed size
    // if its columnDef sets `size`. Cheap enough to recompute every render
    // — visible-leaf-columns is already cached by TanStack Table.
    const gridTemplate = table.getVisibleLeafColumns().map((col) => {
        const size = col.columnDef.size;
        // TanStack injects a default size of 150 on columns where the caller
        // didn't set one. Treat that sentinel as "no explicit size" so the
        // column flexes to fill remaining space alongside any other unsized
        // columns instead of getting a static 150px width.
        return size && size !== 150 ? `${size}px` : 'minmax(0, 1fr)';
    }).join(' ');

    return (
        <div className='flex flex-col gap-3 w-full'>
            <div className='flex items-center gap-2'>
                <div className='relative flex-1 max-w-sm'>
                    <Search className='absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground' size={16} />
                    <Input
                        value={globalFilter}
                        onChange={(e) => setGlobalFilter(e.target.value)}
                        placeholder={searchPlaceholder}
                        className='pl-8'
                    />
                </div>
                <div className='flex items-center gap-2 ml-auto'>{toolbar}</div>
            </div>

            <div className='border-2 border-black bg-white text-sm w-full'>
                {/* Header */}
                <div
                    className='grid w-full border-b-2 border-black bg-muted/30 font-semibold'
                    style={{ gridTemplateColumns: gridTemplate }}
                >
                    {table.getFlatHeaders().map((header) => {
                        const canSort = header.column.getCanSort();
                        const dir = header.column.getIsSorted();
                        return (
                            <div key={header.id} className='px-3 py-2'>
                                <div className='flex flex-col gap-1'>
                                    <button
                                        type='button'
                                        onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                                        className={cn(
                                            'flex items-center gap-1 text-left',
                                            canSort && 'cursor-pointer hover:opacity-70',
                                        )}
                                        disabled={!canSort}
                                    >
                                        {flexRender(header.column.columnDef.header, header.getContext())}
                                        {canSort && (
                                            dir === 'asc' ? <ArrowUp size={14} />
                                                : dir === 'desc' ? <ArrowDown size={14} />
                                                : <ArrowUpDown size={14} className='opacity-40' />
                                        )}
                                    </button>
                                    {/* Per-column filter slot. Columns opt in by
                                        setting columnDef.meta.filterElement, which
                                        receives the column instance and renders
                                        whatever input it wants (select, range, etc).
                                    */}
                                    {(() => {
                                        const meta = header.column.columnDef.meta as
                                            | { filterElement?: (column: typeof header.column) => React.ReactNode }
                                            | undefined;
                                        return meta?.filterElement ? meta.filterElement(header.column) : null;
                                    })()}
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Body — virtualized */}
                <div
                    ref={scrollRef}
                    className='overflow-auto'
                    style={{ maxHeight: maxBodyHeight }}
                >
                    {rows.length === 0 ? (
                        <div className='p-8 text-center text-muted-foreground'>
                            {emptyState || 'No results.'}
                        </div>
                    ) : (
                        <div
                            style={{
                                height: rowVirtualizer.getTotalSize(),
                                position: 'relative',
                            }}
                        >
                            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                                const row = rows[virtualRow.index];
                                return (
                                    <div
                                        key={row.id}
                                        className={cn(
                                            'grid items-center border-b last:border-b-0 hover:bg-muted/40',
                                            onRowClick && 'cursor-pointer',
                                        )}
                                        style={{
                                            gridTemplateColumns: gridTemplate,
                                            position: 'absolute',
                                            top: 0,
                                            left: 0,
                                            width: '100%',
                                            transform: `translateY(${virtualRow.start}px)`,
                                            height: `${virtualRow.size}px`,
                                        }}
                                        onClick={() => onRowClick?.(row.original)}
                                    >
                                        {row.getVisibleCells().map((cell) => (
                                            <div key={cell.id} className='px-3 py-2 truncate'>
                                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                            </div>
                                        ))}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Footer summary */}
                <div className='border-t-2 border-black bg-muted/30 px-3 py-2 text-xs text-muted-foreground flex justify-between'>
                    <span>
                        {rows.length} of {data.length} {data.length === 1 ? 'row' : 'rows'}
                    </span>
                </div>
            </div>
        </div>
    );
}

export default DataTable;
