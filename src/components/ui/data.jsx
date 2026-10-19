import { cn } from '../../lib/utils.js'
import { EmptyState } from './surfaces.jsx'

/**
 * Tableau responsable : vrai tableau au-delà de `sm`, liste empilée en dessous.
 * Les cellules reçoivent du texte déjà formaté par le serveur ; aucun HTML n'est
 * injecté (§13.8 : pas de dangerouslySetInnerHTML dans ce projet).
 */
export function DataTable({
  columns,
  rows,
  getKey = (row, index) => row.id ?? index,
  empty = 'Aucune ligne',
  emptyIcon,
  className,
  onRowClick,
  dense = false,
  footer,
  // Seuil carte → tableau. Par défaut le tableau apparaît dès `sm` (640px).
  // Un tableau large (beaucoup de colonnes) gagne à rester en cartes plus
  // longtemps : `seuil="lg"` garde les cartes jusqu'à 1024px.
  seuil = 'sm',
}) {
  if (!rows?.length) {
    return <EmptyState icon={emptyIcon} title={empty} className={className} />
  }

  // Classes écrites en toutes lettres pour que Tailwind les détecte au build.
  const tableauVisible = seuil === 'lg' ? 'hidden lg:block' : 'hidden sm:block'
  const cartesVisibles = seuil === 'lg' ? 'space-y-2 lg:hidden' : 'space-y-2 sm:hidden'

  return (
    <div className={className}>
      {/* Ordinateur (et tablette si seuil = sm) */}
      <div className={cn('overflow-x-auto', tableauVisible)}>
        {/*
          `min-w` garantit que le tableau garde une largeur lisible : s'il ne
          tient pas, il défile horizontalement au lieu de comprimer les
          colonnes au point de casser les mots et d'empiler les badges.
        */}
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line-strong bg-surface-2">
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={cn(
                    'whitespace-nowrap px-3 py-2.5 text-left text-[10.5px] font-semibold uppercase tracking-[0.1em] text-soft',
                    column.align === 'right' && 'text-right',
                    column.align === 'center' && 'text-center',
                    column.hideOnTablet && 'hidden lg:table-cell',
                  )}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={getKey(row, index)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  'border-b border-line/70 last:border-0 transition-colors',
                  onRowClick ? 'cursor-pointer hover:bg-accent-soft/40' : 'hover:bg-surface-2/60',
                )}
              >
                {columns.map((column, colIndex) => (
                  <td
                    key={column.key}
                    className={cn(
                      dense ? 'px-3 py-2' : 'px-3 py-3',
                      'align-middle text-soft',
                      // La première colonne (le libellé) peut passer à la ligne
                      // entre les mots ; les autres restent sur une seule ligne
                      // pour que les heures et les badges ne se brisent jamais.
                      colIndex === 0 ? 'min-w-[9rem]' : 'whitespace-nowrap',
                      column.align === 'right' && 'text-right',
                      column.align === 'center' && 'text-center',
                      column.strong && 'font-medium text-ink',
                      column.mono && 'font-mono text-[13px]',
                      column.hideOnTablet && 'hidden lg:table-cell',
                    )}
                  >
                    {column.render ? column.render(row) : row[column.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {footer && <tfoot className="border-t-2 border-line">{footer}</tfoot>}
        </table>
      </div>

      {/* Téléphone (et tablette si seuil = lg) */}
      <ul className={cartesVisibles}>
        {rows.map((row, index) => {
          const [first, ...rest] = columns
          return (
            <li key={getKey(row, index)}>
              <div
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  'rounded-xl border border-line bg-surface-2 px-3.5 py-3',
                  onRowClick && 'cursor-pointer active:bg-surface-3',
                )}
              >
                <p className="text-sm font-semibold text-ink">
                  {first.render ? first.render(row) : row[first.key]}
                </p>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
                  {rest
                    .filter((column) => !column.hideOnMobile)
                    .map((column) => (
                      <div
                        key={column.key}
                        className={cn('min-w-0', column.mobileFull && 'col-span-2')}
                      >
                        {column.label && (
                          <dt className="text-[10px] font-semibold uppercase tracking-wider text-faint">
                            {column.label}
                          </dt>
                        )}
                        <dd
                          className={cn(
                            'truncate text-[13px] text-soft',
                            column.mono && 'font-mono',
                          )}
                        >
                          {column.render ? column.render(row) : row[column.key]}
                        </dd>
                      </div>
                    ))}
                </dl>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Liste clef / valeur, pour les fiches de séance. */
export function KeyValue({ items, className, columns = 2 }) {
  return (
    <dl
      className={cn(
        'grid gap-x-4 gap-y-3',
        columns === 2 ? 'grid-cols-2' : columns === 3 ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-1',
        className,
      )}
    >
      {items
        .filter((item) => item)
        .map((item) => (
          <div key={item.label} className="min-w-0">
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-faint">
              {item.label}
            </dt>
            <dd
              className={cn(
                'mt-0.5 truncate text-sm font-medium text-ink',
                item.mono && 'font-mono',
                item.tone === 'faint' && 'font-normal text-faint',
                item.tone === 'bad' && 'text-bad',
                item.tone === 'ok' && 'text-ok',
                item.tone === 'warn' && 'text-warn',
              )}
              title={typeof item.value === 'string' ? item.value : undefined}
            >
              {item.value}
            </dd>
          </div>
        ))}
    </dl>
  )
}

/** Liste de lignes cliquables, format téléphone d'abord. */
export function RowList({ children, className }) {
  return <ul className={cn('divide-y divide-line', className)}>{children}</ul>
}

export function Row({ title, subtitle, right, onClick, className, leading, as = 'li' }) {
  const Tag = as
  const content = (
    <>
      {leading && <span className="shrink-0">{leading}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink">{title}</span>
        {subtitle && <span className="mt-0.5 block truncate text-[12px] text-faint">{subtitle}</span>}
      </span>
      {right && <span className="shrink-0 text-right">{right}</span>}
    </>
  )

  return (
    <Tag className={className}>
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          className="flex w-full items-center gap-3 px-1 py-3 text-left transition-colors hover:bg-surface-2"
        >
          {content}
        </button>
      ) : (
        <div className="flex items-center gap-3 px-1 py-3">{content}</div>
      )}
    </Tag>
  )
}

/** Totaux de bas de tableau. */
export function TotalRow({ cells }) {
  return (
    <tr>
      {cells.map((cell, index) => (
        <td
          key={index}
          className={cn(
            'px-3 py-3 text-sm font-semibold text-ink',
            cell.align === 'right' && 'text-right',
          )}
          colSpan={cell.colSpan}
        >
          {cell.value}
        </td>
      ))}
    </tr>
  )
}
